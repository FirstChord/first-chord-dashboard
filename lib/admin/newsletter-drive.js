/** @fileoverview Google Drive boundary for newsletter media: its own least-privilege credential, folder resolution, and a streaming resumable upload. */
import { Readable } from 'node:stream';
import { google } from 'googleapis';
import {
  buildMediaFolderPath,
  MEDIA_ROOT_FOLDER_NAME,
} from './newsletter-media-helpers.mjs';

// A credential of its own, never the Sheets or Gmail one.
//
// The scope is `drive.file`, which grants access only to files this application
// itself created. Even with the refresh token in hand, nothing here can read the
// rest of First Chord's Drive — which is the whole reason not to reuse an
// existing Google credential just because `googleapis` is already a dependency.
// Same rule the runbook states for GMAIL_REFRESH_TOKEN.
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export function getNewsletterDriveConfig(env = process.env) {
  const config = {
    clientId: env.DRIVE_CLIENT_ID || '',
    clientSecret: env.DRIVE_CLIENT_SECRET || '',
    refreshToken: env.DRIVE_REFRESH_TOKEN || '',
  };
  const missing = [];
  if (!config.clientId) missing.push('DRIVE_CLIENT_ID');
  if (!config.clientSecret) missing.push('DRIVE_CLIENT_SECRET');
  if (!config.refreshToken) missing.push('DRIVE_REFRESH_TOKEN');
  return { ...config, missing };
}

export function isNewsletterDriveConfigured(env = process.env) {
  return getNewsletterDriveConfig(env).missing.length === 0;
}

// Deliberately does not fall back to GOOGLE_CLIENT_ID / SHEETS_* the way the
// Gmail config falls back to GOOGLE_*. Sharing a client here would mean sharing
// a consent grant, and the point of this credential is that it is narrower than
// the others.
function driveClient(env = process.env) {
  const config = getNewsletterDriveConfig(env);
  if (config.missing.length) {
    throw new Error(`Newsletter Drive upload is not configured: missing ${config.missing.join(', ')}`);
  }
  const auth = new google.auth.OAuth2(config.clientId, config.clientSecret);
  auth.setCredentials({ refresh_token: config.refreshToken });
  return google.drive({ version: 'v3', auth, timeout: 120000 });
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';

// Cached per runtime: resolving the month folder costs two list calls, and a
// tutor uploading three photos in a row should pay for it once.
const folderCache = new Map(); // path key -> folder id

export function clearNewsletterDriveFolderCacheForTests() {
  folderCache.clear();
}

function escapeQueryValue(value = '') {
  return `${value}`.replace(/\\/gu, '\\\\').replace(/'/gu, "\\'");
}

// `drive.file` can only see what this app created, so a list by name returns our
// own folder or nothing. That is also why no folder ID needs to be stored in
// configuration: the app can always find its own tree, and cannot accidentally
// find somebody else's folder of the same name.
async function ensureFolder({ drive, name, parentId }) {
  const clauses = [
    `mimeType = '${FOLDER_MIME}'`,
    `name = '${escapeQueryValue(name)}'`,
    'trashed = false',
    parentId ? `'${escapeQueryValue(parentId)}' in parents` : "'root' in parents",
  ];

  const existing = await drive.files.list({
    q: clauses.join(' and '),
    fields: 'files(id, name)',
    pageSize: 2,
    spaces: 'drive',
  });

  const found = existing.data.files?.[0];
  if (found?.id) return found.id;

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: FOLDER_MIME,
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: 'id',
  });
  if (!created.data.id) {
    throw new Error(`Could not create the Drive folder "${name}"`);
  }
  return created.data.id;
}

export async function ensureNewsletterMediaFolder({ issueMonth = '', env = process.env } = {}) {
  const path = buildMediaFolderPath(issueMonth);
  const cacheKey = path.join('/');
  if (folderCache.has(cacheKey)) return folderCache.get(cacheKey);

  const drive = driveClient(env);
  let parentId = null;
  for (const segment of path) {
    parentId = await ensureFolder({ drive, name: segment, parentId });
  }

  folderCache.set(cacheKey, parentId);
  return parentId;
}

