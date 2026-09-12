/** @fileoverview Pure newsletter media rules: accepted types, size caps, Drive file naming, and the media list stored on an item row. */
// No I/O. The Drive boundary lives in lib/admin/newsletter-drive.js; everything
// that decides *whether* an upload is allowed and *what it is called* is here so
// it can be run without a provider.

const FC_STUDENT_ID_PATTERN = /^fc_std_[a-f0-9]{8}$/u;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/u;

// Accepted types, and the extension each is stored with. An allowlist rather
// than a blocklist: this endpoint writes into First Chord's Google Drive, so
// anything not named here is refused. Keyed on the exact MIME the browser sends.
export const ACCEPTED_MEDIA = {
  'image/jpeg': { kind: 'photo', ext: 'jpg' },
  'image/png': { kind: 'photo', ext: 'png' },
  'image/webp': { kind: 'photo', ext: 'webp' },
  'image/heic': { kind: 'photo', ext: 'heic' },
  'image/heif': { kind: 'photo', ext: 'heif' },
  'audio/mpeg': { kind: 'audio', ext: 'mp3' },
  'audio/mp4': { kind: 'audio', ext: 'm4a' },
  'audio/aac': { kind: 'audio', ext: 'aac' },
  'audio/ogg': { kind: 'audio', ext: 'ogg' },
  'audio/wav': { kind: 'audio', ext: 'wav' },
  'audio/webm': { kind: 'audio', ext: 'weba' },
  'video/mp4': { kind: 'video', ext: 'mp4' },
  'video/quicktime': { kind: 'video', ext: 'mov' },
  'video/webm': { kind: 'video', ext: 'webm' },
};

// Per-kind caps. A phone photo is 3-8MB and a voice note about 1MB, so those are
// comfortable. Video is the awkward one: the bytes stream through Railway on
// their way to Drive, so the cap is a deliberate limit on how much a single
// request can cost rather than a guess at what a tutor might film.
export const MEDIA_SIZE_CAPS = {
  photo: 15 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  video: 60 * 1024 * 1024,
};

export const MEDIA_ITEMS_MAX = 6;

function clean(value = '') {
  return `${value ?? ''}`.trim();
}

// The MIME a browser sends may carry parameters (`image/jpeg; charset=binary`).
export function normaliseMediaType(contentType = '') {
  return clean(contentType).split(';')[0].trim().toLowerCase();
}

export function describeMediaType(contentType = '') {
  return ACCEPTED_MEDIA[normaliseMediaType(contentType)] || null;
}

export function mediaSizeCapFor(contentType = '') {
  const described = describeMediaType(contentType);
  return described ? MEDIA_SIZE_CAPS[described.kind] : 0;
}

// Everything that must be true before a byte is accepted. Returns the resolved
// kind/extension so the caller never re-derives them.
export function validateMediaUpload({
  contentType = '',
  contentLength = null,
  issueMonth = '',
  fcStudentId = '',
  existingMedia = [],
} = {}) {
  if (!MONTH_PATTERN.test(clean(issueMonth))) {
    return { error: 'invalid_issue_month' };
  }
  if (!FC_STUDENT_ID_PATTERN.test(clean(fcStudentId))) {
    return { error: 'fc_identity_unresolved' };
  }

  const described = describeMediaType(contentType);
  if (!described) {
    return { error: 'unsupported_media_type' };
  }

  const cap = MEDIA_SIZE_CAPS[described.kind];
  // Content-Length is a claim, not a guarantee — the streaming counter enforces
  // the same cap again while the body arrives. Checking it here avoids starting
  // an upload that is already known to be too big.
  //
  // "Absent" and "zero" must stay distinguishable: a chunked upload sends no
  // Content-Length at all, and `Number(null)` is 0, so converting first would
  // reject every chunked upload as empty.
  const hasDeclaredLength = contentLength !== null
    && contentLength !== undefined
    && clean(contentLength) !== '';
  const declared = hasDeclaredLength ? Number(contentLength) : NaN;
  if (Number.isFinite(declared) && declared > cap) {
    return { error: 'media_too_large', kind: described.kind, cap };
  }
  if (Number.isFinite(declared) && declared <= 0) {
    return { error: 'media_empty' };
  }

  if (existingMedia.length >= MEDIA_ITEMS_MAX) {
    return { error: 'too_many_media_items', cap: MEDIA_ITEMS_MAX };
  }

  return { kind: described.kind, ext: described.ext, cap, mimeType: normaliseMediaType(contentType) };
}

function slugify(value = '') {
  return clean(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 40);
}

