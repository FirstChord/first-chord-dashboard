'use client';

import { useFormStatus } from 'react-dom';
import { ActionButton } from './ActionButton';

// ActionButton for a <form action={serverAction}>. The form owns the async
// work, so pending comes from useFormStatus instead of useAsyncAction. The
// outcome is the re-rendered page the action revalidates or redirects to.
export function SubmitButton({ children, pendingLabel = 'Saving…', ...props }) {
  const { pending } = useFormStatus();
  return (
    <ActionButton type="submit" pending={pending} pendingLabel={pendingLabel} {...props}>
      {children}
    </ActionButton>
  );
}
