import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsRoot = path.join(repositoryRoot, 'docs');
const errors = [];
const allowedStatuses = new Set([
  'canonical',
  'supporting',
  'active-plan',
  'parked',
  'historical',
]);

function walk(directory, predicate = () => true) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (['.git', '.next', 'node_modules'].includes(entry.name)) return [];
      return walk(target, predicate);
    }
    return entry.isFile() && predicate(target) ? [target] : [];
  });
}

function relative(file) {
  return path.relative(repositoryRoot, file).split(path.sep).join('/');
}

function frontmatter(source) {
  if (!source.startsWith('---\n')) return null;
  const end = source.indexOf('\n---\n', 4);
  if (end === -1) return null;
  const values = new Map();
  for (const line of source.slice(4, end).split('\n')) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    values.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return values;
}

function expectedStatus(file) {
  const name = relative(file);
  if (name.startsWith('docs/history/')) return 'historical';
  if (name.startsWith('docs/plans/active/')) return 'active-plan';
  if (name.startsWith('docs/plans/parked/')) return 'parked';
  return null;
}

const markdownFiles = walk(docsRoot, (file) => file.endsWith('.md'));
for (const file of markdownFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const metadata = frontmatter(source);
  if (!metadata) {
    errors.push(`${relative(file)}: missing YAML frontmatter`);
    continue;
  }

  const status = metadata.get('status');
  if (!allowedStatuses.has(status)) {
    errors.push(`${relative(file)}: invalid or missing status`);
  }
  if (!metadata.get('audience')) {
    errors.push(`${relative(file)}: missing audience`);
  }
  if (!metadata.has('last_verified')) {
    errors.push(`${relative(file)}: missing last_verified (use null when not reviewed)`);
  }

  const requiredStatus = expectedStatus(file);
  if (requiredStatus && status !== requiredStatus) {
    errors.push(`${relative(file)}: expected status ${requiredStatus}, found ${status}`);
  }
}

const retiredIndexes = [
  'docs/INDEX.md',
  'docs/admin/INDEX.md',
  'docs/admin/DOCUMENTATION_MAP.md',
];
for (const name of retiredIndexes) {
  if (fs.existsSync(path.join(repositoryRoot, name))) {
    errors.push(`${name}: retired navigation file must not be restored`);
  }
}

for (const directory of ['docs/admin', 'docs/archives', 'docs/guides', 'docs/protocols']) {
  const remaining = walk(path.join(repositoryRoot, directory), (file) => file.endsWith('.md'));
  for (const file of remaining) {
    errors.push(`${relative(file)}: Markdown belongs in the intent-led docs tree`);
  }
}

const markdownSources = [
  path.join(repositoryRoot, 'AGENTS.md'),
  path.join(repositoryRoot, 'README.md'),
  ...walk(path.join(repositoryRoot, '.claude'), (file) => file.endsWith('.md')),
  ...markdownFiles,
  ...walk(path.join(repositoryRoot, 'tools'), (file) => file.endsWith('.md')),
].filter((file, index, files) => fs.existsSync(file) && files.indexOf(file) === index);

for (const file of markdownSources) {
  const source = fs.readFileSync(file, 'utf8');
  const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of source.matchAll(linkPattern)) {
    let target = match[1].trim();
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
    target = target.split('#', 1)[0].split('?', 1)[0];
    if (!target || /^(?:https?:|mailto:|tel:|data:)/i.test(target) || target.startsWith('/')) continue;
    try {
      target = decodeURIComponent(target);
    } catch {
      errors.push(`${relative(file)}: malformed link ${match[1]}`);
      continue;
    }
    const resolved = path.resolve(path.dirname(file), target);
    if (!fs.existsSync(resolved)) {
      errors.push(`${relative(file)}: broken link ${match[1]}`);
    }
  }
}