// Human-readable, but the identity is always the Drive file ID. The name exists
// so somebody browsing the folder can tell what they are looking at; nothing
// reads meaning back out of it, and a rename in Drive breaks nothing.
export function buildMediaFileName({
  issueMonth = '',
  studentName = '',
  fcStudentId = '',
  ext = 'bin',
  uploadTicket = '',
} = {}) {
  const name = slugify(studentName) || 'student';
  const ticket = slugify(uploadTicket).replace(/-/gu, '').slice(0, 8) || 'upload';
  return `${clean(issueMonth)}_${name}_${clean(fcStudentId)}_${ticket}.${ext}`;
}

// Folder path is for humans too: First Chord Newsletter / 2026-09.
export const MEDIA_ROOT_FOLDER_NAME = 'First Chord Newsletter';

export function buildMediaFolderPath(issueMonth = '') {
  const month = clean(issueMonth);
  return MONTH_PATTERN.test(month)
    ? [MEDIA_ROOT_FOLDER_NAME, month]
    : [MEDIA_ROOT_FOLDER_NAME];
}

// --- the media list stored on an item row ---------------------------------

export function parseItemMedia(mediaJson = '') {
  const raw = clean(mediaJson);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        driveFileId: clean(entry.driveFileId),
        fileName: clean(entry.fileName),
        kind: clean(entry.kind),
        mimeType: clean(entry.mimeType),
        bytes: Number(entry.bytes) || 0,
        uploadedAt: clean(entry.uploadedAt),
        uploadedBy: clean(entry.uploadedBy),
        uploadTicket: clean(entry.uploadTicket),
      }))
      .filter((entry) => entry.driveFileId);
  } catch {
    // A row a human has edited by hand should not break the page. An
    // unparseable value reads as "no media attached", which is visible and
    // recoverable, rather than throwing inside a render.
    return [];
  }
}

export function serialiseItemMedia(media = []) {
  return media.length ? JSON.stringify(media) : '';
}

// Adding an uploaded file. Idempotent on `uploadTicket`: a retried upload that
// already reached Drive replaces its entry instead of attaching the file twice.
export function addItemMedia(existingMedia = [], entry = {}) {
  const ticket = clean(entry.uploadTicket);
  const next = {
    driveFileId: clean(entry.driveFileId),
    fileName: clean(entry.fileName),
    kind: clean(entry.kind),
    mimeType: clean(entry.mimeType),
    bytes: Number(entry.bytes) || 0,
    uploadedAt: clean(entry.uploadedAt),
    uploadedBy: clean(entry.uploadedBy),
    uploadTicket: ticket,
  };
  if (!next.driveFileId) return existingMedia;

  const replaced = ticket
    ? existingMedia.map((item) => (item.uploadTicket === ticket ? next : item))
    : existingMedia;
  const alreadyPresent = ticket && existingMedia.some((item) => item.uploadTicket === ticket);
  return alreadyPresent ? replaced : [...existingMedia, next];
}

// A tutor removing something they just attached by mistake. The Drive file is
// deliberately NOT deleted here: detaching a reference is cheap and reversible,
// where deleting a child's photo is neither, and the data-protection policy does
// not authorise automated deletion. The orphan is reported for a human.
export function removeItemMedia(existingMedia = [], driveFileId = '') {
  const target = clean(driveFileId);
  if (!target) return { media: existingMedia, removed: null };
  const removed = existingMedia.find((item) => item.driveFileId === target) || null;
  return {
    media: existingMedia.filter((item) => item.driveFileId !== target),
    removed,
  };
}

export function summariseItemMedia(media = []) {
  const counts = media.reduce((totals, item) => ({
    ...totals,
    [item.kind || 'other']: (totals[item.kind || 'other'] || 0) + 1,
  }), {});
  const parts = [
    counts.photo ? `${counts.photo} photo${counts.photo === 1 ? '' : 's'}` : '',
    counts.video ? `${counts.video} video${counts.video === 1 ? '' : 's'}` : '',
    counts.audio ? `${counts.audio} voice note${counts.audio === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return { counts, label: parts.join(' · '), total: media.length };
}

// What the consent message should call the attachment, so the ask names the
// thing the parent is being asked about.
export function describeMediaForConsent(media = []) {
  const { counts } = summariseItemMedia(media);
  if (counts.video) return 'a video';
  if (counts.photo && counts.audio) return 'a photo and a recording';
  if (counts.photo) return counts.photo === 1 ? 'a photo' : 'some photos';
  if (counts.audio) return 'a recording';
  return 'a photo';
}
