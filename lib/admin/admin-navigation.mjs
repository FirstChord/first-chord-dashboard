/** @fileoverview Admin navigation items and the rule mapping a route to its highlighted nav entry. */
export const ADMIN_NAV_ITEMS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/planning', label: 'Planning' },
  { href: '/admin/workflows', label: 'Workflows' },
  { href: '/admin/flags', label: 'Issues' },
];

const WORKFLOW_ROUTE_PREFIXES = [
  '/admin/workflows',
  '/admin/lessons',
  '/admin/tutors',
  '/admin/waiting',
  '/admin/onboard',
  '/admin/newsletter',
  '/admin/showcase',
  '/admin/holidays',
  '/admin/incoming-messages',
  '/admin/finance',
];

function isRouteWithin(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function getCurrentAdminNavHref(pathname = '') {
  if (pathname === '/admin') return '/admin';
  if (isRouteWithin(pathname, '/admin/planning')) return '/admin/planning';
  if (isRouteWithin(pathname, '/admin/flags')) return '/admin/flags';
  if (WORKFLOW_ROUTE_PREFIXES.some((prefix) => isRouteWithin(pathname, prefix))) {
    return '/admin/workflows';
  }
  return '';
}
