/** @fileoverview Redirects admin-only legacy CSV bookmarks to the reviewed batch handoff. */
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/admin/auth';
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) return new Response('Not authorised', { status: 403 });
  redirect('/admin/finance/payroll');
}