const exactPathSources = [
  ...markdownSources,
  ...walk(path.join(repositoryRoot, 'app'), (file) => /\.(?:js|jsx|mjs|ts|tsx)$/.test(file)),
  ...walk(path.join(repositoryRoot, 'components'), (file) => /\.(?:js|jsx|mjs|ts|tsx)$/.test(file)),
  ...walk(path.join(repositoryRoot, 'lib'), (file) => /\.(?:js|jsx|mjs|ts|tsx)$/.test(file)),
  ...walk(path.join(repositoryRoot, 'scripts'), (file) => /\.(?:js|mjs)$/.test(file)),
  ...walk(path.join(repositoryRoot, 'tests'), (file) => /\.(?:js|mjs)$/.test(file)),
].filter((file, index, files) =>
  files.indexOf(file) === index && relative(file) !== 'scripts/check-docs.mjs'
);

for (const file of exactPathSources) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/docs\/[A-Za-z0-9_./-]+\.md/g)) {
    if (!fs.existsSync(path.join(repositoryRoot, match[0]))) {
      errors.push(`${relative(file)}: missing referenced path ${match[0]}`);
    }
  }
}

// Catch pre-migration bare filenames that ordinary Markdown-link checking
// cannot resolve. History may quote old names; current-facing docs and source
// comments should route readers to the intent-led tree.
const retiredBareReferences = new Map([
  ['STATE_TABS_SCHEMA.md', 'docs/architecture/data/state-tabs.md'],
  ['OWNERSHIP_MATRIX.md', 'docs/architecture/data/ownership.md'],
  ['OPERATIONS_RUNBOOK.md', 'docs/operations/runbook.md'],
  ['AI_TOOL_CONTRACTS.md', 'docs/architecture/ai/tool-contracts.md'],
  ['DATA_PROTECTION_MAP.md', 'docs/policies/data-protection.md'],
  ['STUDENT_PATHS_PLAN.md', 'docs/architecture/system/student-paths.md'],
  ['WHATSAPP_INCOMING_BRIDGE.md', 'docs/operations/integrations/whatsapp-incoming-bridge.md'],
  ['06-paying-tutors.md', 'docs/workflows/finance/paying-tutors.md'],
  ['SHEETS_VS_DB_AUDIT.md', 'docs/architecture/data/storage-boundary.md'],
  ['DISASTER_RECOVERY.md', 'docs/operations/disaster-recovery.md'],
  ['UI_CONVENTIONS.md', 'docs/policies/ui-conventions.md'],
  ['COPY_AND_TONE.md', 'docs/policies/copy-and-tone.md'],
  ['SONG_CATALOGUE_COVERAGE.md', 'docs/reference/song-catalogue-coverage.md'],
  ['AI_RUNTIME_INTEGRATION.md', 'docs/architecture/ai/runtime-integration.md'],
]);

for (const file of exactPathSources) {
  if (relative(file).startsWith('docs/history/')) continue;
  const source = fs.readFileSync(file, 'utf8');
  for (const [retiredName, replacement] of retiredBareReferences) {
    if (source.includes(retiredName)) {
      errors.push(`${relative(file)}: retired reference ${retiredName}; use ${replacement}`);
    }
  }
}

// --- Snapshot bounds -------------------------------------------------------
//
// CURRENT_STATUS.md is a snapshot, not a changelog, but nothing enforced that
// and "Recently shipped" grew from 154 to 567 lines in sixteen days. Pruning
// failed as a rule because it asks for a judgement call at the end of a
// session, when the work is done and the writing is good — so it was always the
// step that got dropped. Nothing was lost by capping it: every entry was
// already written up, with its reasoning, in the vault Learning Log.
//
// The cap is an error because it is mechanical: count entries, delete the
// oldest. `Next choices` is a warning instead — pruning it means deciding an
// initiative is no longer next, which is a real decision and not one a build
// should force at commit time.
const SNAPSHOT_ENTRY_LIMIT = 8;
const NEXT_CHOICES_SOFT_LIMIT = 6;
const snapshotWarnings = [];

function countSectionEntries(source, heading) {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return null;
  let count = 0;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    if (line.startsWith('- **')) count += 1;
  }
  return count;
}

