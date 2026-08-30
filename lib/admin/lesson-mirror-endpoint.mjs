/** @fileoverview Secret-gated daily lesson-mirror scheduling with bounded London calendar windows. */
import { lessonMirrorFailureCode } from './lesson-mirror-store.mjs';
import { syncMmsLessonMirror } from './lesson-mirror-sync.mjs';
import { buildScheduledLessonMirrorWindow } from './lesson-window-helpers.mjs';

export {
  buildScheduledLessonMirrorWindow,
  LESSON_MIRROR_FUTURE_DAYS,
  LESSON_MIRROR_LOOKBACK_DAYS,
} from './lesson-window-helpers.mjs';

function clean(value = '') {
  return `${value ?? ''}`.trim();
}

function timingSafeEqualString(leftValue = '', rightValue = '') {
  const left = clean(leftValue);
  const right = clean(rightValue);
  if (!left || !right || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export function createLessonMirrorPostHandler({
  sync = syncMmsLessonMirror,
  now = () => new Date(),
  env = process.env,
} = {}) {
  return async function POST(request) {
    const expectedSecret = clean(env.SCHEDULE_REFRESH_SECRET);
    if (!expectedSecret) {
      return Response.json({ error: 'Lesson mirror schedule is not configured' }, { status: 503 });
    }
    const providedSecret = request.headers.get('x-firstchord-schedule-secret') || '';
    if (!timingSafeEqualString(providedSecret, expectedSecret)) {
      return Response.json({ error: 'Invalid or missing schedule refresh secret' }, { status: 401 });
    }

    const window = buildScheduledLessonMirrorWindow({ at: now() });
    try {
      const result = await sync({
        startDate: window.startDate,
        endDateExclusive: window.endDateExclusive,
        triggerKind: 'scheduled',
      });
      return Response.json({
        success: true,
        window,
        syncRunId: result.syncRunId,
        status: result.status,
        seriesCount: result.seriesCount,
        eventCount: result.eventCount,
        participationCount: result.participationCount,
      });
    } catch (error) {
      const failureCode = lessonMirrorFailureCode(error);
      console.error('Scheduled lesson mirror sync failed', {
        failureCode,
        trackingFailed: Boolean(error?.lessonMirrorTrackingError),
      });
      return Response.json({
        success: false,
        error: 'Scheduled lesson mirror sync failed',
        failureCode,
        window,
      }, { status: 500 });
    }
  };
}
