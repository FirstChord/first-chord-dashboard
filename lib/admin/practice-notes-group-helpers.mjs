/** @fileoverview Pure helpers resolving the students who share one MMS lesson event, and deciding who carries the single group email. */

function clean(value = '') {
  return `${value || ''}`.trim();
}

function comparableEmail(value = '') {
  return clean(value).toLocaleLowerCase('en-GB');
}

// "Athena and Sophia", "Alister, Carolyn and Thomas". Used for the email subject
// and intro, so one household reads one sentence about one lesson.
export function joinStudentNames(names = []) {
  const list = names.map((name) => clean(name)).filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

// Shape of one entry in an MMS calendar event's `Attendances` array. Every
// student on a shared lesson has their own attendance record on the one event,
// which is what makes per-student attendance possible from a single group action.
export function normaliseLessonGroupAttendance(record = {}) {
  return {
    attendanceId: clean(record.ID),
    eventId: clean(record.EventID),
    studentMmsId: clean(record.StudentID),
    studentName: clean(record.StudentFullName)
      || [clean(record.StudentFirstName), clean(record.StudentLastName)].filter(Boolean).join(' '),
    attendanceStatus: clean(record.AttendanceStatus),
  };
}

// The students sharing one lesson, in a stable order with the tutor's launched
// student first. Pinning to a single event is the point: left to themselves the
// two sisters in one lesson select different dates, because each picks her own
// latest unrecorded record and they drift apart.
export function buildPracticeNoteLessonGroup({ attendances = [], leadStudentMmsId = '' } = {}) {
  const lead = clean(leadStudentMmsId);
  const members = (attendances || [])
    .map(normaliseLessonGroupAttendance)
    .filter((member) => member.attendanceId && member.studentMmsId)
    .sort((a, b) => {
      if (a.studentMmsId === lead) return -1;
      if (b.studentMmsId === lead) return 1;
      return a.studentName.localeCompare(b.studentName);
    })
    .map((member) => ({ ...member, isLead: member.studentMmsId === lead }));

  return {
    members,
    memberCount: members.length,
    // One student on the event is an ordinary lesson, not a group. The caller
    // uses this to keep the existing single-student path untouched.
    isGroup: members.length > 1,
    leadPresent: members.some((member) => member.isLead),
  };
}

// Who receives the one email, and which students it covers.
//
// Both real sibling pairs share a single parent profile, so sending each child's
// notes separately would put two near-identical emails in one inbox about one
// lesson. Recipients are therefore deduplicated by address: the first member
// holding that address carries the send and names everyone it covers, and the
// rest are marked as covered rather than skipped, because "no email was needed"
// and "the email failed" must never look the same in the log.
//
// `sendEmails: false` turns the whole thing into an attendance-only run — the
// ukulele orchestra, where members are adults with their own contacts and the
// practice-note email is not the right shape at all.
export function planPracticeNoteGroupDelivery({
  members = [],
  recipientsByStudentMmsId = new Map(),
  sendEmails = true,
} = {}) {
  const carriers = new Map();
  const plan = members.map((member) => {
    const recipients = recipientsByStudentMmsId.get(member.studentMmsId) || [];
    const recipient = recipients[0] || null;
    const key = comparableEmail(recipient?.email);

    if (!sendEmails) {
      return { ...member, recipient, emailRole: 'none', emailReason: 'attendance_only_lesson', covers: [] };
    }
    if (!key) {
      return { ...member, recipient: null, emailRole: 'none', emailReason: 'no_email_capable_recipient', covers: [] };
    }
    if (!carriers.has(key)) {
      carriers.set(key, member.studentMmsId);
      return { ...member, recipient, emailRole: 'carrier', emailReason: '', covers: [member.studentName] };
    }
    return {
      ...member,
      recipient,
      emailRole: 'covered',
      emailReason: 'covered_by_group_email',
      coveredBy: carriers.get(key),
      covers: [],
    };
  });

  // Second pass: a carrier only knows everyone it covers once every member has
  // been assigned, so the names on the email are complete.
  for (const entry of plan) {
    if (entry.emailRole !== 'carrier') continue;
    const key = comparableEmail(entry.recipient?.email);
    entry.covers = plan
      .filter((other) => comparableEmail(other.recipient?.email) === key && other.emailRole !== 'none')
      .map((other) => other.studentName)
      .filter(Boolean);
    entry.emailStudentLabel = joinStudentNames(entry.covers);
  }

  return {
    plan,
    emailCount: plan.filter((entry) => entry.emailRole === 'carrier').length,
    attendanceCount: plan.length,
    sendEmails,
  };
}

// One line a tutor can check before pressing the button: who gets marked, and
// who actually receives an email.
export function describePracticeNoteGroupDelivery({ plan = [], sendEmails = true, attendanceStatus = 'Present' } = {}) {
  if (!plan.length) return 'No students found on this lesson.';

  const names = joinStudentNames(plan.map((entry) => entry.studentName));
  const marked = attendanceStatus === 'AbsentNoMakeup'
    ? `${names} will be marked absent with no makeup`
    : `${names} will be marked present`;

  if (!sendEmails) {
    return `${marked}. No practice-note email is sent for this lesson.`;
  }

  const carriers = plan.filter((entry) => entry.emailRole === 'carrier');
  if (!carriers.length) {
    return `${marked}. No email-capable contact was found, so no email will be sent.`;
  }

  const sends = carriers
    .map((entry) => `${joinStudentNames(entry.covers)} → ${entry.recipient?.email || ''}`)
    .join('; ');
  return `${marked}. ${carriers.length === 1 ? 'One email' : `${carriers.length} emails`}: ${sends}.`;
}
