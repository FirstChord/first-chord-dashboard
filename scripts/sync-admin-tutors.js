#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { execFileSync } = require('child_process');

const dashboardRoot = path.join(__dirname, '..');
const brainRoot = path.join(dashboardRoot, '..', 'first-chord-brain');
const outputPath = path.join(dashboardRoot, 'lib', 'admin', 'tutors-data.js');

function makeFcTutorId(teacherId = '') {
  const hash = createHash('sha256').update(`${teacherId}`.trim()).digest('hex').slice(0, 8);
  return `fc_tut_${hash}`;
}

function validateTutors(tutors) {
  if (!Array.isArray(tutors) || tutors.length === 0) {
    throw new Error('Brain returned no tutors');
  }

  const shortNames = new Set();
  const teacherIds = new Set();

  for (const [index, tutor] of tutors.entries()) {
    const shortName = `${tutor.short_name || ''}`.trim();
    const fullName = `${tutor.full_name || ''}`.trim();
    const teacherId = `${tutor.mms_teacher_id || ''}`.trim();
    const instruments = tutor.instruments;

    if (!shortName || !fullName) {
      throw new Error(`Tutor row ${index + 1} needs a short name and full name`);
    }
    if (!/^tch_[A-Za-z0-9]+$/u.test(teacherId)) {
      throw new Error(`Tutor ${shortName} has an invalid MMS teacher ID: ${teacherId || '(blank)'}`);
    }
    if (!Array.isArray(instruments) || instruments.length === 0 || instruments.some((value) => !`${value}`.trim())) {
      throw new Error(`Tutor ${shortName} needs at least one instrument`);
    }

    const shortNameKey = shortName.toLocaleLowerCase('en');
    if (shortNames.has(shortNameKey)) {
      throw new Error(`Duplicate tutor short name: ${shortName}`);
    }
    if (teacherIds.has(teacherId)) {
      throw new Error(`Duplicate MMS teacher ID: ${teacherId}`);
    }

    shortNames.add(shortNameKey);
    teacherIds.add(teacherId);
  }

  return tutors;
}

function readTutorsFromBrain() {
  if (!fs.existsSync(path.join(brainRoot, 'tutors.py'))) {
    throw new Error(`Canonical Brain tutor file not found at ${path.join(brainRoot, 'tutors.py')}`);
  }

  const output = execFileSync(
    'python3',
    ['-c', 'import json; from tutors import TUTORS; print(json.dumps(TUTORS, ensure_ascii=False))'],
    { cwd: brainRoot, encoding: 'utf8' },
  );

  return validateTutors(JSON.parse(output));
}

function quote(value) {
  return `'${`${value}`.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

function buildOutput(tutors) {
  const rows = [...tutors]
    .sort((a, b) => a.short_name.localeCompare(b.short_name, 'en'))
    .map((tutor) => {
      const instruments = tutor.instruments.map(quote).join(', ');
      return `  ${quote(tutor.short_name)}: {\n    fullName: ${quote(tutor.full_name)},\n    fcTutorId: ${quote(makeFcTutorId(tutor.mms_teacher_id))},\n    teacherId: ${quote(tutor.mms_teacher_id)},\n    instruments: [${instruments}],\n  },`;
    });

  return `/** @fileoverview Generated canonical tutor roster keyed by short name; regenerate with npm run sync-admin-tutors rather than editing. */\n// GENERATED — do not edit directly. Run: npm run sync-admin-tutors to regenerate.\n// Source: ../first-chord-brain/tutors.py TUTORS list\n\nexport const ADMIN_TUTORS = {\n${rows.join('\n')}\n};\n`;
}

function main({ check = process.argv.includes('--check') } = {}) {
  const tutors = readTutorsFromBrain();
  const expected = buildOutput(tutors);

  if (check) {
    const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
    if (current !== expected) {
      throw new Error('Generated tutor roster is stale. Run: npm run sync-admin-tutors');
    }
    console.log(`Tutor roster is current (${tutors.length} tutors)`);
    return;
  }

  fs.writeFileSync(outputPath, expected, 'utf8');
  console.log(`Synced ${tutors.length} tutors into lib/admin/tutors-data.js`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Tutor roster sync failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { buildOutput, main, makeFcTutorId, readTutorsFromBrain, validateTutors };
