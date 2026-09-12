// The Drive boundary. Three things this pins, all of which would be silent
// failures rather than loud ones:
//
//  1. the credential is its own, and never falls back to the Sheets or Gmail one
//  2. the size cap is enforced against the bytes that actually arrive, not the
//     Content-Length the client claimed
//  3. no newsletter module can reach a broad Drive scope
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

import {
  countedNodeStream,
  DRIVE_SCOPE,
  getNewsletterDriveConfig,
  isNewsletterDriveConfigured,
} from '../../lib/admin/newsletter-drive.js';

const repoRoot = path.resolve(import.meta.dirname, '../..');

// --- credential separation -------------------------------------------------

test('the Drive credential is its own, and reports exactly what is missing', () => {
  assert.deepEqual(getNewsletterDriveConfig({}).missing, [
    'DRIVE_CLIENT_ID',
    'DRIVE_CLIENT_SECRET',
    'DRIVE_REFRESH_TOKEN',
  ]);
  assert.equal(isNewsletterDriveConfigured({}), false);

  const configured = {
    DRIVE_CLIENT_ID: 'id',
    DRIVE_CLIENT_SECRET: 'secret',
    DRIVE_REFRESH_TOKEN: 'refresh',
  };
  assert.deepEqual(getNewsletterDriveConfig(configured).missing, []);
  assert.equal(isNewsletterDriveConfigured(configured), true);
});

test('Drive never borrows the Sheets or Gmail credential', () => {
  // The Gmail config deliberately falls back to GOOGLE_CLIENT_ID/SECRET. This one
  // must not: sharing an OAuth client here would mean sharing a consent grant,
  // and the entire point of this credential is that it is narrower than the
  // others. A fallback would silently widen it.
  const otherCredentials = {
    GOOGLE_CLIENT_ID: 'g-id',
    GOOGLE_CLIENT_SECRET: 'g-secret',
    GMAIL_CLIENT_ID: 'gm-id',
    GMAIL_CLIENT_SECRET: 'gm-secret',
    GMAIL_REFRESH_TOKEN: 'gm-refresh',
    SHEETS_CLIENT_ID: 's-id',
    SHEETS_CLIENT_SECRET: 's-secret',
    SHEETS_REFRESH_TOKEN: 's-refresh',
    MMS_BEARER_TOKEN: 'mms',
  };
  assert.equal(
    isNewsletterDriveConfigured(otherCredentials),
    false,
    'a Drive upload must not become possible just because other Google credentials exist',
  );
  assert.deepEqual(getNewsletterDriveConfig(otherCredentials).missing.length, 3);
});

test('the scope is drive.file — files this app created, and nothing else', () => {
  assert.equal(DRIVE_SCOPE, 'https://www.googleapis.com/auth/drive.file');

  // The broad scopes. `drive` would grant the whole of First Chord's Drive, and
  // `drive.readonly` would let a leaked token read every file in it.
  const source = fs.readFileSync(path.join(repoRoot, 'lib/admin/newsletter-drive.js'), 'utf8');
  for (const broad of [
    'auth/drive\'',
    'auth/drive"',
    'auth/drive.readonly',
    'auth/drive.metadata',
    'auth/drive.appdata',
  ]) {
    assert.ok(!source.includes(broad), `newsletter-drive.js must not reference ${broad}`);
  }
});

test('the minting script asks for drive.file and names the right env vars', () => {
  // The script is how the credential comes into existence, so a wrong scope here
  // produces a token that is over-privileged forever.
  const script = fs.readFileSync(path.join(repoRoot, 'scripts/mint-drive-token.mjs'), 'utf8');
  assert.ok(script.includes("'https://www.googleapis.com/auth/drive.file'"), 'scope must be drive.file');
  assert.ok(script.includes('DRIVE_REFRESH_TOKEN'));
  assert.ok(!script.includes('GMAIL_REFRESH_TOKEN'), 'the clone must not still mint a Gmail token');
  assert.ok(!/auth\/drive'/u.test(script), 'must not request the broad drive scope');
});

// --- the streaming cap -----------------------------------------------------

function webStreamOf(chunks) {
  return Readable.from(chunks).toWeb
    ? Readable.toWeb(Readable.from(chunks))
    : new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
}

async function drain(stream) {
  const seen = [];
  for await (const chunk of stream) seen.push(chunk);
  return Buffer.concat(seen);
}

test('a body within the cap streams through intact', async () => {
  const payload = Buffer.alloc(1024, 7);
  const { stream, counter } = countedNodeStream(webStreamOf([payload]), { cap: 4096 });
  const received = await drain(stream);

  assert.equal(received.length, 1024);
  assert.ok(received.equals(payload), 'bytes must pass through unchanged');
  assert.equal(counter.bytes, 1024);
  assert.equal(counter.exceeded, false);
});

test('a body that exceeds the cap is aborted mid-stream, not after it is all in memory', async () => {
  // This is the case Content-Length cannot protect against: the client declared
  // a small size (or none) and then sent more. Buffering first and checking after
  // is how a 60MB video takes the service down.
  const chunks = [Buffer.alloc(400, 1), Buffer.alloc(400, 2), Buffer.alloc(400, 3)];
  const { stream, counter } = countedNodeStream(webStreamOf(chunks), { cap: 500 });

  await assert.rejects(drain(stream), /media_too_large/u);
  assert.equal(counter.exceeded, true);
  assert.ok(counter.bytes <= 800, `aborted early, counted ${counter.bytes}`);
});

test('an empty body streams as empty rather than hanging', async () => {
  const { stream, counter } = countedNodeStream(webStreamOf([]), { cap: 1024 });
  const received = await drain(stream);
  assert.equal(received.length, 0);
  assert.equal(counter.bytes, 0);
});

test('a source error surfaces instead of truncating silently', async () => {
  // A dropped phone connection mid-upload must fail the request, not produce a
  // half file in Drive that looks complete.
  const failing = new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.alloc(10, 1));
      controller.error(new Error('connection lost'));
    },
  });
  const { stream } = countedNodeStream(failing, { cap: 1024 });
  await assert.rejects(drain(stream), /connection lost/u);
});

// --- architectural absence -------------------------------------------------

test('only the Drive boundary module talks to Drive', () => {
  // Routes and helpers must go through newsletter-drive.js, so the scope and the
  // credential have exactly one home. A second googleapis Drive client elsewhere
  // is how a broad scope gets introduced without anyone noticing.
  function walk(dir, found = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', '.next'].includes(entry.name)) continue;
        walk(full, found);
      } else if (/newsletter/iu.test(entry.name) && /\.(js|mjs)$/u.test(entry.name)) {
        found.push(full);
      }
    }
    return found;
  }

  const newsletterFiles = [
    ...walk(path.join(repoRoot, 'lib')),
    ...walk(path.join(repoRoot, 'app')),
    ...walk(path.join(repoRoot, 'components')),
  ];
  assert.ok(newsletterFiles.length >= 6, `expected newsletter modules, found ${newsletterFiles.length}`);

  const offenders = newsletterFiles.filter((file) => {
    if (path.basename(file) === 'newsletter-drive.js') return false;
    return /google\.drive\s*\(/u.test(fs.readFileSync(file, 'utf8'));
  }).map((file) => path.relative(repoRoot, file));

  assert.deepEqual(offenders, [], `Drive access must go through newsletter-drive.js: ${offenders.join(', ')}`);
});