const statusPath = path.join(docsRoot, 'CURRENT_STATUS.md');
if (fs.existsSync(statusPath)) {
  const source = fs.readFileSync(statusPath, 'utf8');

  const shipped = countSectionEntries(source, '## Since last session');
  if (shipped === null) {
    errors.push('docs/CURRENT_STATUS.md: missing "## Since last session" section');
  } else if (shipped > SNAPSHOT_ENTRY_LIMIT) {
    errors.push(
      `docs/CURRENT_STATUS.md: "Since last session" has ${shipped} entries, limit ${SNAPSHOT_ENTRY_LIMIT}. `
      + 'Delete the oldest; git log is the chronology and the vault Learning Log has the reasoning.',
    );
  }

  const next = countSectionEntries(source, '## Next choices');
  if (next !== null && next > NEXT_CHOICES_SOFT_LIMIT) {
    snapshotWarnings.push(
      `"Next choices" has ${next} entries (soft limit ${NEXT_CHOICES_SOFT_LIMIT}) — `
      + 'consider parking one rather than carrying it.',
    );
  }
}

// --- Obsidian vault freshness ---------------------------------------------
//
// The vault carries `last_verified` dates that nothing ever checked, so they
// asserted a freshness no one was maintaining — worse than no date, because an
// unverified claim that looks verified gets trusted. This checks them.
//
// Warnings only, never errors. The vault lives in iCloud and is not in any git
// repository, so it is absent on CI and on other machines; a check that cannot
// run everywhere must not be able to fail a build. Acting on these belongs to
// the review rhythm, not to a gate.
//
// Only `status: current` notes are judged. `redirect` stubs, `historical`
// records and `idea` notes make no freshness claim, and the Learning Log is
// deliberately a dated archive rather than something to re-verify.
const VAULT_STALE_DAYS = Number(process.env.VAULT_STALE_DAYS) || 60;
const vaultRoot = process.env.FIRST_CHORD_VAULT || path.join(
  process.env.HOME || '',
  'Library/Mobile Documents/iCloud~md~obsidian/Documents/First Chord OS/docs/obsidian',
);

const vaultWarnings = [];
let vaultChecked = 0;
let vaultOldest = null;

if (fs.existsSync(vaultRoot)) {
  for (const file of walk(vaultRoot, (f) => f.endsWith('.md'))) {
    const metadata = frontmatter(fs.readFileSync(file, 'utf8'));
    if (!metadata || metadata.get('status') !== 'current') continue;

    const raw = metadata.get('last_verified');
    const name = path.relative(vaultRoot, file).split(path.sep).join('/');
    if (!raw || raw === 'null') {
      vaultWarnings.push(`${name}: status current but no last_verified date`);
      continue;
    }

    const verified = new Date(raw);
    if (Number.isNaN(verified.getTime())) {
      vaultWarnings.push(`${name}: unreadable last_verified "${raw}"`);
      continue;
    }

    vaultChecked += 1;
    const days = Math.floor((Date.now() - verified.getTime()) / 86400000);
    if (!vaultOldest || days > vaultOldest.days) vaultOldest = { name, days };
    if (days > VAULT_STALE_DAYS) {
      vaultWarnings.push(`${name}: last verified ${days} days ago`);
    }
  }
}

if (errors.length > 0) {
  console.error(`Documentation check failed with ${errors.length} issue${errors.length === 1 ? '' : 's'}:`);
  for (const error of [...new Set(errors)].sort()) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Documentation check passed (${markdownFiles.length} docs, ${markdownSources.length} Markdown sources).`);

for (const warning of snapshotWarnings) console.log(`Snapshot warning: ${warning}`);

if (!fs.existsSync(vaultRoot)) {
  console.log('Vault not present here; skipped (set FIRST_CHORD_VAULT to check it).');
} else {
  const oldest = vaultOldest ? `oldest ${vaultOldest.days}d — ${vaultOldest.name}` : 'none dated';
  console.log(`Vault: ${vaultChecked} current note${vaultChecked === 1 ? '' : 's'} dated, ${oldest}.`);
  if (vaultWarnings.length > 0) {
    console.log(`Vault warnings (${vaultWarnings.length}, not failures — review, do not gate):`);
    for (const warning of vaultWarnings.sort()) console.log(`- ${warning}`);
  }
}
