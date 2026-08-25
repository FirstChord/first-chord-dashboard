'use client';

import { useState } from 'react';
import { getButtonClassName } from '@/lib/admin/button-styles.mjs';

// One copy-to-clipboard control for the admin surfaces. The clipboard call and
// its "Copied ✓" confirmation were written out by hand in ten different page
// clients before this existed; new surfaces should use this rather than an
// eleventh copy.
//
// The textarea fallback is not decoration: navigator.clipboard is undefined on
// insecure origins, so without it "Copy" silently does nothing when the admin is
// reached over plain http (a phone on the local network, for instance).

function ClipboardIcon({ done }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      {done ? (
        <polyline points="20 6 9 17 4 12" />
      ) : (
        <>
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </>
      )}
    </svg>
  );
}

export default function CopyButton({
  text = '',
  label = '',
  title = 'Copy to clipboard',
  className = '',
  size = 'compact',
  onCopied,
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const value = `${text ?? ''}`;
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = value;
      textArea.setAttribute('readonly', '');
      textArea.style.position = 'absolute';
      textArea.style.left = '-9999px';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
      } finally {
        document.body.removeChild(textArea);
      }
    }

    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    if (typeof onCopied === 'function') onCopied(value);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={!`${text ?? ''}`}
      title={title}
      aria-label={label ? undefined : title}
      aria-live="polite"
      data-state={copied ? 'success' : 'idle'}
      className={getButtonClassName({
        variant: copied ? 'success' : 'subtle',
        size,
        className: `gap-1.5 ${className}`,
      })}
    >
      <ClipboardIcon done={copied} />
      {label || copied ? <span>{copied ? 'Copied' : label}</span> : null}
    </button>
  );
}
