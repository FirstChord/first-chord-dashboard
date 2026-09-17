#!/usr/bin/env node

/**
 * Config Generator: Auto-generate 5 config files from Student Registry
 *
 * This script reads the single students-registry.js file and generates:
 * 1. lib/student-url-mappings.js
 * 2. lib/student-helpers.js
 * 3. lib/soundslice-mappings.js
 * 4. lib/config/theta-credentials.js
 * 5. lib/config/instruments.js
 *
 * Run: npm run generate-configs
 */

const fs = require('fs');
const path = require('path');

console.log('🔨 Generating config files from student registry...\n');

const shouldBackup = !process.argv.includes('--no-backup');

/**
 * Load the student registry
 */
function loadRegistry() {
  const registryPath = path.join(__dirname, '..', 'lib/config/students-registry.js');
  const content = fs.readFileSync(registryPath, 'utf8');

  // Extract the registry object using regex
  const registryMatch = content.match(/export const STUDENTS_REGISTRY = \{([\s\S]*?)\};/);

  if (!registryMatch) {
    throw new Error('Could not extract STUDENTS_REGISTRY from file');
  }

  const registryText = registryMatch[1];
  const registry = {};

  // Match each student entry
  // Pattern: 'sdt_XXXXXX': { ... }, // Name
  const studentPattern = /'(sdt_\w+)':\s*\{([^}]+)\},?\s*(?:\/\/\s*(.+))?/g;
  let match;

  while ((match = studentPattern.exec(registryText)) !== null) {
    const [, studentId, properties] = match;

    const student = {
      firstName: extractProperty(properties, 'firstName'),
      lastName: extractProperty(properties, 'lastName') || '',
      friendlyUrl: extractProperty(properties, 'friendlyUrl') || '',
      tutor: extractProperty(properties, 'tutor') || '',
      tutors: extractArrayProperty(properties, 'tutors') || null,
      instrument: extractProperty(properties, 'instrument') || null,
      soundsliceUrl: extractProperty(properties, 'soundsliceUrl') || null,
      thetaUsername: extractProperty(properties, 'thetaUsername') || null,
    };

    registry[studentId] = student;
  }

  return registry;
}

/**
 * Extract a property value from a string of object properties.
 *
 * Quotes inside a value are backslash-escaped in the registry (O'Neil -> 'O\'Neil'),
 * so the match must skip escaped quotes and then unescape. A naive [^']* stops at the
 * backslash and truncates the value — harmless in a comment, but this same helper
 * reads friendlyUrl and thetaUsername, where a truncated value would be a live bug.
 * Canonical definitions: escapeRegistryValue / unescapeRegistryValue in
 * lib/admin/registry-helpers.mjs (duplicated here because this is a CommonJS script).
 */
function extractProperty(propertiesText, propertyName) {
  const regex = new RegExp(`${propertyName}:\\s*'((?:[^'\\\\]|\\\\.)*)'`);
  const match = propertiesText.match(regex);
  if (!match) return null;
  return match[1].replaceAll("\\'", "'").replaceAll('\\\\', '\\');
}

/**
 * Extract an array property value from a string of object properties
 */
function extractArrayProperty(propertiesText, propertyName) {
  // Match pattern like: tutors: ['Patrick', 'Fennella']
  const regex = new RegExp(`${propertyName}:\\s*\\[([^\\]]+)\\]`);
  const match = propertiesText.match(regex);

  if (!match) return null;

  // Extract individual quoted strings from the array
  const arrayContent = match[1];
  const stringRegex = /'([^']+)'/g;
  const values = [];
  let stringMatch;

  while ((stringMatch = stringRegex.exec(arrayContent)) !== null) {
    values.push(stringMatch[1]);
  }

  return values.length > 0 ? values : null;
}

/**
 * Group students by tutor
 * Supports both single tutor (string) and multiple tutors (array)
 */
