/** @fileoverview Searchable admin destinations for the compact Go to control. */

import { ADMIN_NAV_ITEMS } from './admin-navigation.mjs';
import { WORKFLOW_DIRECTORY_GROUPS } from './workflow-directory.mjs';

const ALIASES = {
  '/admin/incoming-messages': ['inbox', 'messages', 'whatsapp', 'parent messages'],
  '/admin/finance/payroll': ['pay tutors', 'tutor pay', 'wages', 'salary'],
  '/admin/planning': ['reminders', 'tasks', 'actions'],
  '/admin/flags': ['flags', 'problems'],
  '/admin/waiting': ['enquiries', 'inquiries'],
  '/admin/workflows/parent-understanding': ['parents', 'family follow up'],
  '/admin/newsletter': ['mailchimp'],
  '/admin/lessons': ['calendar', 'data checks'],
};

const DESTINATIONS = [...ADMIN_NAV_ITEMS.map(({ href, label }) => ({ href, title: label })),
  ...WORKFLOW_DIRECTORY_GROUPS.flatMap(({ items }) => items.map(({ href, title }) => ({ href, title })))
].filter((item, index, all) => all.findIndex((candidate) => candidate.href === item.href) === index);

function normalise(value) {
  return String(value || '').trim().toLocaleLowerCase('en-GB').replace(/\s+/g, ' ');
}

export function getGoToDestinations(query, limit = 6) {
  const search = normalise(query);
  if (!search) return [];

  return DESTINATIONS.map((item) => {
    const title = normalise(item.title);
    const aliases = (ALIASES[item.href] || []).map(normalise);
    const terms = [title, ...aliases];
    let score = 0;
    if (title === search) score = 4;
    else if (title.startsWith(search)) score = 3;
    else if (aliases.some((alias) => alias === search || alias.startsWith(search))) score = 2;
    else if (terms.some((term) => term.split(' ').some((word) => word.startsWith(search)))) score = 1;
    return { ...item, score };
  })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit)
    .map(({ href, title }) => ({ href, title }));
}

export function getGoToSuggestions(query) {
  const search = String(query || '').trim();
  const destinations = search ? getGoToDestinations(search) : [
    { href: '/admin/planning', title: 'Planning' },
    { href: '/admin/finance/payroll', title: 'Payroll' },
    { href: '/admin/incoming-messages', title: 'Message Inbox' },
  ];
  const studentSearch = {
    href: search ? `/admin/students?q=${encodeURIComponent(search)}` : '/admin/students',
    title: search ? `Search students for “${search}”` : 'Find student',
    kind: 'student-search',
  };
  if (/^students?$/i.test(search)) return [{ ...studentSearch, href: '/admin/students', title: 'Students' }, ...destinations.map((item) => ({ ...item, kind: 'destination' }))];
  return [
    ...destinations.map((item) => ({ ...item, kind: 'destination' })),
    studentSearch,
  ];
}
