'use client';

import { Check, Loader2 } from 'lucide-react';
import { getButtonClassName } from '@/lib/admin/button-styles.mjs';

export function ActionButton({
  children,
  pending = false,
  success = false,
  disabled = false,
  variant = 'primary',
  size = 'default',
  className = '',
  pendingLabel,
  successLabel,
  icon = null,
  type = 'button',
  ...props
}) {
  const label = pending
    ? (pendingLabel || children)
    : success
      ? (successLabel || children)
      : children;
  return (
    <button
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      data-state={pending ? 'pending' : success ? 'success' : 'idle'}
      className={getButtonClassName({ variant: success ? 'success' : variant, size, className })}
      {...props}
    >
      {pending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : success ? <Check aria-hidden="true" className="h-4 w-4" /> : icon}
      {label}
    </button>
  );
}