function groupByTutor(registry) {
  const tutorGroups = {};

  Object.entries(registry).forEach(([studentId, data]) => {
    // Handle both formats: tutor (string) and tutors (array)
    let tutorList;
    if (Array.isArray(data.tutors)) {
      // New format: tutors array for dual-tutor students
      tutorList = data.tutors;
    } else if (data.tutor) {
      // Old format: single tutor string (backward compatible)
      tutorList = [data.tutor];
    } else {
      // No tutor specified
      tutorList = ['Unknown'];
    }

    // Add student to EACH tutor's group
    tutorList.forEach(tutor => {
      if (!tutorGroups[tutor]) {
        tutorGroups[tutor] = [];
      }
      tutorGroups[tutor].push({ studentId, ...data });
    });
  });

  return tutorGroups;
}

/**
 * Generate student-url-mappings.js
 */
function generateUrlMappings(registry, tutorGroups) {
  let output = `// GENERATED — do not edit directly. Run: npm run generate-configs to regenerate.
// Friendly URL mappings for student portals
// Maps friendly names to MMS student IDs

export const STUDENT_URL_MAPPINGS = {\n`;

  // Add entries grouped by tutor
  Object.entries(tutorGroups)
    .sort(([tutorA], [tutorB]) => {
      // Sort tutors, with "Unknown" last
      if (tutorA === 'Unknown') return 1;
      if (tutorB === 'Unknown') return -1;
      return tutorA.localeCompare(tutorB);
    })
    .forEach(([tutor, students]) => {
      output += `  // ${tutor}'s students\n`;

      students.forEach(student => {
        const fullName = student.lastName
          ? `${student.firstName} ${student.lastName}`
          : student.firstName;
        output += `  '${student.friendlyUrl}': '${student.studentId}',`;
        output += ` `.repeat(Math.max(1, 28 - student.friendlyUrl.length - student.studentId.length));
        output += `// ${fullName}\n`;
      });

      output += '\n';
    });

  output += `};\n\n`;

  // Add helper functions
  output += `// Reverse mapping for getting friendly name from student ID
export const STUDENT_ID_TO_URL = Object.fromEntries(
  Object.entries(STUDENT_URL_MAPPINGS).map(([name, id]) => [id, name])
);

// Get student ID from friendly URL
export function getStudentIdFromUrl(friendlyName) {
  const normalizedName = friendlyName.toLowerCase().trim();
  return STUDENT_URL_MAPPINGS[normalizedName] || null;
}

// Get friendly URL from student ID
export function getFriendlyUrlFromId(studentId) {
  return STUDENT_ID_TO_URL[studentId] || null;
}

// Check if friendly name exists
export function isValidFriendlyName(friendlyName) {
  const normalizedName = friendlyName.toLowerCase().trim();
  return normalizedName in STUDENT_URL_MAPPINGS;
}

// Get all available friendly names
export function getAllFriendlyNames() {
  return Object.keys(STUDENT_URL_MAPPINGS);
}
`;

  return output;
}

/**
 * Generate student-helpers.js
 */
function generateStudentHelpers(registry, tutorGroups) {
  let output = `// GENERATED — do not edit directly. Run: npm run generate-configs to regenerate.
// Student portal helper functions
import { thetaCredentials } from '@/lib/config/theta-credentials';
import { getThetaAccessForStudent } from '@/lib/theta-access.mjs';

// Import existing soundslice mappings
import SOUNDSLICE_MAPPINGS from '@/lib/soundslice-mappings';

// Valid student IDs (security) - All students with friendly URLs
const VALID_STUDENT_IDS = [\n`;

  // Add student IDs grouped by tutor
  Object.entries(tutorGroups)
    .sort(([tutorA], [tutorB]) => {
      if (tutorA === 'Unknown') return 1;
      if (tutorB === 'Unknown') return -1;
      return tutorA.localeCompare(tutorB);
    })
    .forEach(([tutor, students]) => {
      output += `  // ${tutor}'s students\n`;

      students.forEach(student => {
        const fullName = student.lastName
          ? `${student.firstName} ${student.lastName}`
          : student.firstName;
        const url = student.friendlyUrl ? `(/${student.friendlyUrl})` : '';
        output += `  '${student.studentId}', // ${fullName} ${url}\n`;
      });

      output += '\n';
    });

  output += `];\n\n`;

  // Add helper functions
  output += `export function isValidStudentId(studentId) {
  return VALID_STUDENT_IDS.includes(studentId);
}

export function getStudentInfo(studentId) {
  if (!isValidStudentId(studentId)) {
    return null;
  }

  // The legacy credential is still read only to derive the display name. It is
  // never returned to the public page. Theta visibility is an explicit registry
  // exception and the browser/password manager remains responsible for login.
  const thetaCredential = thetaCredentials[studentId];
  const thetaAccess = getThetaAccessForStudent(studentId);
  const soundsliceUrl = SOUNDSLICE_MAPPINGS[studentId];

  return {
    id: studentId,
    name: extractNameFromCredentials(thetaCredential),
    soundsliceUrl: soundsliceUrl,
    hasSoundslice: !!soundsliceUrl,
    hasTheta: !!thetaAccess,
    thetaUrl: thetaAccess?.loginUrl || ''
  };
}

// Names come from the Theta credential ('mathildefc' -> 'Mathilde') because
// that is where they have always come from. It outlives the Theta button and
// has to be repointed at the registry before theta-credentials.js can go.
function extractNameFromCredentials(credential) {
  if (!credential) return 'Student';

  const name = credential.replace('fc', '').replace('firstchord', '');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function generateStudentUrl(studentId) {
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  return \`\${baseUrl}/student/\${studentId}\`;
}

// Get public student data. Notes are loaded through the portal access gate.
export async function getStudentData(studentId) {
  if (!isValidStudentId(studentId)) {
    return null;
  }

  const studentInfo = getStudentInfo(studentId);
  if (!studentInfo) return null;

  return studentInfo;
}
`;

  return output;
}

