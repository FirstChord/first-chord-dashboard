import AdminNewsletterPageClient from '@/components/admin/AdminNewsletterPageClient';
import { getNewsletterWorkflow } from '@/lib/admin/newsletter';

export const dynamic = 'force-dynamic';

export default async function AdminNewsletterPage({ searchParams }) {
  const params = await searchParams;
  const workflow = await getNewsletterWorkflow({
    issueMonth: `${params?.month || ''}`.trim(),
  });

  return <AdminNewsletterPageClient initialWorkflow={workflow} />;
}
