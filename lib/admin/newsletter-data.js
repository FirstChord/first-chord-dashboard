/** @fileoverview Static newsletter reference copy: the constant examples list tutors are given and the consent-ask message template. */
// Reference copy lives here, not in a Sheets column, for the same reason the
// showcase checklist does: it is the same every month, so a per-issue field
// would just be a thing Fenella retypes twelve times a year. Only what actually
// changes month to month — the month, the question, the deadline — is stored.

// The examples list from the message Fenella has been sending by hand. Kept
// verbatim in spirit: the point of it is to lower the bar, so a tutor does not
// think a contribution has to be a polished performance video.
export const CONTRIBUTION_EXAMPLES = [
  'a little win or news',
  'performance, exam, book or piece progress',
  'a photo',
  'a music review',
  'a voice note or video',
  'an answer to the question of the month',
];

// Openers: always Hi/Hello/Hey, never "Heya". Calm and warm, British.
export function buildTutorRequestMessage({
  tutorFirstName = '',
  studentNames = [],
  question = '',
  deadlineLabel = '',
} = {}) {
  const greeting = tutorFirstName ? `Hi ${tutorFirstName},` : 'Hi,';
  const names = studentNames.filter(Boolean);

  const lines = [greeting, ''];

  if (names.length) {
    lines.push(
      deadlineLabel
        ? `By ${deadlineLabel}, could you try and get some news from:`
        : 'This month, could you try and get some news from:',
    );
    lines.push('');
    lines.push(...names);
    lines.push('');
    lines.push(
      'If there happens to be news from anyone else then great — these students are just the priority.',
    );
  } else {
    lines.push(
      deadlineLabel
        ? `By ${deadlineLabel}, any news from your students would be very welcome for the newsletter.`
        : 'Any news from your students would be very welcome for the newsletter.',
    );
  }

  lines.push('');
  lines.push('It does not have to be a performance video. It could be:');
  lines.push(...CONTRIBUTION_EXAMPLES.map((example) => `- ${example};`));

  if (question) {
    lines.push('');
    lines.push('Question of the month:');
    lines.push(`"${question}"`);
  }

  lines.push('');
  lines.push('Thank you!');

  return lines.join('\n');
}

// The consent ask. Deliberately short, and deliberately does not pre-empt the
// answer — a parent who would rather not should not have to argue with a
// paragraph about how lovely it would be.
export function buildConsentRequestMessage({
  parentFirstName = '',
  studentFirstName = '',
  monthLabel = '',
  mediaDescription = '',
} = {}) {
  const greeting = parentFirstName ? `Hi ${parentFirstName},` : 'Hi,';
  const child = studentFirstName || 'your child';
  const what = mediaDescription || 'a photo';
  const when = monthLabel ? `${monthLabel} newsletter` : 'newsletter';

  return [
    greeting,
    '',
    `We'd love to include ${what} of ${child} in our ${when}. Would that be alright with you?`,
    '',
    'Happy either way — just let us know:',
    '',
    '1. No thanks',
    '2. Yes, this one is fine',
    '3. Yes, and future newsletters too',
    '',
    'Thanks very much,',
    'First Chord',
  ].join('\n');
}
