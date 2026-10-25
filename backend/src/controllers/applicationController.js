const Application = require('../models/Application');
const Course = require('../models/Course');
const { APPLICATION_STATUS } = require('../config/constants');
const httpError = require('../utils/httpError');

// Every query here filters by req.user.id (from the verified JWT). There is
// no route that takes an application id from an applicant, so one applicant
// can never name, read or change another applicant's application.

async function ensureCourseExists(courseId) {
  if (!(await Course.exists({ _id: courseId }))) {
    throw httpError(400, 'Selected course does not exist');
  }
}

// POST /api/applications — start a Draft.
async function createApplication(req, res) {
  const { course, qualifyingPercent, sportsQuota } = req.body;

  if (await Application.exists({ applicant: req.user.id })) {
    throw httpError(409, 'You already have an application');
  }
  await ensureCourseExists(course);

  // status and applicationDate are NOT taken from the body; the schema
  // defaults set them (Draft, now).
  const application = await Application.create({
    applicant: req.user.id,
    course,
    qualifyingPercent,
    sportsQuota,
  });
  await application.populate('course');

  res.status(201).json({ application });
}

// GET /api/applications/me — Track Application Status.
async function getMyApplication(req, res) {
  const application = await Application.findOne({ applicant: req.user.id }).populate('course');
  if (!application) {
    throw httpError(404, 'You have not started an application yet');
  }
  res.json({ application });
}

// PUT /api/applications/me — edit, but only while still a Draft.
async function updateMyApplication(req, res) {
  if (req.body.course) {
    await ensureCourseExists(req.body.course);
  }

  // The status condition is part of the query, so "check it's Draft" and
  // "save the change" happen as ONE atomic database operation. A submit that
  // lands between the two cannot be overwritten.
  const application = await Application.findOneAndUpdate(
    { applicant: req.user.id, status: APPLICATION_STATUS.DRAFT },
    { $set: req.body },
    { returnDocument: 'after', runValidators: true }
  ).populate('course');

  if (!application) {
    // Nothing matched: either there is no application, or it's past Draft.
    if (await Application.exists({ applicant: req.user.id })) {
      throw httpError(409, 'Application can only be edited while its status is Draft');
    }
    throw httpError(404, 'You have not started an application yet');
  }

  res.json({ application });
}

module.exports = { createApplication, getMyApplication, updateMyApplication };
