// Coarse pre-filter so we don't ship every group the account is in (personal
// chats, community groups, etc.) to the dashboard. First Chord group titles are
// "{First name} {Instrument} Lessons {emoji}", so an instrument keyword or the
// word "lessons" is a cheap, no-student-data signal. The dashboard still does
// the authoritative roster matching. Tutor groups use "{Name} First Chord"
// with optional emoji; this pre-filter still never enables capture.
const FC_GROUP_TITLE_KEYWORDS = [
  'guitar', 'piano', 'keyboard', 'keys', 'voice', 'vocal', 'vocals', 'singing', 'sing',
  'ukulele', 'uke', 'bass', 'drums', 'drum', 'violin', 'viola', 'cello', 'sax',
  'saxophone', 'flute', 'clarinet', 'trumpet', 'theory', 'mandolin', 'banjo',
  'lesson', 'lessons',
];

function titleLooksLikeFcGroup(name = '') {
  const words = (
    `${name || ''}`
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
      .split(/\s+/u)
      .filter(Boolean)
  );
  const tokens = new Set(words);
  return FC_GROUP_TITLE_KEYWORDS.some((keyword) => tokens.has(keyword))
    || /^.+ first chord$/u.test(words.join(' '));
}

// New group confirmations should become useful during the same working session.
// Preserve the existing ten-minute floor and explicit longer overrides.
function confirmedGroupsRefreshMs(value) {
  const interval = Number(value);
  return Number.isFinite(interval) && interval > 0
    ? Math.max(10 * 60 * 1000, interval)
    : 10 * 60 * 1000;
}

module.exports = { titleLooksLikeFcGroup, confirmedGroupsRefreshMs };
