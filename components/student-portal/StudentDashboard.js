import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeftRight } from 'lucide-react';
import StudentNotesGate from './StudentNotesGate';
import StudentLinks from './StudentLinks';
import StudentSongs from './StudentSongs';
import HeaderGreenery from '@/components/tutor-dashboard/HeaderGreenery';
import TimeOfDaySky from '@/components/shared/TimeOfDaySky';
import { getStudentDashboardSwitch } from '@/lib/student-dashboard-switches.mjs';
import { getStudentDashboardFirstName } from '@/lib/student-portal-display.mjs';

function possessive(name = '') {
  return name.endsWith('s') ? `${name}’` : `${name}’s`;
}

export default function StudentDashboard({ student, assignedSongs = [] }) {
  if (!student) {
    return (
      <TimeOfDaySky className="min-h-screen flex items-center justify-center relative overflow-hidden">
        {/* Cloud */}
        <div className="absolute inset-0 pointer-events-none">
          <Image
            src="/cloud.png"
            alt=""
            width={192}
            height={128}
            className="absolute top-16 right-8 opacity-90 transform -rotate-12"
          />
        </div>
        
        <div className="bg-white rounded-2xl p-8 text-center shadow-xl max-w-md relative z-10">
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Oops!</h1>
          <p className="text-gray-600">
            We couldn't find your music dashboard. 
            Please check your link or contact your tutor.
          </p>
        </div>

        {/* First Chord Logo - Bottom Right Corner */}
        <div className="fixed bottom-4 right-4 z-10">
          <Image
            src="/first-chord-banner.png"
            alt="First Chord Music School - Explore Music Together"
            width={300}
            height={169}
            className="rounded-lg opacity-90 hover:opacity-100 transition-opacity duration-300"
            priority={false}
          />
        </div>
      </TimeOfDaySky>
    );
  }

  const dashboardSwitch = getStudentDashboardSwitch(student.id);
  const dashboardFirstName = getStudentDashboardFirstName(student);

  return (
    <TimeOfDaySky className="min-h-screen relative overflow-hidden">
      {/* Cloud */}
      <div className="absolute inset-0 pointer-events-none">
        <Image
          src="/cloud.png"
          alt=""
          width={192}
          height={128}
          className="absolute top-16 right-8 opacity-90 transform -rotate-12"
        />
      </div>
      
      {/* Header */}
      <header
        className="relative shadow-sm border-b border-white/30"
        style={{ background: 'var(--dashboard-header-background)' }}
      >
        <HeaderGreenery />
        <div className="relative px-4 sm:px-6 py-4 sm:py-5 text-center">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-gray-900">
            {possessive(dashboardFirstName)} Dashboard
          </h1>
          <p className="mt-1 text-sm sm:text-base text-gray-600">Welcome back!</p>
          {dashboardSwitch ? (
            <Link
              href={dashboardSwitch.href}
              className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-full border-2 border-[#2F6B3D]/30 bg-white/90 px-4 py-2 text-sm font-bold text-[#245530] shadow-sm transition-colors hover:border-[#2F6B3D]/50 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6B3D] focus-visible:ring-offset-2"
            >
              <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
              {dashboardSwitch.label}
            </Link>
          ) : null}
        </div>
      </header>

      <div className="p-4 sm:p-6 max-w-7xl mx-auto relative z-10">        
        <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
          {/* Notes Panel - Left Side (wider) */}
          <div className="lg:col-span-2">
            <StudentNotesGate studentId={student.id} studentName={student.name} />
          </div>
          
          {/* Links Panel - Right Side (narrower) */}
          <div className="lg:col-span-1">
            <StudentLinks student={student} />
          </div>
        </div>

        <div className="mt-4 sm:mt-6">
          <StudentSongs songs={assignedSongs} />
        </div>

      </div>

      {/* First Chord Logo - Bottom Right Corner */}
      <div className="fixed bottom-2 right-2 sm:bottom-4 sm:right-4 z-10 pointer-events-none">
        <Image
          src="/first-chord-banner.png"
          alt="First Chord Music School - Explore Music Together"
          width={150}
          height={85}
          className="sm:w-[250px] sm:h-[141px] rounded-lg opacity-80 sm:opacity-90 hover:opacity-100 transition-opacity duration-300"
          priority={false}
        />
      </div>
      
      {/* Bottom padding to prevent content overlap with logo */}
      <div className="h-20 sm:h-24"></div>
    </TimeOfDaySky>
  );
}
