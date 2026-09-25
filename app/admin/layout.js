import Image from 'next/image';
import Link from 'next/link';
import { PawPrint } from 'lucide-react';
import { AdminSignOutButton } from '@/components/admin/AdminAuthButton';
import DashboardFeedbackButton from '@/components/admin/DashboardFeedbackButton';
import AdminPrimaryNavigation from '@/components/admin/AdminPrimaryNavigation';

// The whole /admin tree reads live data (Sheets, MMS) per request; without this,
// removing getServerSession from the layout lets Next.js try to prerender admin
// pages at build time, where those credentials aren't available.
export const dynamic = 'force-dynamic';

export default function AdminLayout({ children }) {
  return (
    <div className="min-h-screen bg-gradient-to-t from-green-100 to-blue-100 text-slate-900">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <Image
          src="/cloud.png"
          alt=""
          width={192}
          height={128}
          className="absolute top-24 right-6 opacity-80 -rotate-12"
        />
      </div>
      <header className="standalone-hide sticky top-0 z-20 border-b border-blue-100/40 bg-blue-100/90 backdrop-blur-sm shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-[#2F6B3D]/70">First Chord</p>
            <h1 className="fc-display flex items-center gap-2 text-2xl text-slate-900">
              Admin Dashboard
              <PawPrint className="h-5 w-5 shrink-0 fill-slate-900 text-slate-900" aria-label="Vince’s sign-off" />
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <DashboardFeedbackButton />
            <AdminSignOutButton />
          </div>
        </div>
        <nav aria-label="Admin dashboard" className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 pb-4">
          <AdminPrimaryNavigation />
          <form action="/admin/students" className="flex min-w-0 items-center gap-2">
            <input
              type="search"
              name="q"
              placeholder="Find student"
              className="h-9 w-44 rounded-full border border-blue-200/70 bg-white/80 px-4 text-sm text-slate-700 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:bg-white md:w-56"
            />
            <button
              type="submit"
              className="h-9 rounded-full border border-blue-200/70 bg-white/80 px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:border-blue-300 hover:bg-white hover:text-slate-900"
            >
              Search
            </button>
          </form>
        </nav>
      </header>
      {/* `relative` (z-auto) keeps content above the decorative cloud via DOM order
          without introducing another page-level stacking context. */}
      <main className="relative mx-auto max-w-7xl px-6 py-8">{children}</main>
      {/* The installed admin app launches into Inbox. Its full header is hidden
          in standalone mode, so this compact bar keeps the three useful mobile
          destinations reachable without creating separate installed apps. */}
      <nav className="standalone-only fixed bottom-4 left-1/2 z-30 -translate-x-1/2 items-center gap-1 rounded-full border border-[#2F6B3D]/25 bg-white/90 px-2 py-1 shadow-lg backdrop-blur">
        <Link href="/admin/incoming-messages" className="rounded-full px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-green-50 hover:text-[#2F6B3D]">Inbox</Link>
        <Link href="/admin/planning" className="rounded-full px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-green-50 hover:text-[#2F6B3D]">Planning</Link>
        <Link href="/admin" className="rounded-full px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-green-50 hover:text-[#2F6B3D]">Overview</Link>
      </nav>
    </div>
  );
}
