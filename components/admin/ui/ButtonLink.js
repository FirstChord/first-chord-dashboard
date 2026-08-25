import Link from 'next/link';
import { getButtonClassName } from '@/lib/admin/button-styles.mjs';

export function ButtonLink({
  children,
  variant = 'primary',
  size = 'default',
  className = '',
  ...props
}) {
  return (
    <Link
      className={getButtonClassName({ variant, size, className })}
      {...props}
    >
      {children}
    </Link>
  );
}
