// Executable coverage for the media rules. These decide what is allowed into
// First Chord's Google Drive, so the negative cases matter more than the happy
// path.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACCEPTED_MEDIA,
  addItemMedia,
  buildMediaFileName,
  buildMediaFolderPath,
  describeMediaForConsent,
  describeMediaType,
  MEDIA_ITEMS_MAX,
  MEDIA_SIZE_CAPS,
  mediaSizeCapFor,
  normaliseMediaType,
  parseItemMedia,
  removeItemMedia,
  serialiseItemMedia,
  summariseItemMedia,
  validateMediaUpload,
} from '../../lib/admin/newsletter-media-helpers.mjs';

const FC_STUDENT = 'fc_std_fa157fc5';
const MONTH = '2026-09';

function upload(overrides = {}) {
  return validateMediaUpload({
    contentType: 'image/jpeg',
    contentLength: 2 * 1024 * 1024,
    issueMonth: MONTH,
    fcStudentId: FC_STUDENT,
    existingMedia: [],
    ...overrides,
  });
}

// --- type handling --------------------------------------------------------

test('MIME parameters are stripped before matching', () => {
  assert.equal(normaliseMediaType('image/jpeg; charset=binary'), 'image/jpeg');
  assert.equal(normaliseMediaType('  IMAGE/JPEG  '), 'image/jpeg');
  assert.equal(normaliseMediaType(''), '');
  assert.equal(describeMediaType('image/jpeg; boundary=x')?.kind, 'photo');
});

test('the accepted list is an allowlist, and every entry has a kind and extension', () => {
  for (const [mime, described] of Object.entries(ACCEPTED_MEDIA)) {
    assert.ok(['photo', 'audio', 'video'].includes(described.kind), `${mime} has an odd kind`);
    assert.match(described.ext, /^[a-z0-9]+$/u, `${mime} has an odd extension`);
    assert.ok(MEDIA_SIZE_CAPS[described.kind] > 0, `${mime} has no size cap`);
  }
});

test('anything not on the allowlist is refused, including things that look harmless', () => {
  // This endpoint writes into the school's Drive. A PDF or an SVG is not a
  // newsletter photo, and SVG in particular can carry script.
  for (const mime of [
    'application/pdf',
    'image/svg+xml',
    'text/html',
    'application/zip',
    'application/octet-stream',
    'image/gif',
    '',
    'image',
  ]) {
    assert.equal(
      upload({ contentType: mime }).error,
      'unsupported_media_type',
      `${JSON.stringify(mime)} must be refused`,
    );
  }
});

test('a photo, a voice note and a video are each accepted with their own cap', () => {
  const photo = upload({ contentType: 'image/jpeg' });
  assert.equal(photo.error, undefined);
  assert.equal(photo.kind, 'photo');
  assert.equal(photo.ext, 'jpg');
  assert.equal(photo.cap, MEDIA_SIZE_CAPS.photo);

  assert.equal(upload({ contentType: 'audio/mp4' }).kind, 'audio');
  assert.equal(upload({ contentType: 'video/quicktime' }).ext, 'mov');
  // An iPhone photo arrives as HEIC; refusing it would reject the commonest case.
  assert.equal(upload({ contentType: 'image/heic' }).kind, 'photo');

  assert.equal(mediaSizeCapFor('video/mp4'), MEDIA_SIZE_CAPS.video);
  assert.equal(mediaSizeCapFor('application/pdf'), 0);
});

// --- size and count -------------------------------------------------------

test('a declared size over the cap is refused before any bytes are read', () => {
  const tooBig = upload({ contentType: 'image/jpeg', contentLength: MEDIA_SIZE_CAPS.photo + 1 });
  assert.equal(tooBig.error, 'media_too_large');
  assert.equal(tooBig.cap, MEDIA_SIZE_CAPS.photo);

  // Exactly at the cap is allowed — an off-by-one here would reject a valid file.
  assert.equal(upload({ contentType: 'image/jpeg', contentLength: MEDIA_SIZE_CAPS.photo }).error, undefined);

  // A video under the video cap but over the photo cap is fine: caps are per kind.
  assert.equal(
    upload({ contentType: 'video/mp4', contentLength: MEDIA_SIZE_CAPS.photo + 1 }).error,
    undefined,
  );
});

test('an empty or missing body is refused, but an unknown length is allowed through to the stream', () => {
  assert.equal(upload({ contentLength: 0 }).error, 'media_empty');
  assert.equal(upload({ contentLength: -5 }).error, 'media_empty');
  // Content-Length is a claim. A chunked upload has none, so validation must not
  // reject it here — the streaming counter enforces the cap as bytes arrive.
  assert.equal(upload({ contentLength: null }).error, undefined);
  assert.equal(upload({ contentLength: 'nonsense' }).error, undefined);
});

test('a student cannot accumulate unlimited attachments', () => {
  const full = Array.from({ length: MEDIA_ITEMS_MAX }, (_, i) => ({ driveFileId: `f${i}` }));
  const result = upload({ existingMedia: full });
  assert.equal(result.error, 'too_many_media_items');
  assert.equal(result.cap, MEDIA_ITEMS_MAX);

  assert.equal(upload({ existingMedia: full.slice(0, -1) }).error, undefined);
});

test('identity and month are validated before type', () => {
  assert.equal(upload({ fcStudentId: '' }).error, 'fc_identity_unresolved');
  assert.equal(upload({ fcStudentId: 'sdt_WFQ7Js' }).error, 'fc_identity_unresolved');
  assert.equal(upload({ issueMonth: '2026-13' }).error, 'invalid_issue_month');
  // A bad month plus a bad type reports the month: refusing identity/scope first
  // means a malformed request never reaches the type allowlist.
  assert.equal(upload({ issueMonth: '', contentType: 'application/pdf' }).error, 'invalid_issue_month');
});

