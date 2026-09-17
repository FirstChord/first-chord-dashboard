// URL generators for each service

export const generateUrls = {
  soundslice: (student) => {
    const course = student.soundslice_course || '12954';
    // Check if it's already a full URL or just a course ID
    if (course.startsWith('http')) {
      return course;
    }
    return `https://www.soundslice.com/courses/${course}/`;
  },

  thetaMusic: (studentId) => 
    `https://trainer.thetamusic.com/student/exercises?id=${studentId}`,

  myMusicStaff: (studentId) => 
    `https://app.mymusicstaff.com/Teacher/v2/en/students/details?id=${studentId}#AttendanceNotes`
};

// Smart URL generator that handles authentication state
export const generateSmartUrls = {
  soundslice: (student) => {
    if (!student) {
      return {
        url: 'https://www.soundslice.com/courses/12954/',
        requiresAuth: false,
        instruction: 'Access course materials'
      };
    }
    const course = student.soundslice_course || '12954';
    // Check if it's already a full URL or just a course ID
    const url = course.startsWith('http') ? course : `https://www.soundslice.com/courses/${course}/`;
    return {
      url: url,
      requiresAuth: false, // Assumes already logged in
      instruction: 'Access course materials'
    };
  },
  
  myMusicStaff: (student) => {
    if (!student) {
      return {
        url: 'https://app.mymusicstaff.com/',
        requiresAuth: true,
        instruction: 'Login to view student details'
      };
    }
    return {
      url: `https://app.mymusicstaff.com/Teacher/v2/en/students/details?id=${student.mms_id}#AttendanceNotes`,
      requiresAuth: false, // Assumes tutor logged in
      instruction: 'Go to attendance & notes'
    };
  },
  
  thetaMusic: (student) => {
    return {
      url: student?.thetaUrl || 'https://trainer.thetamusic.com/en/user/login',
      requiresAuth: true,
      instruction: 'Open Theta Music Trainer'
    };
  }
};
