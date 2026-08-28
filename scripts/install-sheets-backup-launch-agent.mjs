import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const label = 'com.firstchord.sheets-backup';
const launchAgentsDir = path.join(homedir(), 'Library', 'LaunchAgents');
const plistPath = path.join(launchAgentsDir, `${label}.plist`);
const backupLogDir = path.join(repoRoot, 'backups', 'sheets');
const backupScript = path.join(repoRoot, 'scripts', 'backup-sheets-tabs.mjs');

// Days of the month the backup runs. The first version of this agent used
// `StartInterval` of 14 days, which counts from when launchd *loads* the job —
// so every reboot or login put the clock back to zero and it never once fired
// in two and a half months (`launchctl print` reported `runs = 0`). A calendar
// schedule is absolute, and launchd runs a missed calendar time on the next
// wake, which an interval never does. Fortnightly is not expressible as a
// calendar rule, so the 1st and 15th is the usual stand-in.
const RUN_DAYS = [1, 15];
const RUN_HOUR = 10;

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Resolved through a login shell because launchd has neither the user's PATH
// nor their shell profile.
function resolveNodePath() {
  return execFileSync('/bin/zsh', ['-lc', 'command -v node'], { encoding: 'utf8' }).trim();
}

const nodePath = resolveNodePath();
if (!nodePath) {
  throw new Error('Could not find node on the login shell PATH.');
}

// launchd is given node and the script directly rather than `npm run
// backup:sheets`. `npm` is a symlink to a .js file whose shebang is
// `#!/usr/bin/env node`, and launchd's default PATH is
// /usr/bin:/bin:/usr/sbin:/sbin — which does not contain node, so the job would
// have failed to launch even once the schedule was fixed. There is no
// `prebackup:sheets` hook, so this runs exactly what the npm script runs.
const agentPath = [path.dirname(nodePath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');

const calendarEntries = RUN_DAYS.map((day) => `    <dict>
      <key>Day</key>
      <integer>${day}</integer>
      <key>Hour</key>
      <integer>${RUN_HOUR}</integer>
      <key>Minute</key>
      <integer>0</integer>
    </dict>`).join('\n');

await mkdir(launchAgentsDir, { recursive: true });
await mkdir(backupLogDir, { recursive: true });

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodePath)}</string>
    <string>${escapeXml(backupScript)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(repoRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${escapeXml(agentPath)}</string>
  </dict>
  <key>StartCalendarInterval</key>
  <array>
${calendarEntries}
  </array>
  <key>StandardOutPath</key>
  <string>${escapeXml(path.join(backupLogDir, 'launchd.out.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(path.join(backupLogDir, 'launchd.err.log'))}</string>
</dict>
</plist>
`;

await writeFile(plistPath, plist, 'utf8');

const uid = process.getuid?.();
if (typeof uid !== 'number') {
  throw new Error('Could not determine current user id for launchctl.');
}

try {
  execFileSync('launchctl', ['bootout', `gui/${uid}`, plistPath], { stdio: 'ignore' });
} catch {
  // It is fine if the agent was not loaded yet.
}

execFileSync('launchctl', ['bootstrap', `gui/${uid}`, plistPath], { stdio: 'inherit' });
execFileSync('launchctl', ['enable', `gui/${uid}/${label}`], { stdio: 'inherit' });

console.log(`Installed ${label}`);
console.log(`Schedule: ${RUN_DAYS.map((day) => `day ${day}`).join(' and ')} of each month at ${String(RUN_HOUR).padStart(2, '0')}:00`);
console.log(`Runs: ${nodePath} ${backupScript}`);
console.log(`Plist: ${plistPath}`);
console.log(`Logs: ${backupLogDir}/launchd.out.log and launchd.err.log`);
console.log('Verify with: launchctl print gui/$(id -u)/com.firstchord.sheets-backup');
