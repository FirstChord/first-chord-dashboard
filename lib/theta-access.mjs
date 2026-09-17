/** @fileoverview Projects explicit per-student Theta exceptions into public login-link flags without exposing credentials. */
import { STUDENTS_REGISTRY } from './config/students-registry.js';

export const THETA_MUSIC_LOGIN_URL = 'https://trainer.thetamusic.com/en/user/login';

export function getThetaAccessForStudent(studentId = '') {
  const id = `${studentId || ''}`.trim();
  const student = STUDENTS_REGISTRY[id];

  if (student?.thetaEnabled !== true || !student.thetaUsername) {
    return null;
  }

  return {
    studentId: id,
    loginUrl: THETA_MUSIC_LOGIN_URL,
  };
}

export function enhanceStudentsWithThetaAccess(students = []) {
  return (students || []).map((student) => {
    const studentId = student?.mms_id || student?.ID || student?.id || '';
    const access = getThetaAccessForStudent(studentId);

    return access
      ? { ...student, hasTheta: true, thetaUrl: access.loginUrl }
      : student;
  });
}
