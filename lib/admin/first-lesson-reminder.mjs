/** @fileoverview Schedules the remaining first-lesson Stripe work on the existing Planning card, retaining confirmations and history. */
import { isFirstLessonCheckinPlanningItem } from './first-lesson-loop-helpers.mjs';

function error(message, status) {
  return Object.assign(new Error(message), { status });
}

function requireOpenItem(item) {
  if (!item || !isFirstLessonCheckinPlanningItem(item)) throw error('First-lesson follow-up was not found', 404);
  if (['done', 'parked'].includes(item.status)) throw error('This first-lesson follow-up is already closed', 409);
}

export function createFirstLessonReminderScheduler({ getItem, getContext, save, now = () => new Date() }) {
  return async function schedule({ planningId, targetDate, actorEmail = '' }) {
    const date = `${targetDate || ''}`.trim();
    const parsed = new Date(`${date}T12:00:00Z`);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date <= today) {
      throw error('Choose a reminder date after today', 400);
    }
    const item = await getItem(planningId);
    requireOpenItem(item);
    const context = await getContext(item);
    if (!context?.onlyPaymentRemaining || context.progress.paymentDecision !== 'continue_weekly' || context.payment.mode !== 'stripe') {
      throw error('Finish the other checks before scheduling the remaining Stripe setup', 409);
    }
    const progressNote = `Stripe setup follow-up scheduled for ${date}; other first-lesson checks remain complete.`;
    if (item.status === 'waiting' && item.targetDate === date
      && item.progress?.some((entry) => entry.progressNote === progressNote)) return item;
    return save({
      planningId,
      item: { title: item.title, status: 'waiting', targetDate: date },
      actorEmail,
      progressNote,
      validateExisting: (fresh) => {
        requireOpenItem(fresh);
        if (fresh.linkedStudentId !== item.linkedStudentId) throw error('The linked student changed; refresh before scheduling', 409);
      },
    });
  };
}
