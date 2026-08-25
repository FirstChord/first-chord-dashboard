import assert from 'node:assert/strict';
import test from 'node:test';

import { getButtonClassName } from '../../lib/admin/button-styles.mjs';

test('all shared buttons acknowledge press, expose focus and respect reduced motion', () => {
  const className = getButtonClassName();

  assert.match(className, /active:translate-y-px/);
  assert.match(className, /active:scale-\[0\.98\]/);
  assert.match(className, /active:shadow-inner/);
  assert.match(className, /focus-visible:ring-2/);
  assert.match(className, /focus-visible:ring-offset-2/);
  assert.match(className, /motion-reduce:active:translate-y-0/);
  assert.match(className, /motion-reduce:active:scale-100/);
  assert.match(className, /disabled:cursor-not-allowed/);
});

test('button roles keep distinct visual hierarchy while sharing interaction states', () => {
  const primary = getButtonClassName({ variant: 'primary' });
  const secondary = getButtonClassName({ variant: 'secondary' });
  const warning = getButtonClassName({ variant: 'warning' });
  const danger = getButtonClassName({ variant: 'danger' });

  assert.match(primary, /bg-slate-900/);
  assert.match(secondary, /bg-white/);
  assert.match(warning, /bg-amber-50/);
  assert.match(danger, /text-red-800/);
  for (const className of [primary, secondary, warning, danger]) {
    assert.match(className, /active:/);
    assert.match(className, /focus-visible:/);
  }
});

test('ordinary and compact buttons use the documented target heights', () => {
  assert.match(getButtonClassName(), /min-h-11/);
  assert.match(getButtonClassName({ size: 'compact' }), /min-h-8/);
  assert.match(getButtonClassName({ size: 'large' }), /min-h-12/);
});

test('unknown style options fail safely to the primary default button', () => {
  const className = getButtonClassName({
    variant: 'not-a-real-variant',
    size: 'not-a-real-size',
    className: 'w-full',
  });

  assert.match(className, /bg-slate-900/);
  assert.match(className, /min-h-11/);
  assert.match(className, /w-full$/);
});
