/** @fileoverview First Chord identity surface: friendly student URL slugs over the registry, re-exporting the pure fc helpers. */
import { getRegistryEntries } from '@/lib/admin/registry';
export { generateFcStudentId } from './fc-id.mjs';
export {
  normaliseExperienceLevel,
  normaliseInstrument,
  normaliseTeachingInstrument,
  parseInstrumentList,
} from './fc-helpers.mjs';

function slugify(value) {
  return (value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function generateFriendlyUrl(firstName, lastName) {
  const entries = await getRegistryEntries();
  const existing = new Set(entries.map((entry) => entry.friendlyUrl).filter(Boolean));
  const first = slugify(firstName);
  const lastInitial = slugify((lastName || '').slice(0, 1));

  if (first && !existing.has(first)) {
    return first;
  }

  const fallback = [first, lastInitial].filter(Boolean).join('-');
  if (fallback && !existing.has(fallback)) {
    return fallback;
  }

  let counter = 2;
  while (true) {
    const candidate = `${fallback || first}-${counter}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
    counter += 1;
  }
}
