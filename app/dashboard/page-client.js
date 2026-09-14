'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Image from 'next/image';
import StudentCard from '@/components/student/StudentCard';
import NotesPanel from '@/components/student/NotesPanel';
import QuickLinks from '@/components/navigation/QuickLinks';
import TutorSchedulePanel from '@/components/tutor-dashboard/TutorSchedulePanel';
import SongBrowser from '@/components/tutor-dashboard/SongBrowser';
import NewsletterStrip from '@/components/tutor-dashboard/NewsletterStrip';
import NewsletterCapture from '@/components/tutor-dashboard/NewsletterCapture';
import HeaderGreenery from '@/components/tutor-dashboard/HeaderGreenery';
import { TutorSignOutButton } from '@/components/tutor-dashboard/TutorAuthButton';
import TimeOfDaySky from '@/components/shared/TimeOfDaySky';
import { Search, ChevronLeft } from 'lucide-react';
import { cache } from '@/lib/cache';
import {
  excludeGroupOnlyStudents,
  filterTutorStudentsBySearch,
} from '@/lib/tutor-dashboard-helpers.mjs';
import { resolvePracticeChatEvalPrompt, shouldSample } from '@/lib/config/practice-chat-eval.mjs';

const TUTOR_STORAGE_KEY = 'fc_dashboard_tutor';
const LOADING_MESSAGES = [
  "The First Chord Dashboard is just taking a sec to learn ancient Greek, bear with it...",
  "The First Chord Dashboard is choosing between two lovely patterned shirts, please hold...",
  "The First Chord Dashboard is emotionally processing being a dashboard, please hold...",
  "The First Chord Dashboard is just round the corner, please hold...",
  "The First Chord Dashboard is exploring quantum physics, please hold...",
  "The First Chord Dashboard is just finishing the last of its lunch, please hold...",
  "The First Chord Dashboard is chatting with Vince, please hold...",
  "The First Chord Dashboard is pretending to be an ironing board, please hold...",
  "The First Chord Dashboard is tuning its guitar, please hold...",
  "The First Chord Dashboard is advising a chicken on road safety, please hold...",
];

