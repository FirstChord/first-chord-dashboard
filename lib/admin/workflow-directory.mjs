/** @fileoverview Stable task-oriented groups for the admin Workflows directory. */

export const WORKFLOW_DIRECTORY_GROUPS = [
  {
    title: 'Families & enquiries',
    description: 'Messages, new families and family follow-up.',
    items: [
      {
        href: '/admin/incoming-messages',
        title: 'Message Inbox',
        description: 'Review parent messages and turn them into follow-up work.',
      },
      {
        href: '/admin/waiting',
        title: 'Waiting List',
        description: 'Move new enquiries towards placement and onboarding.',
      },
      {
        href: '/admin/workflows/parent-understanding',
        title: 'Parent Check-ins',
        description: 'Check family understanding and close follow-ups.',
      },
      {
        href: '/admin/workflows/student-notes-access',
        title: 'Student Notes Privacy',
        description: 'Help families activate private access to practice notes.',
      },
    ],
  },
  {
    title: 'Tutors & cover',
    description: 'Absence decisions, cover readiness and tutor handovers.',
    items: [
      {
        href: '/admin/workflows/tutor-absence',
        title: 'Tutor Absence',
        description: 'Choose cancel or cover, then complete the handover.',
      },
      {
        href: '/admin/workflows/cover-bank',
        title: 'Cover Bank',
        description: 'Record who can cover and when.',
      },
      {
        href: '/admin/tutors',
        title: 'Tutor Changes',
        description: 'Manage departures, handovers and live tutor choices.',
      },
    ],
  },
  {
    title: 'Regular school routines',
    description: 'Weekly and seasonal work that keeps the school moving.',
    items: [
      {
        href: '/admin/finance/payroll',
        title: 'Payroll',
        description: 'Review tutor pay from attendance every Wednesday.',
      },
      {
        href: '/admin/showcase',
        title: 'Showcase',
        description: 'Work through the recurring showcase checklist.',
      },
      {
        href: '/admin/holidays',
        title: 'Holidays',
        description: 'Prepare school breaks, pauses and family messages.',
      },
    ],
  },
  {
    title: 'School checks',
    description: 'Read-only evidence about money and lesson data.',
    items: [
      {
        href: '/admin/finance',
        title: 'Finance',
        description: 'Review revenue, costs, collections and upcoming pressure.',
      },
      {
        href: '/admin/lessons',
        title: 'Lesson Calendar & Data Checks',
        description: 'View the verified read-only week and investigate MMS mirror exceptions.',
      },
    ],
  },
];
