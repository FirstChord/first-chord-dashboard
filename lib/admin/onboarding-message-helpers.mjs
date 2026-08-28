/** @fileoverview Pure welcome-call guidance and onboarding message templates for new students. */

export const ONBOARDING_PAYMENT_EXPLANATION = 'Lessons are paid through a weekly Stripe subscription. The first payment pays for lesson one. We’ll check in before lesson two: if you’d like to continue, the subscription carries on weekly; if not, we’ll cancel it so no further weekly payments are taken.';

export const WELCOME_CALL_PROMPTS = [
  'Ask about their musical interests, goals and previous experience.',
  'Confirm the proposed tutor, lesson day and time, and when lesson one starts.',
  ONBOARDING_PAYMENT_EXPLANATION,
  'Explain that lesson details will live in their lesson WhatsApp group, with community and student-access steps to follow.',
];

function firstNameOnly(value, fallback = '') {
  const trimmed = `${value || ''}`.trim();
  if (!trimmed) return fallback;
  return trimmed.split(/\s+/u)[0] || fallback;
}

function firstNameList(values = []) {
  const names = values.map((value) => firstNameOnly(value, value)).filter(Boolean);
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function formatLessonDayAndDate(lessonDay, lessonDate) {
  const day = `${lessonDay || ''}`.trim();
  const date = `${lessonDate || ''}`.trim();
  if (!day) return date;
  if (!date) return day;

  return date.toLocaleLowerCase('en-GB').startsWith(`${day.toLocaleLowerCase('en-GB')} `)
    ? date
    : `${day} ${date}`;
}

export function buildOnboardingWelcomeMessage({
  studentName,
  studentFirstNamesLabel = '',
  parentName,
  lessonTime,
  lessonDay,
  lessonDate,
  tutorFullName,
  age,
  experienceLevel,
  interests,
  isAdult,
  lessonType = 'individual',
  paymentLink,
  groupPaymentLink,
  handbookUrl,
}) {
  const recipientFirstName = isAdult
    ? firstNameOnly(studentName, studentName)
    : firstNameOnly(parentName, parentName);
  const tutorFirstName = firstNameOnly(tutorFullName, tutorFullName);
  const resolvedPaymentLink = lessonType === 'sibling_group' ? groupPaymentLink : paymentLink;
  const learnerLabel = lessonType === 'sibling_group'
    ? studentFirstNamesLabel
    : firstNameOnly(studentName, studentName);
  const lessonDayAndDate = formatLessonDayAndDate(lessonDay, lessonDate);
  const paymentParagraph = `${ONBOARDING_PAYMENT_EXPLANATION}\n\nUse the link below to start the weekly subscription, and please let us know once it is set up.`;

  if (isAdult) {
    return `Hey ${recipientFirstName}, we've got you down for ${lessonTime} on ${lessonDayAndDate} with ${tutorFirstName}. ✨🎶

To give ${tutorFirstName} some context, you're ${experienceLevel} and love ${interests}!

📍The school is inside CC Music Shop at 33 Otago Street G12 8JJ. Just take a seat on the couch by the door when you arrive and ${tutorFirstName} will come meet you.

${paymentParagraph}

I'll also include a link to our welcome handbook which has more details about our teaching approach, homework, cancellation policies and more. 📖

Feel free to pop down any questions you have and one of us will be sure to get back to you!

Cheers! 😃

Payment Link 🔗: ${resolvedPaymentLink}

School Handbook 📖: ${handbookUrl}`;
  }

  return `Hey ${recipientFirstName}, we've got ${learnerLabel} down for ${lessonTime} on ${lessonDayAndDate} with ${tutorFirstName}. ✨🎶

To give ${tutorFirstName} some context, ${learnerLabel} ${lessonType === 'sibling_group' ? 'are' : 'is'} ${age || '—'} and ${experienceLevel}. They love ${interests}!

📍The school is inside CC Music Shop at 33 Otago Street G12 8JJ. Just take a seat on the couch by the door when you arrive and ${tutorFirstName} will come meet you.

${paymentParagraph}

I'll also include a link to our welcome handbook which has more details about our teaching approach, homework, cancellation policies and more. 📖

Feel free to pop down any questions you have and one of us will be sure to get back to you!

Cheers! 😃

Payment Link 🔗: ${resolvedPaymentLink}

School Handbook 📖: ${handbookUrl}`;
}

export function buildSoundsliceFollowup({ soundsliceCode, studentName, tutorFullName }) {
  const tutorFirstName = firstNameOnly(tutorFullName, tutorFullName);
  const learnerLabel = firstNameList(`${studentName || ''}`.split(' and '));
  return `Oo one last important thing to do. If you could head to soundslice.com and make a free account, then head to soundslice.com/coursecode and pop in this code *${soundsliceCode}* that will make a folder that ${learnerLabel} can access and ${tutorFirstName} can put in all the songs they are learning 💥`;
}
