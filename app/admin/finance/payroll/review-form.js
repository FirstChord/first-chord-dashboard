'use client';
import { useActionState } from 'react';
export default function PayrollReviewForm({ action, children, className }) {
  const [state, formAction] = useActionState(action, null);
  return <form action={formAction} className={className}>{children}{state?.error ? <p role="alert" className="mt-3 text-sm text-rose-800">{state.error}</p> : null}</form>;
}