/**
 * Generate soundslice-mappings.js
 */
function generateSoundslice(registry, tutorGroups) {
  let output = `// GENERATED — do not edit directly. Run: npm run generate-configs to regenerate.
// Soundslice course URL mappings
// Maps MMS student IDs to their Soundslice course URLs

const SOUNDSLICE_MAPPINGS = {\n`;

  // Add entries grouped by tutor
  Object.entries(tutorGroups)
    .sort(([tutorA], [tutorB]) => {
      if (tutorA === 'Unknown') return 1;
      if (tutorB === 'Unknown') return -1;
      return tutorA.localeCompare(tutorB);
    })
    .forEach(([tutor, students]) => {
      output += `  // ${tutor}'s students\n`;

      students
        .filter(student => student.soundsliceUrl)
        .forEach(student => {
          const fullName = student.lastName
            ? `${student.firstName} ${student.lastName}`
            : student.firstName;
          output += `  '${student.studentId}': '${student.soundsliceUrl}', // ${fullName}\n`;
        });

      output += '\n';
    });

  output += `};\n\nexport default SOUNDSLICE_MAPPINGS;\n\n`;

  // Add helper functions
  output += `// Helper function to get Soundslice course URL for a student
export function getSoundsliceCourse(studentId) {
  return SOUNDSLICE_MAPPINGS[studentId] || null;
}

// Helper function to enhance student data with Soundslice courses
export function enhanceStudentsWithSoundslice(students) {
  return students.map(student => ({
    ...student,
    soundslice_course: getSoundsliceCourse(student.mms_id)
  }));
}
`;

  return output;
}

/**
 * Generate theta-credentials.js
 */
function generateTheta(registry, tutorGroups) {
  let output = `// GENERATED — do not edit directly. Run: npm run generate-configs to regenerate.
/**
 * Theta Music Trainer Credentials
 *
 * Maps MMS student IDs to their Theta Music login credentials.
 * Username and password are the same for all students.
 */

export const thetaCredentials = {\n`;

  // Add entries grouped by tutor
  Object.entries(tutorGroups)
    .sort(([tutorA], [tutorB]) => {
      if (tutorA === 'Unknown') return 1;
      if (tutorB === 'Unknown') return -1;
      return tutorA.localeCompare(tutorB);
    })
    .forEach(([tutor, students]) => {
      output += `  // ${tutor}'s students\n`;

      students
        .filter(student => student.thetaUsername)
        .forEach(student => {
          const fullName = student.lastName
            ? `${student.firstName} ${student.lastName}`
            : student.firstName;
          output += `  '${student.studentId}': '${student.thetaUsername}', // ${fullName}\n`;
        });

      output += '\n';
    });

  output += `};\n`;

  return output;
}

/**
 * Generate instruments.js
 */