// --- naming ---------------------------------------------------------------

test('file names are readable but carry no meaning anything reads back', () => {
  const name = buildMediaFileName({
    issueMonth: MONTH,
    studentName: 'Hayley Adams',
    fcStudentId: FC_STUDENT,
    ext: 'jpg',
    uploadTicket: 'A1B2-C3D4-EEEE',
  });
  assert.equal(name, `2026-09_hayley-adams_${FC_STUDENT}_a1b2c3d4.jpg`);
});

test('file names survive awkward names without producing an unsafe path', () => {
  const name = buildMediaFileName({
    issueMonth: MONTH,
    studentName: '../../Éloïse  O’Brien/../',
    fcStudentId: FC_STUDENT,
    ext: 'png',
    uploadTicket: '',
  });
  assert.ok(!name.includes('/'), name);
  assert.ok(!name.includes('..'), name);
  assert.ok(name.includes('eloise-o-brien'), name);
  // A missing ticket still produces a usable name rather than a bare dot.
  assert.ok(name.endsWith('_upload.png'), name);

  const noName = buildMediaFileName({ issueMonth: MONTH, fcStudentId: FC_STUDENT, ext: 'jpg' });
  assert.ok(noName.includes('_student_'), noName);
});

test('the folder path is month-scoped and falls back safely', () => {
  assert.deepEqual(buildMediaFolderPath(MONTH), ['First Chord Newsletter', '2026-09']);
  assert.deepEqual(buildMediaFolderPath('nonsense'), ['First Chord Newsletter']);
});

// --- the stored media list ------------------------------------------------

test('media round-trips through the stored column', () => {
  const entry = {
    driveFileId: '1AbC',
    fileName: 'x.jpg',
    kind: 'photo',
    mimeType: 'image/jpeg',
    bytes: 1234,
    uploadedAt: '2026-09-12T10:00:00.000Z',
    uploadedBy: 'Dean',
    uploadTicket: 'abc12345',
  };
  const stored = serialiseItemMedia(addItemMedia([], entry));
  assert.deepEqual(parseItemMedia(stored), [entry]);
  assert.equal(serialiseItemMedia([]), '', 'no media stores an empty cell, not "[]"');
});

test('a hand-edited or corrupt cell reads as no media instead of throwing', () => {
  // Someone will open this tab in Google Sheets and edit a cell. That must not
  // break a render.
  for (const bad of ['not json', '{"a":1}', '[1,2,3]', '[{"noId":true}]', '   ', null, undefined]) {
    assert.deepEqual(parseItemMedia(bad), [], `${JSON.stringify(bad)} should read as empty`);
  }
});

test('a retried upload of the same ticket replaces its entry rather than attaching twice', () => {
  const first = addItemMedia([], { driveFileId: 'A', uploadTicket: 't1', kind: 'photo' });
  const retried = addItemMedia(first, { driveFileId: 'B', uploadTicket: 't1', kind: 'photo' });
  assert.equal(retried.length, 1, 'one ticket is one attachment');
  assert.equal(retried[0].driveFileId, 'B');

  const second = addItemMedia(retried, { driveFileId: 'C', uploadTicket: 't2', kind: 'audio' });
  assert.equal(second.length, 2);
  // An entry with no Drive id is not an attachment.
  assert.equal(addItemMedia(second, { uploadTicket: 't3' }).length, 2);
});

test('detaching media never implies deleting the file', () => {
  const media = [
    { driveFileId: 'A', kind: 'photo', uploadTicket: 't1' },
    { driveFileId: 'B', kind: 'audio', uploadTicket: 't2' },
  ];
  const { media: left, removed } = removeItemMedia(media, 'A');
  assert.deepEqual(left.map((m) => m.driveFileId), ['B']);
  // The caller gets the detached entry back so a human can be told the Drive file
  // is now unreferenced — deleting a child's photo is not automated.
  assert.equal(removed.driveFileId, 'A');

  assert.deepEqual(removeItemMedia(media, 'missing').media, media);
  assert.equal(removeItemMedia(media, '').removed, null);
});

test('media is summarised in words a human would use', () => {
  assert.equal(summariseItemMedia([]).label, '');
  assert.equal(summariseItemMedia([{ kind: 'photo' }]).label, '1 photo');
  assert.equal(summariseItemMedia([{ kind: 'photo' }, { kind: 'photo' }]).label, '2 photos');
  assert.equal(
    summariseItemMedia([{ kind: 'photo' }, { kind: 'audio' }]).label,
    '1 photo · 1 voice note',
  );
  assert.equal(summariseItemMedia([{ kind: 'video' }]).label, '1 video');
  assert.equal(summariseItemMedia([{ kind: 'photo' }, { kind: 'audio' }]).total, 2);
});

test('the consent ask names what the parent is actually being asked about', () => {
  // Asking about "a photo" when it is a video of their child is the kind of small
  // inaccuracy that makes a permission request untrustworthy.
  assert.equal(describeMediaForConsent([{ kind: 'video' }]), 'a video');
  assert.equal(describeMediaForConsent([{ kind: 'photo' }]), 'a photo');
  assert.equal(describeMediaForConsent([{ kind: 'photo' }, { kind: 'photo' }]), 'some photos');
  assert.equal(describeMediaForConsent([{ kind: 'photo' }, { kind: 'audio' }]), 'a photo and a recording');
  assert.equal(describeMediaForConsent([{ kind: 'audio' }]), 'a recording');
  assert.equal(describeMediaForConsent([]), 'a photo');
});
