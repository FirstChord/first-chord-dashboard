import Image from 'next/image';
import { ExternalLink } from 'lucide-react';
import { generateSmartUrls } from '@/lib/config';
import { resolvePracticeChatAsrModel } from '@/lib/config/practice-chat-asr.mjs';
import { appendPracticeChatEvaluationParams } from '@/lib/config/practice-chat-eval.mjs';

const CANONICAL_PRACTICE_CHAT_DASHBOARD_BASE_URL =
  process.env.NEXT_PUBLIC_PRACTICE_CHAT_DASHBOARD_BASE_URL
  || 'https://first-chord-dashbord-production.up.railway.app';

// Identifies the Practice Chat row without matching on its visible label, which
// is copy and changes.
const PRACTICE_CHAT_LINK_ID = 'practice-chat';

function isLocalDashboardHost(hostname = '') {
  return ['localhost', '127.0.0.1'].includes(hostname);
}

function getPracticeChatDashboardBaseUrl() {
  if (typeof window !== 'undefined' && isLocalDashboardHost(window.location.hostname)) {
    return window.location.origin;
  }

  return CANONICAL_PRACTICE_CHAT_DASHBOARD_BASE_URL.replace(/\/+$/u, '');
}

function buildPracticeChatUrl(student, activeTutor = '', priorNote = null) {
  const params = new URLSearchParams();
  const dashboardBaseUrl = getPracticeChatDashboardBaseUrl();
  const practiceChatBaseUrl = typeof window !== 'undefined' && isLocalDashboardHost(window.location.hostname)
    ? 'http://localhost:8000'
    : 'https://practice-chat-pwa.web.app';

  if (student?.mms_id) params.set('studentId', student.mms_id);
  if (student?.name) params.set('studentName', student.name);
  const tutorName = activeTutor || student?.current_tutor || student?.currentTutor || student?.tutor || student?.Tutor || '';
  if (tutorName) params.set('tutor', tutorName);
  params.set('dashboardBaseUrl', dashboardBaseUrl);
  if (process.env.NEXT_PUBLIC_PRACTICE_CHAT_API_SECRET) {
    params.set('practiceChatSecret', process.env.NEXT_PUBLIC_PRACTICE_CHAT_API_SECRET);
  }
  // Only present during a transcription trial; absent the whole rest of the
  // time, so the PWA uses its own default.
  const asrModel = resolvePracticeChatAsrModel(process.env.NEXT_PUBLIC_PRACTICE_CHAT_ASR_MODEL);
  if (asrModel) {
    params.set('asrModel', asrModel);
  }

  appendPracticeChatEvaluationParams(params, { tutorName, priorNote });

  return `${practiceChatBaseUrl}/?${params.toString()}`;
}

export default function QuickLinks({ student, activeTutor = '', onOpenPracticeChat, priorNote = null }) {
  // Early return if no student is provided
  if (!student) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-lg font-semibold mb-4">Quick Links</h3>
        <p className="text-gray-500">Select a student to view quick links</p>
      </div>
    );
  }

  const smartUrls = {
    soundslice: generateSmartUrls.soundslice(student),
  };

  const links = [
    {
      name: "Soundslice Folder",
      icon: (
        <Image
          src="/soundslice-flag.png"
          alt=""
          width={138}
          height={160}
          className="h-14 w-14 object-contain"
        />
      ),
      url: smartUrls.soundslice.url,
      instruction: smartUrls.soundslice.instruction,
    },
    {
      id: PRACTICE_CHAT_LINK_ID,
      name: "Take Attendance + Practice Chat!",
      icon: (
        <Image
          src="/practice-chat-readers.png"
          alt=""
          width={152}
          height={160}
          className="h-14 w-14 object-contain"
        />
      ),
      url: buildPracticeChatUrl(student, activeTutor, priorNote),
      instruction: "Mark the register and take homework notes",
    },
    ...(student.instrument === 'Piano' ? [{
      name: "Piano Handbook",
      icon: (
        <Image
          src="/piano-handbook.png"
          alt=""
          width={174}
          height={160}
          className="h-14 w-14 object-contain"
        />
      ),
      url: "https://canva.link/fkczhbdl8kv75d7",
      instruction: "Tutor resource for piano lessons",
    }] : [])
    // Seasonal show link. Keep hidden until the next show; update copy/form URL before re-enabling.
    /*
    ,{
      name: "Summer Show!",
      icon: <Star className="w-5 h-5 fill-yellow-400" />,
      url: "https://docs.google.com/forms/d/1fUaaHgOGDrpo-JWTxd9rYqDnfY6LQyyzx09rwqQilZM/viewform",
      instruction: "Let us know what song you would like to play at the First Chord Summer Show (28th of June)!",
      requiresAuth: false,
      color: "bg-gradient-to-r from-yellow-400 to-orange-500",
      isSummer: true
    }
    */
  ];

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-gray-800 mb-3">Quick Access</h3>
      {links.map((link) => (
        <a
          key={link.name}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={
            link.id === PRACTICE_CHAT_LINK_ID && onOpenPracticeChat
              ? (e) => {
                  e.preventDefault();
                  onOpenPracticeChat(link.url, student.name || 'Practice Chat');
                }
              : undefined
          }
          className="flex items-center gap-3 p-4 bg-white rounded-lg border border-[#2F6B3D]/25 hover:border-[#2F6B3D]/50 hover:shadow-md transition-all group"
        >
          <div className="shrink-0">
            {link.icon}
          </div>
          <div className="flex-1">
            <div className="font-medium">{link.name}</div>
            <div className="text-sm text-gray-500">{link.instruction}</div>
          </div>
          <ExternalLink className="w-4 h-4 text-gray-400 group-hover:text-gray-600" />
        </a>
      ))}
    </div>
  );
}