function lessonStartMinutes(lesson) {
  const match = `${lesson.lessonTime || ''}`.match(/^(\d{1,2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function possessive(name = '') {
  return name.endsWith('s') ? `${name}’` : `${name}’s`;
}

function timeAwareGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function notesUrlForStudent(student = {}, { history = false, summary = false, priorRating = false } = {}) {
  const studentId = student.mms_id || student.ID || '';
  const token = student.noteAccessToken || student.note_access_token || '';
  const params = new URLSearchParams();
  if (token) params.set('token', token);
  if (history) params.set('history', '1');
  if (summary) params.set('summary', '1');
  const path = `/api/notes/${encodeURIComponent(studentId)}${priorRating ? '/prior-rating' : ''}`;
  return `${path}${params.toString() ? `?${params.toString()}` : ''}`;
}

// Whole days since the previous note, or null when there is no usable date.
// Used only to describe what the tutor had in front of them; it never decides
// anything.
function priorNoteAgeDays(notes, now = Date.now()) {
  const time = new Date(notes?.lesson_date || '').getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.round((now - time) / (24 * 60 * 60 * 1000)));
}

// Asked once per student per day at most, and only where the answer could mean
// something — there has to be a previous note to have been useful. Deterministic
// on student + date so a re-render never rolls the dice again and pops a prompt
// at a tutor who just dismissed one.
function shouldAskPriorRating({ tutor, student, notes, answered }) {
  if (!notes || answered) return false;
  const { prompt, sample } = resolvePracticeChatEvalPrompt({ tutor });
  if (!prompt) return false;
  const studentId = student?.mms_id || '';
  return shouldSample(`${studentId}:${new Date().toISOString().slice(0, 10)}`, sample);
}

export default function DashboardClient({ tutorOptions = [], authAccess = {} }) {
  const TUTOR_OPTIONS = useMemo(() => tutorOptions.map((entry) => entry.shortName), [tutorOptions]);
  const fixedTutor = !authAccess.fullAccess && TUTOR_OPTIONS.length === 1
    ? TUTOR_OPTIONS[0]
    : '';
  const [tutor, setTutor] = useState(fixedTutor);
  const [students, setStudents] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [lastNotes, setLastNotes] = useState(null);
  const [notesSource, setNotesSource] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [practiceChatPanel, setPracticeChatPanel] = useState(null);
  // Evaluation-only, and per student: whether this tutor deliberately opened
  // earlier lessons, and whether they have already answered the usefulness
  // prompt for this student. Reset when the selected student changes.
  const [priorNoteReview, setPriorNoteReview] = useState({ historyOpened: false, ratingAnswered: false });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [todayLessons, setTodayLessons] = useState([]);
  const searchInputRef = useRef(null);

  // Selecting a student slides the sidebar away so the view is all about them
  const handleSelectStudent = (student) => {
    setSelectedStudent(student);
    setPriorNoteReview({ historyOpened: false, ratingAnswered: false });
    if (student) setSidebarOpen(false);
  };

  const handleSelectTutor = (tutorName) => {
    if (!TUTOR_OPTIONS.includes(tutorName)) return;
    setTutor(tutorName);
    try {
      localStorage.setItem(TUTOR_STORAGE_KEY, tutorName);
    } catch {}
  };

  // Restore the tutor from the last visit so a reload doesn't ask again
  useEffect(() => {
    if (!authAccess.fullAccess) {
      setTutor(fixedTutor);
      return;
    }
    try {
      const saved = localStorage.getItem(TUTOR_STORAGE_KEY);
      if (saved && TUTOR_OPTIONS.includes(saved)) {
        setTutor(saved);
      }
    } catch {}
  }, [TUTOR_OPTIONS, authAccess.fullAccess, fixedTutor]);
  // const [isAuthenticated, setIsAuthenticated] = useState(true); // Always authenticated with hardcoded token

  // Sync students from MMS
  const syncStudentsFromMMS = useCallback(async (forcedTutor = null, forceSync = false) => {
    const targetTutor = forcedTutor || tutor;
    if (!targetTutor) return;

    // Check cache first (unless force sync is requested)
    if (!forceSync) {
      const cachedStudents = cache.getStudents(targetTutor);
      if (cachedStudents) {
        setStudents(cachedStudents);
        console.log(`📦 Using cached data for ${targetTutor} (${cachedStudents.length} students)`);
        return;
      }
    }

    // Show fun loading message
    const randomMessage = LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)];
    setLoadingMessage(randomMessage);
    setIsLoading(true);

    console.log(`🔄 ${forceSync ? 'Force syncing' : 'Syncing'} students from MMS...`);

    try {
      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          tutor: targetTutor,
          forceSync: true 
        })
      });

      const data = await response.json();
      
      if (data.success && data.source === 'mms') {
        setStudents(data.students || []);
        
        // Cache the fresh data
        cache.setStudents(targetTutor, data.students || []);
        
        console.log(`✅ Synced ${data.count} students from MMS`);
      } else {
        console.log('❌ MMS sync failed, using local data');
        
        // Fallback to local data
        fetch(`/api/students?tutor=${targetTutor}`)
          .then(res => res.json())
          .then(data => setStudents(data.students || []));
      }
    } catch (error) {
      console.error('Sync error:', error);
    } finally {
      // Hide loading message
      setIsLoading(false);
      setLoadingMessage('');
    }
  }, [tutor]);

  // Today's lessons feed the sidebar time chips and the at-a-glance summary
  useEffect(() => {
    if (!tutor) {
      setTodayLessons([]);
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    fetch(`/api/tutor-schedule?${new URLSearchParams({ tutor, date: today })}`)
      .then((res) => res.json())
      .then((data) => setTodayLessons(data.success ? (data.lessons || []) : []))
      .catch(() => setTodayLessons([]));
  }, [tutor]);

  const todayTimeByStudent = useMemo(() => {
    const map = new Map();
    for (const lesson of todayLessons) {
      for (const studentId of lesson.studentMmsIds || []) {
        if (!map.has(studentId)) map.set(studentId, lesson.lessonTime || '');
      }
    }
    return map;
  }, [todayLessons]);

  // One newsletter read per tutor, shared by the reminder strip and the marks on
  // the student cards, so the two can never disagree about who is a priority.
  // Any of this tutor's students carries a usable capability token; the read is
  // about the tutor, not about that student.
  const [newsletterIssue, setNewsletterIssue] = useState(null);
  const [newsletterRefreshKey, setNewsletterRefreshKey] = useState(0);
  const newsletterTokenStudent = useMemo(
    () => students.find((entry) => entry.noteAccessToken || entry.note_access_token) || null,
    [students],
  );

  useEffect(() => {
    const token = newsletterTokenStudent?.noteAccessToken || newsletterTokenStudent?.note_access_token || '';
    const studentId = newsletterTokenStudent?.mms_id || '';
    if (!token || !studentId) {
      setNewsletterIssue(null);
      return undefined;
    }
    let cancelled = false;
    fetch(`/api/newsletter/current?${new URLSearchParams({ student: studentId, token })}`)
      .then((res) => res.json())
      // A closed month, a service without tutor auth, or any failure all read the
      // same way here: no strip and no marks. Absent is a fine state for a reminder.
      .then((data) => { if (!cancelled) setNewsletterIssue(data.success && data.open ? data : null); })
      .catch(() => { if (!cancelled) setNewsletterIssue(null); });
    return () => { cancelled = true; };
  }, [newsletterTokenStudent, newsletterRefreshKey]);

  // Priority students only. Amber until something arrives, green after. A
  // "nothing this month" reply shows no mark: that uncertainty is closed.
  const newsletterMarkByStudent = useMemo(() => {
    const map = new Map();
    for (const entry of newsletterIssue?.priorities || []) {
      if (entry.state === 'requested') map.set(entry.mmsId, 'waiting');
      else if (entry.state !== 'declined') map.set(entry.mmsId, 'in');
    }
    return map;
  }, [newsletterIssue]);

  // Fetch students when tutor is selected
  useEffect(() => {
    if (tutor) {
      // Debug: Show cache info
      console.log('🔍 Cache info:', cache.getInfo());
      
      // Try cache first, then MMS sync, then fallback to local
      syncStudentsFromMMS(tutor, false); // false = allow cache usage
    }
  }, [tutor, syncStudentsFromMMS]);

  useEffect(() => {
    if (!practiceChatPanel) return undefined;
    function onKey(event) {
      if (event.key === 'Escape') {
        setPracticeChatPanel(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [practiceChatPanel]);

  // Keyboard shortcuts: Esc deselects the current student, "/" jumps to search
  useEffect(() => {
    function onKey(event) {
      const target = event.target;
      const isTyping = target instanceof HTMLElement
        && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if (event.key === 'Escape' && !isTyping) {
        setSelectedStudent((current) => (current ? null : current));
        setSidebarOpen(true);
      }

      if (event.key === '/' && !isTyping) {
        event.preventDefault();
        setSidebarOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
    }
    if (practiceChatPanel) return undefined;
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [practiceChatPanel]);

  useEffect(() => {
    if (!practiceChatPanel?.url) return undefined;

    let closeTimer = null;
    let expectedOrigin = '';
    try {
      expectedOrigin = new URL(practiceChatPanel.url).origin;
    } catch {
      expectedOrigin = '';
    }

    function onPracticeChatMessage(event) {
      const message = event.data || {};
      if (message.type !== 'firstchord:practice-chat-complete') return;
      if (expectedOrigin && event.origin !== expectedOrigin) return;

      setPracticeChatPanel((current) => (
        current
          ? {
              ...current,
              completed: true,
              completedStatus: message.status || 'completed',
            }
          : current
      ));

      closeTimer = window.setTimeout(() => {
        setPracticeChatPanel(null);
      }, 1100);
    }

    window.addEventListener('message', onPracticeChatMessage);
    return () => {
      window.removeEventListener('message', onPracticeChatMessage);
      if (closeTimer) window.clearTimeout(closeTimer);
    };
  }, [practiceChatPanel?.url]);

  // Fetch notes when student is selected
  useEffect(() => {
    if (selectedStudent) {
      setLoading(true);
      
      fetch(notesUrlForStudent(selectedStudent))
        .then(res => res.json())
        .then(data => {
          if (!data.success && data.code === 'notes_token_required' && tutor) {
            cache.clearStudents(tutor);
            syncStudentsFromMMS(tutor, true);
          }
          setLastNotes(data.notes);
          setNotesSource(data.source);
          setLoading(false);
          
          if (data.success) {
            console.log('✅ Using live MMS notes data');
          } else {
            console.log('⚠️ Failed to fetch notes from MMS.');
          }
        })
        .catch(error => {
          console.error('Error fetching notes:', error);
          setLoading(false);
        });
    }
  }, [selectedStudent, tutor, syncStudentsFromMMS]);

  // Filter students by search (group-only students, e.g. Ukulele Orchestra, stay hidden)
  const filteredStudents = filterTutorStudentsBySearch(excludeGroupOnlyStudents(students), searchTerm);

  // Today-at-a-glance summary for the empty state
  const todaySummary = (() => {
    if (todayLessons.length === 0) {
      return { headline: 'No lessons today', hint: 'Enjoy the breather — or pick a student to look something up.' };
    }
    const now = new Date().getHours() * 60 + new Date().getMinutes();
    const current = todayLessons.find((lesson) => {
      const start = lessonStartMinutes(lesson);
      return start != null && start <= now && now < start + (lesson.durationMinutes || 30);
    });
    if (current) {
      return {
        headline: `Now: ${current.studentLabel} (${current.lessonTime})`,
        hint: 'Click their lesson above to open their space.',
      };
    }
    const next = todayLessons.find((lesson) => {
      const start = lessonStartMinutes(lesson);
      return start != null && start > now;
    });
    const count = `${todayLessons.length} lesson${todayLessons.length === 1 ? '' : 's'} today`;
    if (next) {
      return { headline: `${count} — next is ${next.studentLabel} at ${next.lessonTime}`, hint: 'Click a lesson above to open their space.' };
    }
    return { headline: `All ${todayLessons.length} lessons done for today`, hint: 'Nice work — see you next time.' };
  })();

  // Debug logging (only when needed)
  // console.log('🔍 Dashboard state:', { tutor, tutorLength: tutor.length, tutorType: typeof tutor, isEmpty: !tutor });

  // Show loading screen if loading
  if (isLoading) {
    return (
      <>
        <style jsx>{`
          .loading-cloud {
            animation: gentle-float 3s ease-in-out infinite;
          }
          
          .loading-dots::after {
            content: '';
            animation: loading-dots 2s linear infinite;
          }
          
          @keyframes gentle-float {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-8px); }
          }
          
          @keyframes loading-dots {
            0% { content: ''; }
            25% { content: '.'; }
            50% { content: '..'; }
            75% { content: '...'; }
            100% { content: ''; }
          }
        `}</style>
        <TimeOfDaySky className="min-h-screen flex items-center justify-center relative overflow-hidden">
          {/* Cloud */}
          <div className="absolute inset-0 pointer-events-none">
            <Image
              src="/cloud.png"
              alt=""
              width={192}
              height={128}
              className="absolute top-16 right-8 opacity-90 transform -rotate-12"
            />
          </div>
          
          <div className="text-center relative z-10">
            <div className="mb-8">
              <div className="inline-flex items-center justify-center w-24 h-24 mb-6">
                {/* Floating Cloud */}
                <div className="loading-cloud">
                  <Image
                    src="/cloud.png"
                    alt="Loading cloud"
                    width={80}
                    height={53}
                    className="object-contain opacity-70"
                  />
                </div>
              </div>
              <h2 className="text-xl font-bold italic text-gray-800 max-w-md mx-auto leading-relaxed loading-dots">
                {loadingMessage.replace(/\.\.\.$/, '')}
              </h2>
            </div>
          </div>
        </TimeOfDaySky>
      </>
    );
  }

  // If no tutor selected, show tutor selection
  if (!tutor) {
    return (
      <TimeOfDaySky className="min-h-screen flex items-center justify-center relative overflow-hidden">
        {/* Cloud */}
        <div className="absolute inset-0 pointer-events-none">
          <Image
            src="/cloud.png"
            alt=""
            width={192}
            height={128}
            className="absolute top-16 right-8 opacity-90 transform -rotate-12"
          />
        </div>
        
        <div className="relative z-10 mx-4 w-full max-w-4xl rounded-xl bg-white p-6 shadow-lg sm:mx-8 sm:p-12">
          {authAccess.enforced ? (
            <div className="mb-7 flex flex-col items-center justify-between gap-3 rounded-xl border border-green-100 bg-green-50/70 px-4 py-3 text-sm text-slate-700 sm:flex-row">
              <span>
                Signed in as <strong>{authAccess.email}</strong>
              </span>
              <TutorSignOutButton className="rounded-lg border border-green-200 bg-white px-3 py-2 text-sm font-bold text-[#2F6B3D] transition hover:bg-green-50" />
            </div>
          ) : null}
          <h1 className="text-2xl font-bold mb-8 text-center">Select Your Profile</h1>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4">
            {TUTOR_OPTIONS.map(tutorName => (
              <button
                key={tutorName}
                onClick={() => handleSelectTutor(tutorName)}
                className="flex min-h-[60px] items-center justify-center rounded-lg bg-[#2F6B3D] px-6 py-4 text-center text-lg font-medium text-white transition-all duration-150 hover:-translate-y-0.5 hover:bg-[#245230] hover:shadow-lg active:translate-y-0 sm:text-xl"
              >
                {tutorName}
              </button>
            ))}
          </div>
        </div>
      </TimeOfDaySky>
    );
  }

  return (
    <TimeOfDaySky className="h-screen flex flex-col relative overflow-hidden">
      {/* Cloud */}
      <div className="absolute inset-0 pointer-events-none">
        <Image
          src="/cloud.png"
          alt=""
          width={192}
          height={128}
          className="absolute top-16 right-8 opacity-90 transform -rotate-12"
        />
      </div>
      
      {/* Header */}
      <header
        className="relative shrink-0 shadow-sm border-b border-white/30"
        style={{ background: 'var(--dashboard-header-background)' }}
      >
        <HeaderGreenery />
        <div className="relative px-4 py-4 text-center sm:px-6 sm:py-5">
          <h1 className="text-3xl font-black tracking-tight text-gray-900">
            {possessive(tutor)} Dashboard
          </h1>
          <p className="mt-1 text-gray-600">
            {timeAwareGreeting()}! · {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}
          </p>
          <div className="mt-3 flex items-center justify-center gap-2 sm:absolute sm:right-6 sm:top-1/2 sm:mt-0 sm:-translate-y-1/2">
            {authAccess.fullAccess ? (
              <button
                onClick={() => {
                  setTutor('');
                  setSelectedStudent(null);
                  setLastNotes(null);
                  setPracticeChatPanel(null);
                  setSidebarOpen(true);
                  try {
                    localStorage.removeItem(TUTOR_STORAGE_KEY);
                  } catch {}
                }}
                className="rounded-lg bg-[#2F6B3D] px-4 py-2 text-white transition-colors hover:bg-[#245230]"
              >
                Switch Tutor
              </button>
            ) : null}
            {authAccess.enforced ? (
              <TutorSignOutButton className="rounded-lg border border-green-700 bg-white/90 px-4 py-2 text-sm font-bold text-[#2F6B3D] transition hover:bg-white" />
            ) : null}
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Student List Sidebar */}
        <aside
          className={`shrink-0 overflow-y-auto overflow-x-hidden transition-all duration-300 ease-out ${
            sidebarOpen ? 'w-80 border-r' : 'w-0'
          }`}
          style={{
            background: 'radial-gradient(ellipse at center, rgba(255, 255, 255, 0.28) 0%, rgba(255, 255, 255, 0.12) 42%, transparent 76%)'
          }}
        >
          <div className="w-80">
            <div className="sticky top-0 z-10 p-4 border-b bg-white/70 backdrop-blur">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Find your student"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#2F6B3D]"
                />
              </div>
            </div>
            <div className="p-4">
              <div className="space-y-3">
                {filteredStudents.map(student => (
                  <StudentCard
                    key={student.mms_id}
                    student={student}
                    onClick={handleSelectStudent}
                    isSelected={selectedStudent?.mms_id === student.mms_id}
                    showTutor={false}
                    todayTime={todayTimeByStudent.get(student.mms_id) || ''}
                    newsletter={newsletterMarkByStudent.get(student.mms_id) || ''}
                  />
                ))}
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto">
          {selectedStudent ? (
            <div className="p-6 max-w-6xl mx-auto">
              <div className="flex items-start justify-between gap-3">
                {!sidebarOpen && (
                  <button
                    type="button"
                    onClick={() => setSidebarOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-green-50/80 px-4 py-2 text-sm font-bold text-[#2F6B3D] shadow-sm backdrop-blur transition-colors hover:bg-white/90"
                  >
                    <ChevronLeft className="h-4 w-4 text-[#2F6B3D]" />
                    Students
                  </button>
                )}
                <div className="min-w-0 flex-1">
                  <TutorSchedulePanel
                    tutor={tutor}
                    students={students}
                    onSelectStudent={handleSelectStudent}
                    compact
                    defaultCollapsed
                    collapseKey={selectedStudent?.mms_id || ''}
                  />
                </div>
              </div>
              <h2 className="text-3xl font-bold mb-6">{selectedStudent.name}</h2>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Previous Notes */}
                <div>
                  {loading ? (
                    <div className="bg-gray-100 rounded-lg p-6 animate-pulse">
                      <div className="h-4 bg-gray-300 rounded w-3/4 mb-2"></div>
                      <div className="h-4 bg-gray-300 rounded w-full mb-2"></div>
                      <div className="h-4 bg-gray-300 rounded w-5/6"></div>
                    </div>
                  ) : (
                    lastNotes && (
                      <NotesPanel
                        key={selectedStudent.mms_id}
                        notes={lastNotes}
                        source={notesSource}
                        studentName={selectedStudent.name || ''}
                        onLoadHistory={async () => {
                          const res = await fetch(notesUrlForStudent(selectedStudent, { history: true }));
                          const data = await res.json();
                          return data.history || [];
                        }}
                        onLoadSummary={async () => {
                          const res = await fetch(notesUrlForStudent(selectedStudent, { summary: true }));
                          const data = await res.json();
                          return data.summary || null;
                        }}
                        onHistoryOpened={() => {
                          setPriorNoteReview((current) => ({ ...current, historyOpened: true }));
                        }}
                        priorRating={{
                          show: shouldAskPriorRating({
                            tutor,
                            student: selectedStudent,
                            notes: lastNotes,
                            answered: priorNoteReview.ratingAnswered,
                          }),
                          // Both paths are fire-and-forget: an evaluation answer
                          // must never interrupt a tutor mid-lesson, so a failed
                          // write is dropped rather than surfaced.
                          onAnswer: (rating) => {
                            setPriorNoteReview((current) => ({ ...current, ratingAnswered: true }));
                            fetch(notesUrlForStudent(selectedStudent, { priorRating: true }), {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ rating }),
                            }).catch(() => {});
                          },
                          onSkip: () => {
                            setPriorNoteReview((current) => ({ ...current, ratingAnswered: true }));
                            fetch(notesUrlForStudent(selectedStudent, { priorRating: true }), {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ skipped: true }),
                            }).catch(() => {});
                          },
                        }}
                      />
                    )
                  )}
                </div>

                {/* Quick Links */}
                <div>
                  <QuickLinks
                    student={selectedStudent}
                    activeTutor={tutor}
                    onOpenPracticeChat={(url, name) => setPracticeChatPanel({ url, name, completed: false })}
                    priorNote={{
                      exists: Boolean(lastNotes),
                      ageDays: priorNoteAgeDays(lastNotes),
                      historyOpened: priorNoteReview.historyOpened,
                    }}
                  />
                </div>
              </div>

              <NewsletterCapture
                student={selectedStudent}
                onSaved={() => setNewsletterRefreshKey((key) => key + 1)}
              />

              <SongBrowser student={selectedStudent} />

            </div>
          ) : (
            <div className="flex min-h-full items-center justify-center p-6">
              <div className="flex w-full max-w-3xl flex-col items-center gap-6">
                <NewsletterStrip issue={newsletterIssue} students={students} onSelectStudent={handleSelectStudent} />
                <TutorSchedulePanel
                  tutor={tutor}
                  students={students}
                  onSelectStudent={handleSelectStudent}
                />
                <div className="text-center">
                  <p className="text-xl font-semibold text-slate-950">{todaySummary.headline}</p>
                  <p className="mt-1 text-sm text-slate-900">{todaySummary.hint}</p>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {practiceChatPanel ? (
        <div className="fixed inset-0 z-50 flex">
          <style jsx>{`
            @keyframes panel-slide-in {
              from { transform: translateX(24px); opacity: 0; }
              to { transform: translateX(0); opacity: 1; }
            }
            @keyframes overlay-fade-in {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            .practice-chat-overlay {
              animation: overlay-fade-in 0.2s ease-out;
            }
            .practice-chat-panel {
              animation: panel-slide-in 0.25s ease-out;
            }
          `}</style>
          <div
            className="practice-chat-overlay flex-1 bg-slate-900/25 backdrop-blur-[1px]"
            onClick={() => setPracticeChatPanel(null)}
            aria-hidden
          />
          <aside className="practice-chat-panel flex h-full w-full max-w-3xl flex-col border-l border-green-100 bg-white shadow-2xl">
            <header className="flex items-center justify-between gap-3 border-b border-green-100 bg-gradient-to-r from-green-50 to-blue-50 px-5 py-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-[#2F6B3D]">Practice Chat</p>
                <p className="text-sm font-bold text-slate-900">{practiceChatPanel.name}</p>
              </div>
              <div className="flex items-center gap-2">
                {practiceChatPanel.completed ? (
                  <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 shadow-sm">
                    {practiceChatPanel.completedStatus === 'absent_no_makeup' ? 'Attendance saved' : 'Lesson done'} ✓ Closing...
                  </div>
                ) : null}
                <a
                  href={practiceChatPanel.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-green-200 bg-white/90 px-3 py-1.5 text-xs font-bold text-[#2F6B3D] transition hover:bg-white"
                >
                  Open full page
                </a>
                <button
                  type="button"
                  onClick={() => setPracticeChatPanel(null)}
                  className="rounded-lg border border-green-200 bg-white/90 px-3 py-1.5 text-xs font-bold text-[#2F6B3D] transition hover:bg-white"
                >
                  Close
                </button>
              </div>
            </header>
            <iframe
              key={practiceChatPanel.url}
              src={practiceChatPanel.url}
              title={`Practice Chat: ${practiceChatPanel.name}`}
              allow="microphone; clipboard-read; clipboard-write"
              className="h-full w-full flex-1 border-0"
            />
          </aside>
        </div>
      ) : null}

      {/* First Chord Logo - Bottom Right Corner (decorative; never blocks content) */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-0 hidden lg:block">
        <Image
          src="/first-chord-banner.png"
          alt="First Chord Music School - Explore Music Together"
          width={220}
          height={124}
          className="rounded-lg opacity-80"
          priority={false}
        />
      </div>
    </TimeOfDaySky>
  );
}