// Turns a Web ReadableStream (what a Next route handler gives you) into a Node
// stream, counting bytes as they pass and aborting if the declared cap is
// exceeded.
//
// Streaming rather than buffering is the point: a 60MB video read into memory on
// a Railway instance is how this feature would take the service down. The cap is
// re-enforced here because Content-Length is a claim the client makes, and the
// validation that trusted it ran before any bytes arrived.
export function countedNodeStream(webStream, { cap = Infinity } = {}) {
  const counter = { bytes: 0, exceeded: false };
  const source = Readable.fromWeb(webStream);

  const counted = new Readable({
    read() {
      // Driven by the source's events below.
    },
  });

  source.on('data', (chunk) => {
    counter.bytes += chunk.length;
    if (counter.bytes > cap) {
      counter.exceeded = true;
      source.destroy();
      counted.destroy(new Error('media_too_large'));
      return;
    }
    counted.push(chunk);
  });
  source.on('end', () => counted.push(null));
  source.on('error', (error) => counted.destroy(error));

  return { stream: counted, counter };
}

// Uploads one file and returns its stable Drive identity.
//
// The returned `id` is what gets stored — never the folder path or the file name.
// A human renaming or moving the file in Drive must not break the reference, and
// naming is for browsing only.
export async function uploadNewsletterMedia({
  issueMonth = '',
  fileName = '',
  mimeType = '',
  body = null,
  cap = Infinity,
  env = process.env,
} = {}) {
  if (!body) {
    throw new Error('uploadNewsletterMedia requires a request body stream');
  }

  const folderId = await ensureNewsletterMediaFolder({ issueMonth, env });
  const drive = driveClient(env);
  const { stream, counter } = countedNodeStream(body, { cap });

  try {
    const created = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId],
      },
      media: { mimeType, body: stream },
      fields: 'id, name, size, mimeType, webViewLink',
      // Resumable, so a large phone video over a poor connection is not
      // restarted from zero by a transient blip.
      uploadType: 'resumable',
    });

    if (!created.data.id) {
      throw new Error('Drive accepted the upload but returned no file ID');
    }

    return {
      driveFileId: created.data.id,
      fileName: created.data.name || fileName,
      mimeType: created.data.mimeType || mimeType,
      bytes: Number(created.data.size) || counter.bytes,
      webViewLink: created.data.webViewLink || '',
      folderId,
    };
  } catch (error) {
    if (counter.exceeded || error.message === 'media_too_large') {
      const tooLarge = new Error('media_too_large');
      tooLarge.code = 'media_too_large';
      throw tooLarge;
    }
    throw error;
  }
}

// Read-only reconciliation: files this app has put in a month folder. Used to
// find bytes in Drive that no item row references — the orphan case when Drive
// succeeds and the Sheets write does not. It never deletes anything.
export async function listNewsletterMediaFiles({ issueMonth = '', env = process.env } = {}) {
  const folderId = await ensureNewsletterMediaFolder({ issueMonth, env });
  const drive = driveClient(env);

  const files = [];
  let pageToken = '';
  do {
    const page = await drive.files.list({
      q: `'${escapeQueryValue(folderId)}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, size, mimeType, createdTime)',
      pageSize: 200,
      spaces: 'drive',
      ...(pageToken ? { pageToken } : {}),
    });
    for (const file of page.data.files || []) {
      files.push({
        driveFileId: file.id,
        fileName: file.name || '',
        bytes: Number(file.size) || 0,
        mimeType: file.mimeType || '',
        createdTime: file.createdTime || '',
      });
    }
    pageToken = page.data.nextPageToken || '';
  } while (pageToken);

  return { folderId, files, rootFolderName: MEDIA_ROOT_FOLDER_NAME };
}
