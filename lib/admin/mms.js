/** @fileoverview Server-side My Music Staff adapter for student, calendar, attendance, billing-profile, and lesson workflows. */
import {
  addDaysToCalendarDate,
  buildBillingProfilePayload,
  buildCalendarEventPayload,
  buildCalendarEventSearchPayload,
  findFreeCalendarOccurrence,
  findMatchingCalendarEvent,
  formatMmsErrorBody,
  parseNoteFields,
  validateMmsFreeCalendarEvent,
} from './mms-helpers.mjs';
import { deriveScheduleContextFromMms } from './schedule-context-helpers.mjs';
import { isFreeCalendarEvent, normaliseFreeCalendarSlot, parseAvailabilityDays, parseAvailabilityTimes } from './capacity-helpers.mjs';
import { parseInstrumentList } from './fc-helpers.mjs';
import { getMmsBearerToken } from '../mms-token.js';
import { createSwrCache } from './swr-cache.mjs';
import { fetchAllPages } from './mms-pagination.mjs';
import {
  buildAttendanceSearchEndDate,
  buildPracticeNoteAttendancePayload,
  buildPracticeNoteEmailRecipients,
  describePracticeNoteAttendanceSelection,
  formatPracticeNoteHtml,
  listPracticeNoteAttendanceCandidates,
  selectPracticeNoteAttendanceTarget,
} from './practice-notes-mms-helpers.mjs';
import {
  assertPracticeNotesEmailConfigured,
  sendPracticeNoteEmail,
} from './practice-notes-email.js';

const MMS_BASE_URL = process.env.MMS_BASE_URL || 'https://api.mymusicstaff.com/v1';
const FREE_CALENDAR_SLOT_CACHE_TTL_MS = 10 * 60 * 1000;
const freeCalendarSlotCache = new Map();
const MMS_FREE_SLOT_DELETE_OPTIONS = Object.freeze({
  DeletionLogReason: 'IndividualEvent',
  DeletionType: 'Future',
  NotificationNote: null,
  NotifyParentsByEmail: false,
  NotifyParentsBySMS: false,
  NotifyStudentsByEmail: false,
  NotifyStudentsBySMS: false,
  NotifyTeacherByEmail: false,
  NotifyTeacherBySMS: false,
});

// Cache for the payroll attendance search, keyed by query params. The fetch range
// is fixed by the pay date, so re-rendering the payroll page — on every "Mark
// reviewed" save, which calls revalidatePath, and on every window tweak — was
// re-fetching the same ~950-row MMS query to redraw a preview that hadn't changed.
//
// Same policy as the read cache in `lib/admin/sheets/core.mjs`, via the shared
// `createSwrCache`: a TTL, then a stale-while-revalidate window where a cached
// result is served immediately and refreshed in the background, plus in-flight
// coalescing so concurrent renders share one fetch. Net effect: a save never
// blocks on MMS.
//
// The TTL used to be 60s so a lesson just recorded in MMS showed up quickly. That
// is a wall-clock timer firing at random points in an admin's review session (60s
// is about one "read the invoice, click next" cycle), so it made the page feel
// randomly slow. The "Refresh from MMS" control (`?refresh=1` → forceRefresh)
// serves that intent deliberately instead, so the TTL can be generous.
// One request should cover a whole payroll window; paging is the safety net, not
// the plan. The 35-day window measured 951 rows on 2026-08-01, so this is ~2x
// headroom — the school would have to roughly double before a second round trip
// is needed, and MMS honours a limit well above this (3,194 rows came back in a
// single 3.1s request, against 2.3s for a 1,000-row one: request overhead
// dominates, row count barely registers).
//
// Sizing this is a latency decision, not a correctness one, *because*
// fetchPayrollAttendance verifies against TotalItemCount. Under the old
// short-page heuristic raising it would have risked silent truncation. Raise it
// freely; do not lower it back to 1000 thinking that is the safer number.
export const PAYROLL_ATTENDANCE_PAGE_SIZE = 2000;
export const LESSON_MIRROR_MMS_PAGE_SIZE = 2000;
const PAYROLL_ATTENDANCE_CACHE_TTL_MS = 10 * 60 * 1000;
// Beyond TTL + this window a cached result is too old to serve at all; the caller
// waits for a fresh fetch rather than seeing yesterday's attendance.
const PAYROLL_ATTENDANCE_STALE_WHILE_REVALIDATE_MS = 20 * 60 * 1000;
const payrollAttendanceCache = createSwrCache({
  ttlMs: PAYROLL_ATTENDANCE_CACHE_TTL_MS,
  staleWhileRevalidateMs: PAYROLL_ATTENDANCE_STALE_WHILE_REVALIDATE_MS,
  scopeOf: () => 'payroll-attendance',
  label: 'MMS payroll attendance',
});

