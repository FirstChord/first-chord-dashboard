/** @fileoverview Derives the first-name-only label shown at the top of student dashboards. */

import { STUDENTS_REGISTRY } from './config/students-registry.js';

export function getStudentDashboardFirstName(student = {}, registry = STUDENTS_REGISTRY) {
  const registryFirstName = `${registry?.[student.id]?.firstName || ''}`.trim();
  if (registryFirstName) return registryFirstName;

  return `${student.name || ''}`.trim().split(/\s+/u)[0] || 'Student';
}
