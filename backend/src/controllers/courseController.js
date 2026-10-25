const Course = require('../models/Course');

// GET /api/courses — the dropdown on the application form.
async function listCourses(req, res) {
  const courses = await Course.find().sort({ courseName: 1 });
  res.json({ courses });
}

module.exports = { listCourses };