function getMmsHeaders() {
  const token = getMmsBearerToken();

  if (!token) {
    throw new Error('MMS_BEARER_TOKEN is not configured');
  }

  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/plain, */*',
    'x-schoolbox-version': 'main',
  };
}

// Ceiling on any single MMS request. Generous next to a real one — the biggest
// call we make (a 35-day, 16-tutor payroll attendance page, ~950 rows) measured
// 4.7s — because this is not here to police slowness. It is here so a stalled
// connection fails instead of hanging: `fetch` has no default timeout, so an
// MMS request that never answers hangs the render behind it forever, and the
// only symptom a human gets is a spinner that never stops.
const MMS_REQUEST_TIMEOUT_DEFAULT_MS = 30_000;

// Read per call rather than at import, so `MMS_REQUEST_TIMEOUT_MS` can be tuned
// on Railway without a code change (and so tests can use a short one).
function mmsRequestTimeoutMs() {
  const configured = Number.parseInt(process.env.MMS_REQUEST_TIMEOUT_MS || '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : MMS_REQUEST_TIMEOUT_DEFAULT_MS;
}

// Every MMS call goes through here so the timeout policy has one home. An abort
// surfaces as a plain, readable Error: these messages reach the admin UI (the
// payroll page prints `loadError` verbatim), so "MMS did not respond within 30s"
// beats a bare TimeoutError.
async function mmsFetch(url, init = {}) {
  const timeoutMs = mmsRequestTimeoutMs();
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error(`MMS did not respond within ${Math.round(timeoutMs / 1000)}s — it may be down or unusually slow. Try again in a moment.`);
    }
    if (error?.name === 'TypeError') {
      throw new Error(`Could not reach MMS: ${error.message}`);
    }
    throw error;
  }
}

function daysSince(date) {
  const now = new Date();
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function parseMmsDate(dateString) {
  if (!dateString) return null;
  const parsed = new Date(dateString);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseWaitingInstruments(note = '') {
  const parsed = parseNoteFields(note);
  const rawInstrument = parsed.instrument || '';
  if (!rawInstrument) return { rawInstrument: '', instruments: [], parsed };

  return {
    rawInstrument,
    // Shared with onboarding so both surfaces read the same instruments out of
    // the same note.
    instruments: parseInstrumentList(rawInstrument),
    parsed,
  };
}

function normaliseWaitingStudent(student) {
  const family = student.Family || {};
  const parent = (family.Parents || [])[0] || {};
  const parentEmail = parent.Email || {};
  const parentTelephone =
    parent.MobileTelephone?.TelephoneNumber ||
    parent.HomeTelephone?.TelephoneNumber ||
    parent.WorkTelephone?.TelephoneNumber ||
    '';
  const studentTelephone = student.Telephone?.TelephoneNumber || '';
  const dateStarted = parseMmsDate(student.DateStarted);
  const ageInDays = dateStarted ? daysSince(dateStarted) : null;
  const instrumentContext = parseWaitingInstruments(student.Note || '');

  return {
    mmsId: student.ID || '',
    firstName: student.FirstName || '',
    lastName: student.LastName || '',
    fullName: `${student.FirstName || ''} ${student.LastName || ''}`.trim(),
    parentFirstName: parent.FirstName || '',
    parentLastName: parent.LastName || '',
    parentName: parent.FormalName || `${parent.FirstName || ''} ${parent.LastName || ''}`.trim(),
    parentEmail: parentEmail.EmailAddress || '',
    parentTelephone,
    studentTelephone,
    contactNumber: studentTelephone || parentTelephone,
    dateStarted: dateStarted ? dateStarted.toISOString() : '',
    ageInDays,
    note: student.Note || '',
    parsedNote: instrumentContext.parsed || {},
    instrumentRaw: instrumentContext.rawInstrument,
    instruments: instrumentContext.instruments,
    availabilityDays: parseAvailabilityDays(instrumentContext.parsed?.preferredDays || ''),
    availabilityTimes: parseAvailabilityTimes(instrumentContext.parsed?.preferredTimes || ''),
  };
}

export async function getWaitingStudents({ maxAgeDays = 120 } = {}) {
  const response = await mmsFetch(`${MMS_BASE_URL}/search/students?offset=0&limit=100&fields=Family,StudentGroups,SubjectTypes&orderby=-DateStarted`, {
    method: 'POST',
    headers: getMmsHeaders(),
    body: JSON.stringify({
      IDs: [],
      SearchText: '',
      FirstName: null,
      LastName: null,
      EmailAddress: null,
      Statuses: ['Waiting'],
      StudentGroupIDs: [],
      TeacherIDs: [],
      FamilyIDs: [],
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`MMS waiting list request failed: ${response.status}`);
  }

  const payload = await response.json();
  const cutoff = maxAgeDays ? Date.now() - maxAgeDays * 24 * 60 * 60 * 1000 : null;

  return (payload.ItemSubset || [])
    .map(normaliseWaitingStudent)
    .filter((student) => {
      if (!cutoff || !student.dateStarted) return true;
      return new Date(student.dateStarted).getTime() >= cutoff;
    });
}

export async function checkMmsHealth() {
  const response = await mmsFetch(`${MMS_BASE_URL}/search/students?offset=0&limit=1`, {
    method: 'POST',
    headers: getMmsHeaders(),
    body: JSON.stringify({
      IDs: [],
      SearchText: '',
      FirstName: null,
      LastName: null,
      EmailAddress: null,
      Statuses: [],
      StudentGroupIDs: [],
      TeacherIDs: [],
      FamilyIDs: [],
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`MMS health request failed: ${response.status}`);
  }

  return {
    status: 'Healthy',
    detail: 'MMS API credentials are responding.',
    checkedAt: new Date().toISOString(),
  };
}

export async function getStudentDetails(mmsId) {
  const response = await mmsFetch(`${MMS_BASE_URL}/students/${mmsId}?fields=Family`, {
    headers: getMmsHeaders(),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`MMS student details request failed: ${response.status}`);
  }

  const data = await response.json();
  const family = data.Family || {};
  const parent = (family.Parents || [])[0] || {};
  const parentEmail = parent.Email || {};
  const note = data.Note || '';
  const parsed = parseNoteFields(note);
  const parentTelephone =
    parent.MobileTelephone?.TelephoneNumber ||
    parent.HomeTelephone?.TelephoneNumber ||
    parent.WorkTelephone?.TelephoneNumber ||
    '';

  return {
    mmsId: data.ID || '',
    status: data.Status || '',
    firstName: data.FirstName || '',
    lastName: data.LastName || '',
    fullName: `${data.FirstName || ''} ${data.LastName || ''}`.trim(),
    studentEmail: data.Email?.EmailAddress || '',
    studentTelephone: data.Telephone?.TelephoneNumber || '',
    parentFirstName: parent.FirstName || '',
    parentLastName: parent.LastName || '',
    parentName: parent.FormalName || `${parent.FirstName || ''} ${parent.LastName || ''}`.trim(),
    parentEmail: parentEmail.EmailAddress || '',
    parentTelephone,
    dateStarted: data.DateStarted || '',
    note,
    parsed,
  };
}

async function getStudentRecord(mmsId) {
  const response = await mmsFetch(`${MMS_BASE_URL}/students/${mmsId}?fields=Family,StudentGroups,AccessStatus,BillingProfiles,BlockedRecipientType,NextEventDate`, {
    headers: getMmsHeaders(),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`MMS student record request failed: ${response.status}`);
  }

  return response.json();
}

async function parseMmsResponse(response) {
  const text = await response.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function searchCalendarEvents({ studentId, teacherId, lessonDate }) {
  const studentIds = Array.isArray(studentId) ? studentId.filter(Boolean) : studentId ? [studentId] : [];
  const response = await mmsFetch(`${MMS_BASE_URL}/search/calendar/events`, {
    method: 'POST',
    headers: getMmsHeaders(),
    body: JSON.stringify(
      buildCalendarEventSearchPayload({
        studentIds,
        teacherId,
        lessonDate,
      }),
    ),
    cache: 'no-store',
  });

  const responseBody = await parseMmsResponse(response);

  if (!response.ok) {
    const details = formatMmsErrorBody(responseBody);
    throw new Error(`MMS calendar event search failed: ${response.status}${details ? ` - ${details}` : ''}`);
  }

  return responseBody?.ItemSubset || [];
}

function requireMmsSearchWindow({ startDate, endDateExclusive, label }) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(`${startDate || ''}`) || !/^\d{4}-\d{2}-\d{2}$/u.test(`${endDateExclusive || ''}`)) {
    throw new Error(`${label}: startDate and endDateExclusive must be YYYY-MM-DD dates`);
  }
  if (startDate >= endDateExclusive) {
    throw new Error(`${label}: endDateExclusive must be after startDate`);
  }
}

function requiredReportedTotal(responseBody, label) {
  const raw = responseBody?.TotalItemCount ?? responseBody?.TotalCount;
  const total = typeof raw === 'string' && /^\d+$/u.test(raw) ? Number(raw) : raw;
  if (!Number.isInteger(total) || total < 0) {
    throw new Error(`${label}: MMS did not report a valid total; refusing an unverified result`);
  }
  return total;
}

async function fetchMmsCalendarEventsWindow({
  studentIds = [],
  teacherId = '',
  startDate,
  endDateExclusive,
  pageSize = LESSON_MIRROR_MMS_PAGE_SIZE,
  maxPages = 20,
} = {}) {
  requireMmsSearchWindow({ startDate, endDateExclusive, label: 'MMS calendar' });
  let reportedTotal = null;
  const rows = await fetchAllPages(async ({ offset, limit }) => {
    const response = await mmsFetch(`${MMS_BASE_URL}/search/calendar/events?offset=${offset}&limit=${limit}`, {
      method: 'POST',
      headers: getMmsHeaders(),
      body: JSON.stringify({
        ...buildCalendarEventSearchPayload({
          studentIds,
          teacherId,
          lessonDate: startDate,
        }),
        EndDate: endDateExclusive,
      }),
      cache: 'no-store',
    });
    const responseBody = await parseMmsResponse(response);
    if (!response.ok) {
      const details = formatMmsErrorBody(responseBody);
      throw new Error(`MMS calendar event search failed: ${response.status}${details ? ` - ${details}` : ''}`);
    }
    reportedTotal = requiredReportedTotal(responseBody, 'MMS calendar');
    return { rows: responseBody?.ItemSubset || [], total: reportedTotal };
  }, { pageSize, maxPages, label: 'MMS calendar' });
  return { rows, reportedTotal };
}

async function searchCalendarEventsInRange({ studentId, teacherId = '', startDate, endDate, limit = 100 }) {
  const studentIds = Array.isArray(studentId) ? studentId.filter(Boolean) : studentId ? [studentId] : [];
  const result = await fetchMmsCalendarEventsWindow({
    studentIds,
    teacherId,
    startDate,
    endDateExclusive: endDate,
    pageSize: limit,
    maxPages: 100,
  });
  return result.rows;
}

export async function searchMmsLessonCalendar({
  startDate,
  endDateExclusive,
  pageSize = LESSON_MIRROR_MMS_PAGE_SIZE,
  maxPages = 20,
} = {}) {
  return fetchMmsCalendarEventsWindow({ startDate, endDateExclusive, pageSize, maxPages });
}

export async function searchMmsLessonAttendance({
  startDate,
  endDateExclusive,
  pageSize = LESSON_MIRROR_MMS_PAGE_SIZE,
  maxPages = 20,
} = {}) {
  requireMmsSearchWindow({ startDate, endDateExclusive, label: 'MMS attendance' });
  let reportedTotal = null;
  const rows = await fetchAllPages(async ({ offset, limit }) => {
    const response = await mmsFetch(`${MMS_BASE_URL}/search/attendance?offset=${offset}&limit=${limit}&orderby=EventStartDate`, {
      method: 'POST',
      headers: getMmsHeaders(),
      body: JSON.stringify({
        StartDate: startDate,
        EndDate: endDateExclusive,
        EventIDs: [],
        EventSeriesIDs: null,
        EventCategoryIDs: [],
        OriginalTeacherIDs: [],
        StudentIDs: [],
        TeacherIDs: [],
        HasVisibleLessonNotes: null,
        Statuses: [],
        IDs: [],
        StartTime: null,
        EndTime: null,
        HasAttachments: null,
      }),
      cache: 'no-store',
    });
    const responseBody = await parseMmsResponse(response);
    if (!response.ok) {
      const details = formatMmsErrorBody(responseBody);
      throw new Error(`MMS lesson attendance search failed: ${response.status}${details ? ` - ${details}` : ''}`);
    }
    reportedTotal = requiredReportedTotal(responseBody, 'MMS attendance');
    return { rows: responseBody?.ItemSubset || [], total: reportedTotal };
  }, { pageSize, maxPages, label: 'MMS attendance' });
  return { rows, reportedTotal };
}

async function searchStudentAttendance({ studentId, endDate = formatDate(new Date()), limit = 25 } = {}) {
  const response = await mmsFetch(`${MMS_BASE_URL}/search/attendance?offset=0&limit=${limit}&fields=Charge,Payment&orderby=-EventStartDate`, {
    method: 'POST',
    headers: getMmsHeaders(),
    body: JSON.stringify({
      StartDate: null,
      EndDate: endDate,
      EventIDs: [],
      EventSeriesIDs: null,
      EventCategoryIDs: [],
      OriginalTeacherIDs: [],
      StudentIDs: [studentId],
      TeacherIDs: [],
      HasVisibleLessonNotes: null,
      Statuses: [],
      IDs: [],
      StartTime: null,
      EndTime: null,
      HasAttachments: null,
    }),
    cache: 'no-store',
  });

  const responseBody = await parseMmsResponse(response);

  if (!response.ok) {
    const details = formatMmsErrorBody(responseBody);
    throw new Error(`MMS attendance search failed: ${response.status}${details ? ` - ${details}` : ''}`);
  }

  return responseBody?.ItemSubset || [];
}

// MMS compares EndDate against EventStartDate at midnight, so an EndDate of
// 2026-07-07 excludes every lesson taught *on* the 7th. Payroll windows are
// inclusive of periodEnd (a Wednesday run covers through the Tuesday), so shift
// the bound one day forward before handing it to MMS. Callers pass — and the
// cache keys on — the inclusive end date they mean.
function exclusiveEndDate(endDate) {
  const parsed = new Date(`${endDate}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return endDate;
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

// Paginated, and completeness is *verified* rather than inferred: this hands
// fetchAllPages the endpoint's own `TotalItemCount` alongside the rows, so a
// short response is a loud error instead of a quietly short payroll. See
// mms-pagination.mjs for why that distinction carries the weight here.
async function fetchPayrollAttendance({ startDate, endDate, teacherIds, limit }) {
  return fetchAllPages(async ({ offset, limit: pageLimit }) => {
    const response = await mmsFetch(`${MMS_BASE_URL}/search/attendance?offset=${offset}&limit=${pageLimit}&fields=Charge,Payment&orderby=EventStartDate`, {
      method: 'POST',
      headers: getMmsHeaders(),
      body: JSON.stringify({
        StartDate: startDate,
        EndDate: exclusiveEndDate(endDate),
        EventIDs: [],
        EventSeriesIDs: null,
        EventCategoryIDs: [],
        OriginalTeacherIDs: [],
        StudentIDs: [],
        TeacherIDs: teacherIds,
        HasVisibleLessonNotes: null,
        Statuses: [],
        IDs: [],
        StartTime: null,
        EndTime: null,
        HasAttachments: null,
      }),
      cache: 'no-store',
    });

    const responseBody = await parseMmsResponse(response);

    if (!response.ok) {
      const details = formatMmsErrorBody(responseBody);
      throw new Error(`MMS payroll attendance search failed: ${response.status}${details ? ` - ${details}` : ''}`);
    }

    return { rows: responseBody?.ItemSubset || [], total: responseBody?.TotalItemCount };
  }, { pageSize: limit, label: 'MMS payroll attendance' });
}

function payrollAttendanceCacheKey({ startDate, endDate, teacherIds = [], limit = PAYROLL_ATTENDANCE_PAGE_SIZE }) {
  const cleanTeacherIds = Array.isArray(teacherIds) ? teacherIds.filter(Boolean) : [];
  return JSON.stringify({ startDate, endDate, limit, teacherIds: [...cleanTeacherIds].sort() });
}

// Stale-but-serveable results hand back what we have and refresh behind the
// request, so a "Mark reviewed" save never waits on a ~950-row MMS fetch; the
// shared cache also guarantees a failed background refresh never rejects into
// the render.
//
// `allowExpired` extends that past the hard max age. The payroll page uses it
// because a save re-renders the whole page inside its own POST — the button
// spinner lasts exactly as long as that render, so a cold fetch there turned a
// ~1s save into a ~7s one. Freshness is not lost, only deferred: the refresh
// still runs behind the request, "↻ Refresh MMS & recalculate" is the
// deliberate wait, and the page says so when what it served is genuinely old.
export async function searchAttendanceForPayroll({
  startDate,
  endDate,
  teacherIds = [],
  limit = PAYROLL_ATTENDANCE_PAGE_SIZE,
  forceRefresh = false,
  allowExpired = false,
} = {}) {
  if (!startDate || !endDate) {
    throw new Error('startDate and endDate are required for payroll attendance search');
  }

  const cleanTeacherIds = Array.isArray(teacherIds) ? teacherIds.filter(Boolean) : [];
  const cacheKey = payrollAttendanceCacheKey({ startDate, endDate, teacherIds: cleanTeacherIds, limit });

  return payrollAttendanceCache.read(
    cacheKey,
    () => fetchPayrollAttendance({ startDate, endDate, teacherIds: cleanTeacherIds, limit }),
    { force: forceRefresh, allowExpired },
  );
}

// How old the cached rows for a query are, so a page serving deliberately stale
// attendance can say so. Null when nothing is cached (the caller just fetched).
export function peekPayrollAttendanceAge(query = {}) {
  return payrollAttendanceCache.stat(payrollAttendanceCacheKey(query));
}

export function clearPayrollAttendanceCacheForTests() {
  payrollAttendanceCache.clear();
}

export function invalidatePayrollAttendanceCache() {
  payrollAttendanceCache.invalidateScope('payroll-attendance');
}

// After an accepted attendance write, fold the new status into the cached rows
// rather than dropping them. Recording a lesson is followed immediately by a
// router.refresh(), and invalidating meant that refresh paid a full ~950-row
// MMS fetch (4.7s) to learn one field we had just set ourselves.
//
// `AttendanceStatus` is the only field payroll classification reads
// (`mapAttendanceRow` → `resolveSlotState`), so this is a complete patch for
// what the page shows, not a partial one — and it is only ever applied after
// MMS has returned OK for that exact row. The entry is left stale so MMS still
// gets the last word on the next read.
export function applyPayrollAttendanceStatusToCache({ attendanceId = '', eventId = '', attendanceStatus = '' } = {}) {
  if (!attendanceId || !attendanceStatus) return 0;
  return payrollAttendanceCache.patchScopeStale('payroll-attendance', (rows) => {
    if (!Array.isArray(rows)) return undefined;
    let changed = false;
    const next = rows.map((row) => {
      if (`${row?.ID || ''}` !== attendanceId) return row;
      if (eventId && `${row?.EventID || ''}` !== eventId) return row;
      changed = true;
      return { ...row, AttendanceStatus: attendanceStatus };
    });
    return changed ? next : undefined;
  });
}

export async function updatePayrollAttendanceStatus({
  studentId = '',
  eventId = '',
  attendanceId = '',
  attendanceStatus = '',
} = {}) {
  const allowedStatuses = new Set(['Present', 'AbsentNoMakeup', 'AbsentNotice']);
  if (!studentId || !eventId || !attendanceId) {
    throw new Error('Student, event and attendance IDs are required');
  }
  if (!allowedStatuses.has(attendanceStatus)) {
    throw new Error('Unsupported payroll attendance status');
  }

  const records = await searchStudentAttendance({
    studentId,
    endDate: buildAttendanceSearchEndDate(new Date()),
    limit: 100,
  });
  const attendance = records.find((row) => (
    `${row.ID || ''}` === attendanceId
    && `${row.EventID || ''}` === eventId
    && `${row.StudentID || row.Student?.ID || ''}` === studentId
  ));
  if (!attendance) {
    throw new Error('The matching MMS attendance record could not be found');
  }

  const response = await mmsFetch(`${MMS_BASE_URL}/events/${eventId}/attendance/${attendanceId}`, {
    method: 'PUT',
    headers: getMmsHeaders(),
    body: JSON.stringify({
      TeacherNote: attendance.TeacherNote || '',
      ParentNote: attendance.ParentNote || '',
      StudentNote: attendance.StudentNote || '',
      AttendanceStatus: attendanceStatus,
    }),
    cache: 'no-store',
  });
  const responseBody = await parseMmsResponse(response);
  if (!response.ok) {
    const details = formatMmsErrorBody(responseBody);
    throw new Error(`MMS attendance update failed: ${response.status}${details ? ` - ${details}` : ''}`);
  }

  // Patch the cached rows so the refresh that follows this call is instant.
  // If the row isn't in any cached window there is nothing to correct, so fall
  // back to invalidating rather than leaving a cache we haven't reconciled.
  if (!applyPayrollAttendanceStatusToCache({ attendanceId, eventId, attendanceStatus })) {
    invalidatePayrollAttendanceCache();
  }
  return { ok: true, attendanceStatus };
}

function formatDate(value) {
  return value.toISOString().slice(0, 10);
}

function addDaysToInputDate(date, days) {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  parsed.setDate(parsed.getDate() + days);
  return formatDate(parsed);
}

export async function getMmsStudentScheduleContext({ mmsId, lookaheadDays = 60 } = {}) {
  if (!mmsId) {
    throw new Error('MMS ID is required for schedule refresh');
  }

  const checkedAt = new Date().toISOString();
  const start = new Date();
  const end = new Date(start.getTime() + lookaheadDays * 24 * 60 * 60 * 1000);
  const [student, events] = await Promise.all([
    getStudentRecord(mmsId),
    searchCalendarEventsInRange({
      studentId: mmsId,
      startDate: formatDate(start),
      endDate: formatDate(end),
    }),
  ]);

  return deriveScheduleContextFromMms({
    student,
    events,
    checkedAt,
    lookaheadDays,
  });
}

async function fetchMmsFreeCalendarSlots({ lookaheadDays = 30, limit = 500 } = {}) {
  const start = new Date();
  const end = new Date(start.getTime() + lookaheadDays * 24 * 60 * 60 * 1000);
  const events = await searchCalendarEventsInRange({
    startDate: formatDate(start),
    endDate: formatDate(end),
    limit,
  });

  return events
    .filter(isFreeCalendarEvent)
    .map(normaliseFreeCalendarSlot)
    .filter((slot) => slot.studentCount === 0)
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
}

function buildFreeCalendarSlotCacheKey({ lookaheadDays, limit }) {
  return `${lookaheadDays}:${limit}`;
}

export async function getMmsFreeCalendarSlotContext({
  lookaheadDays = 30,
  limit = 500,
  forceRefresh = false,
  ttlMs = FREE_CALENDAR_SLOT_CACHE_TTL_MS,
} = {}) {
  const cacheKey = buildFreeCalendarSlotCacheKey({ lookaheadDays, limit });
  const now = Date.now();
  const cached = freeCalendarSlotCache.get(cacheKey);

  if (!forceRefresh && cached && cached.expiresAtMs > now) {
    return {
      ...cached.value,
      fromCache: true,
      expiresAt: new Date(cached.expiresAtMs).toISOString(),
    };
  }

  const slots = await fetchMmsFreeCalendarSlots({ lookaheadDays, limit });
  const fetchedAt = new Date().toISOString();
  const expiresAtMs = now + ttlMs;
  const context = {
    slots,
    fetchedAt,
    expiresAt: new Date(expiresAtMs).toISOString(),
    fromCache: false,
    lookaheadDays,
    limit,
    source: 'mms_calendar_free',
  };

  freeCalendarSlotCache.set(cacheKey, {
    value: context,
    expiresAtMs,
  });

  return context;
}

export async function getMmsFreeCalendarSlots(options = {}) {
  const context = await getMmsFreeCalendarSlotContext(options);
  return context.slots;
}

function clearMmsFreeCalendarSlotCache() {
  freeCalendarSlotCache.clear();
}

function unwrapMmsCalendarEvent(responseBody) {
  return responseBody?.Event || responseBody?.Item || responseBody?.Data || responseBody;
}

export async function getValidatedMmsFreeCalendarSlot({
  eventId,
  teacherId,
  lessonDate,
  lessonTime,
  durationMinutes,
} = {}) {
  if (!/^evt_[A-Za-z0-9_-]+$/u.test(`${eventId || ''}`)) {
    throw new Error('The selected MMS Free event ID is invalid. Return to Waiting and choose the slot again.');
  }

  const response = await mmsFetch(`${MMS_BASE_URL}/calendar/events/${eventId}`, {
    headers: getMmsHeaders(),
    cache: 'no-store',
  });
  const responseBody = await parseMmsResponse(response);

  if (!response.ok) {
    const details = formatMmsErrorBody(responseBody);
    const error = new Error(`MMS Free event check failed: ${response.status}${details ? ` - ${details}` : ''}`);
    error.status = response.status;
    throw error;
  }

  const slot = validateMmsFreeCalendarEvent({
    event: unwrapMmsCalendarEvent(responseBody),
    eventId,
    teacherId,
    lessonDate,
    lessonTime,
    durationMinutes,
  });

  // The pinned event only proves the slot was free in its own week. When the
  // first lesson is bumped forward, confirm the slot is still free in the week
  // it will actually start, so a bump can never book over something else.
  if (!slot.weekOffset) {
    return slot;
  }

  const dayEvents = await searchCalendarEventsInRange({
    teacherId,
    startDate: lessonDate,
    endDate: addDaysToCalendarDate(lessonDate, 1),
  });

  const occurrence = findFreeCalendarOccurrence({
    events: dayEvents,
    teacherId,
    startDateTime: slot.lessonStartDateTime,
    durationMinutes: slot.durationMinutes,
  });

  if (!occurrence) {
    throw new Error(`The selected Free slot is not open on ${lessonDate} at ${lessonTime}. Choose a week it is still free, or onboard without the slot.`);
  }

  return slot;
}

export async function consumeMmsFreeCalendarSlot(options = {}) {
  let slot;
  try {
    slot = await getValidatedMmsFreeCalendarSlot(options);
  } catch (error) {
    // The exact event was confirmed before onboarding writes. If MMS has already
    // removed it by the time cleanup runs, the desired end-state is satisfied;
    // do not turn an idempotent retry into another partial onboarding.
    if (error?.status === 404 && options.eventId) {
      clearMmsFreeCalendarSlotCache();
      return {
        eventId: options.eventId,
        seriesId: '',
        alreadyAbsent: true,
      };
    }
    throw error;
  }
  const response = await mmsFetch(`${MMS_BASE_URL}/calendar/event/${slot.eventId}`, {
    method: 'DELETE',
    headers: getMmsHeaders(),
    body: JSON.stringify(MMS_FREE_SLOT_DELETE_OPTIONS),
    cache: 'no-store',
  });
  const responseBody = await parseMmsResponse(response);

  if (!response.ok) {
    const details = formatMmsErrorBody(responseBody);
    throw new Error(`MMS Free event removal failed: ${response.status}${details ? ` - ${details}` : ''}`);
  }

  clearMmsFreeCalendarSlotCache();
  return slot;
}

export async function getMmsTutorCalendarEventsForDate({ teacherId, date, limit = 100 } = {}) {
  if (!teacherId) {
    throw new Error('MMS teacher ID is required');
  }
  if (!date) {
    throw new Error('Absence date is required');
  }

  const events = await searchCalendarEventsInRange({
    startDate: date,
    // MMS treats same-day StartDate/EndDate searches as empty for calendar events.
    endDate: addDaysToInputDate(date, 1),
    limit,
  });

  return events.filter((event) => event.TeacherID === teacherId || event.OriginalTeacherID === teacherId);
}

export async function getStudentOperationalState({
  studentId,
  teacherId = '',
  lessonDate = '',
  lessonTime = '',
} = {}) {
  const student = await getStudentRecord(studentId);
  const billingProfiles = teacherId ? await searchBillingProfiles({ studentId }) : [];
  const matchingBillingProfile = teacherId
    ? billingProfiles.find((profile) => profile.TeacherID === teacherId && profile.Active !== false) || null
    : null;

  let existingLesson = null;
  if (teacherId && lessonDate && lessonTime) {
    const existingEvents = await searchCalendarEvents({
      studentId,
      teacherId,
      lessonDate,
    });
    existingLesson = findMatchingCalendarEvent({
      events: existingEvents,
      studentId,
      teacherId,
      lessonDate,
      lessonTime,
    });
  }

  return {
    studentStatus: student.Status || '',
    isActive: student.Status === 'Active',
    billingProfile: matchingBillingProfile,
    existingLesson,
  };
}

export async function previewPracticeNoteMmsTestWrite({
  studentId,
  noteText,
  now = new Date(),
  targetAttendanceId = '',
  attendanceStatus = 'Present',
} = {}) {
  if (!studentId) {
    throw new Error('studentId is required');
  }
  const noteHtml = formatPracticeNoteHtml(noteText);
  const normalisedAttendanceStatus = attendanceStatus === 'AbsentNoMakeup' ? 'AbsentNoMakeup' : 'Present';
  if (!noteHtml && normalisedAttendanceStatus === 'Present') {
    throw new Error('noteText is required');
  }

  const [student, attendanceRows] = await Promise.all([
    getStudentRecord(studentId),
    searchStudentAttendance({
      studentId,
      endDate: buildAttendanceSearchEndDate(now),
      limit: 25,
    }),
  ]);
  const candidateAttendances = listPracticeNoteAttendanceCandidates(attendanceRows, now);
  const targetAttendance = selectPracticeNoteAttendanceTarget(attendanceRows, now, { targetAttendanceId });
  if (!targetAttendance) {
    throw new Error(targetAttendanceId
      ? 'Requested MMS attendance record was not found for Test Studenty.'
      : 'No matching MMS attendance record found for Test Studenty.');
  }

  const recipients = normalisedAttendanceStatus === 'Present' ? buildPracticeNoteEmailRecipients(student) : [];
  if (normalisedAttendanceStatus === 'Present' && !recipients.length) {
    throw new Error('No email-capable MMS recipients found for Test Studenty.');
  }

  return {
    dryRun: true,
    student: {
      studentId: student.ID || studentId,
      name: student.FullName || `${student.FirstName || ''} ${student.LastName || ''}`.trim(),
      status: student.Status || '',
    },
    targetAttendance,
    targetSelection: describePracticeNoteAttendanceSelection({
      target: targetAttendance,
      candidates: candidateAttendances,
      targetAttendanceId,
    }),
    candidateAttendances,
    candidateCount: attendanceRows.length,
    recipients,
    attendancePayload: buildPracticeNoteAttendancePayload({
      attendance: targetAttendance,
      noteHtml,
      attendanceStatus: normalisedAttendanceStatus,
    }),
    requestedAttendanceStatus: normalisedAttendanceStatus,
  };
}

export async function executePracticeNoteMmsTestWrite({
  studentId,
  noteText,
  now = new Date(),
  targetAttendanceId = '',
  attendanceStatus = 'Present',
} = {}) {
  const preview = await previewPracticeNoteMmsTestWrite({ studentId, noteText, now, targetAttendanceId, attendanceStatus });
  const { targetAttendance, attendancePayload } = preview;

  const attendanceResponse = await mmsFetch(`${MMS_BASE_URL}/events/${targetAttendance.eventId}/attendance/${targetAttendance.attendanceId}`, {
    method: 'PUT',
    headers: getMmsHeaders(),
    body: JSON.stringify(attendancePayload),
    cache: 'no-store',
  });
  const attendanceResponseBody = await parseMmsResponse(attendanceResponse);
  if (!attendanceResponse.ok) {
    const details = formatMmsErrorBody(attendanceResponseBody);
    throw new Error(`MMS attendance note save failed: ${attendanceResponse.status}${details ? ` - ${details}` : ''}`);
  }

  let practiceNoteEmail = {
    ok: true,
    skipped: true,
    channel: 'none',
    reason: 'student_absent_no_makeup',
  };

  if (preview.requestedAttendanceStatus === 'Present') {
    const emailConfig = assertPracticeNotesEmailConfigured();
    try {
      practiceNoteEmail = await sendPracticeNoteEmail({
        recipient: preview.recipients[0],
        studentName: preview.student.name,
        tutorName: targetAttendance.teacherName || '',
        noteText,
        config: emailConfig,
      });
    } catch (error) {
      practiceNoteEmail = {
        ok: false,
        channel: 'gmail',
        toEmail: preview.recipients[0]?.email || '',
        fromEmail: emailConfig.fromEmail,
        error: error.message || 'Practice note email failed.',
      };
    }
  }

  return {
    ...preview,
    dryRun: false,
    attendanceSave: {
      ok: true,
      status: attendanceResponse.status,
      response: attendanceResponseBody,
    },
    practiceNoteEmail,
    emailNotes: practiceNoteEmail,
    partialSuccess: practiceNoteEmail.ok === false,
  };
}

export async function activateStudent({ studentId }) {
  const student = await getStudentRecord(studentId);

  if (student.Status === 'Active') {
    return {
      ...student,
      skipped: true,
      alreadyActive: true,
    };
  }

  const payload = {
    AdultStudentParentID: student.AdultStudentParentID || null,
    DateOfBirth: student.DateOfBirth || null,
    DateStarted: student.DateStarted || null,
    EmailAddress: student.Email?.EmailAddress || '',
    FaceTimeID: student.FaceTimeID || null,
    FirstName: student.FirstName || '',
    Gender: student.Gender || null,
    LastName: student.LastName || '',
    LocalSchool: student.LocalSchool || null,
    Note: student.Note || '',
    Referrer: student.Referrer || '',
    SendEmailReminders: student.SendEmailReminders ?? true,
    SendSMSReminders: student.SendSMSReminders ?? false,
    SkillLevel: student.SkillLevel || null,
    SkypeUsername: student.SkypeUsername || null,
    Status: 'Active',
    SubjectTypes: student.SubjectTypes || null,
    Telephone: {
      TelephoneNumber: student.Telephone?.TelephoneNumber || '',
      TextingAllowed: Boolean(student.Telephone?.TextingAllowed),
    },
  };

  const response = await mmsFetch(`${MMS_BASE_URL}/students/${studentId}`, {
    method: 'PUT',
    headers: getMmsHeaders(),
    body: JSON.stringify(payload),
  });

  const responseBody = await parseMmsResponse(response);

  if (!response.ok) {
    const details = formatMmsErrorBody(responseBody);
    throw new Error(`MMS activate student failed: ${response.status}${details ? ` - ${details}` : ''}`);
  }

  return responseBody;
}

export async function markStudentInactive({ studentId }) {
  const student = await getStudentRecord(studentId);

  if (student.Status === 'Inactive') {
    return {
      ...student,
      skipped: true,
      alreadyInactive: true,
    };
  }

  const payload = {
    AdultStudentParentID: student.AdultStudentParentID || null,
    DateOfBirth: student.DateOfBirth || null,
    DateStarted: student.DateStarted || null,
    EmailAddress: student.Email?.EmailAddress || '',
    FaceTimeID: student.FaceTimeID || null,
    FirstName: student.FirstName || '',
    Gender: student.Gender || null,
    LastName: student.LastName || '',
    LocalSchool: student.LocalSchool || null,
    Note: student.Note || '',
    Referrer: student.Referrer || '',
    SendEmailReminders: student.SendEmailReminders ?? true,
    SendSMSReminders: student.SendSMSReminders ?? false,
    SkillLevel: student.SkillLevel || null,
    SkypeUsername: student.SkypeUsername || null,
    Status: 'Inactive',
    SubjectTypes: student.SubjectTypes || null,
    Telephone: {
      TelephoneNumber: student.Telephone?.TelephoneNumber || '',
      TextingAllowed: Boolean(student.Telephone?.TextingAllowed),
    },
  };

  const response = await mmsFetch(`${MMS_BASE_URL}/students/${studentId}`, {
    method: 'PUT',
    headers: getMmsHeaders(),
    body: JSON.stringify(payload),
  });

  const responseBody = await parseMmsResponse(response);

  if (!response.ok) {
    const details = formatMmsErrorBody(responseBody);
    throw new Error(`MMS mark student inactive failed: ${response.status}${details ? ` - ${details}` : ''}`);
  }

  return responseBody;
}

async function searchBillingProfiles({ studentId }) {
  const response = await mmsFetch(`${MMS_BASE_URL}//search/billingprofiles?fields=ScheduledMakeupMinutes`, {
    method: 'POST',
    headers: getMmsHeaders(),
    body: JSON.stringify({
      Active: true,
      SearchText: null,
      StudentIDs: [studentId],
      TeacherIDs: [],
    }),
    cache: 'no-store',
  });

  const responseBody = await parseMmsResponse(response);

  if (!response.ok) {
    const details = formatMmsErrorBody(responseBody);
    throw new Error(`MMS billing profile search failed: ${response.status}${details ? ` - ${details}` : ''}`);
  }

  return responseBody?.ItemSubset || [];
}

export async function ensureBillingProfile({
  studentId,
  teacherId,
  lessonDuration = 30,
  billingRate = Number(process.env.MMS_DEFAULT_BILLING_RATE || 30),
  eventCategoryId = process.env.MMS_BILLING_EVENT_CATEGORY_ID || 'ect_5cxpJ9',
}) {
  const existing = await searchBillingProfiles({ studentId });
  const match = existing.find((profile) => profile.TeacherID === teacherId && profile.Active !== false);

  if (match) {
    return {
      ...match,
      alreadyExists: true,
    };
  }

  const payload = buildBillingProfilePayload({
    studentId,
    teacherId,
    lessonDuration,
    billingRate,
    eventCategoryId,
  });

  const response = await mmsFetch(`${MMS_BASE_URL}/billingprofiles`, {
    method: 'POST',
    headers: getMmsHeaders(),
    body: JSON.stringify(payload),
  });

  const responseBody = await parseMmsResponse(response);

  if (!response.ok) {
    const details = formatMmsErrorBody(responseBody);
    throw new Error(`MMS billing profile create failed: ${response.status}${details ? ` - ${details}` : ''}`);
  }

  return responseBody;
}

export async function createFirstLesson({
  studentId,
  studentIds = [],
  teacherId,
  lessonDate,
  lessonTime,
  durationMinutes = 30,
  eventCategoryId = process.env.MMS_FIRST_LESSON_EVENT_CATEGORY_ID || '',
  billingProfile = null,
  isRecurring = true,
}) {
  const resolvedStudentIds = studentIds.length ? studentIds : studentId ? [studentId] : [];
  const existingEvents = await searchCalendarEvents({
    studentId: resolvedStudentIds,
    teacherId,
    lessonDate,
  });
  const existingMatch = findMatchingCalendarEvent({
    events: existingEvents,
    studentIds: resolvedStudentIds,
    teacherId,
    lessonDate,
    lessonTime,
  });

  if (existingMatch) {
    return {
      ...existingMatch,
      duplicateSkipped: true,
    };
  }

  const payload = buildCalendarEventPayload({
    studentIds: resolvedStudentIds,
    teacherId,
    lessonDate,
    lessonTime,
    durationMinutes,
    eventCategoryId,
    billingProfile,
    isRecurring,
  });

  const response = await mmsFetch(`${MMS_BASE_URL}/calendar/event`, {
    method: 'POST',
    headers: getMmsHeaders(),
    body: JSON.stringify(payload),
  });

  const responseBody = await parseMmsResponse(response);

  if (!response.ok) {
    const details = formatMmsErrorBody(responseBody);
    throw new Error(`MMS create lesson failed: ${response.status}${details ? ` - ${details}` : ''}`);
  }

  return responseBody;
}