function generateInstruments(registry, tutorGroups) {
  let output = `// GENERATED — do not edit directly. Run: npm run generate-configs to regenerate.
/**
 * Instrument Overrides
 *
 * Manual overrides for students whose instrument differs from what MMS reports.
 * Only add students here if the MMS instrument is incorrect.
 */

export const instrumentOverrides = {\n`;

  // Add entries grouped by tutor
  Object.entries(tutorGroups)
    .sort(([tutorA], [tutorB]) => {
      if (tutorA === 'Unknown') return 1;
      if (tutorB === 'Unknown') return -1;
      return tutorA.localeCompare(tutorB);
    })
    .forEach(([tutor, students]) => {
      const studentsWithInstruments = students.filter(student => student.instrument);

      if (studentsWithInstruments.length > 0) {
        output += `  // ${tutor}'s students\n`;

        studentsWithInstruments.forEach(student => {
          const fullName = student.lastName
            ? `${student.firstName} ${student.lastName}`
            : student.firstName;
          output += `  '${student.studentId}': '${student.instrument}', // ${fullName}\n`;
        });

        output += '\n';
      }
    });

  output += `};\n`;

  return output;
}

/**
 * Backup existing files
 */
function backupFiles() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const backupDir = path.join(__dirname, '..', 'backups', `configs-${timestamp}`);

  fs.mkdirSync(backupDir, { recursive: true });

  const filesToBackup = [
    'lib/student-url-mappings.js',
    'lib/student-helpers.js',
    'lib/soundslice-mappings.js',
    'lib/config/theta-credentials.js',
    'lib/config/instruments.js'
  ];

  filesToBackup.forEach(file => {
    const sourcePath = path.join(__dirname, '..', file);
    const backupPath = path.join(backupDir, path.basename(file));

    if (fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, backupPath);
    }
  });

  console.log(`📦 Backed up existing files to: backups/configs-${timestamp}/\n`);
  return backupDir;
}

/**
 * Write generated files
 */
function writeGeneratedFiles(files) {
  Object.entries(files).forEach(([filepath, content]) => {
    const fullPath = path.join(__dirname, '..', filepath);
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(`✓ Generated: ${filepath}`);
  });
}

/**
 * Main execution
 */
function main() {
  try {
    console.log('📂 Loading student registry...');
    const registry = loadRegistry();
    const studentCount = Object.keys(registry).length;
    console.log(`✓ Loaded ${studentCount} students\n`);

    console.log('👥 Grouping students by tutor...');
    const tutorGroups = groupByTutor(registry);
    const tutorCount = Object.keys(tutorGroups).length;
    console.log(`✓ Found ${tutorCount} tutors\n`);

    // Show tutor distribution
    console.log('📊 Students per tutor:');
    Object.entries(tutorGroups)
      .sort(([, studentsA], [, studentsB]) => studentsB.length - studentsA.length)
      .forEach(([tutor, students]) => {
        console.log(`   ${tutor}: ${students.length} students`);
      });
    console.log('');

    if (shouldBackup) {
      backupFiles();
    } else {
      console.log('📦 Skipping backup for generated config files (--no-backup)\n');
    }

    console.log('🔨 Generating config files...');

    const generatedFiles = {
      'lib/student-url-mappings.js': generateUrlMappings(registry, tutorGroups),
      'lib/student-helpers.js': generateStudentHelpers(registry, tutorGroups),
      'lib/soundslice-mappings.js': generateSoundslice(registry, tutorGroups),
      'lib/config/theta-credentials.js': generateTheta(registry, tutorGroups),
      'lib/config/instruments.js': generateInstruments(registry, tutorGroups)
    };

    writeGeneratedFiles(generatedFiles);

    console.log('\n✅ Config generation complete!\n');
    console.log(`📊 Summary:`);
    console.log(`   Total students: ${studentCount}`);
    console.log(`   Total tutors: ${tutorCount}`);
    console.log(`   Files generated: 5\n`);

    console.log(`Next steps:`);
    console.log(`1. Review the generated files`);
    console.log(`2. Run validation: npm run validate`);
    console.log(`3. Test locally: npm run dev`);
    console.log(`4. Build test: npm run build`);
    console.log(`5. Deploy: git add . && git commit && git push\n`);

  } catch (error) {
    console.error('❌ Generation failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
