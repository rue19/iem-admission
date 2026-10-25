const Application = require('../models/Application');
const Course = require('../models/Course');
const Document = require('../models/Document');
const FeeRecord = require('../models/FeeRecord');
const { APPLICATION_STATUS, ROLES, APPLICATION_FEE_AMOUNT } = require('../config/constants');
const { assertTransition } = require('../services/statusWorkflow');
const { getSubmissionBlockers } = require('../services/submissionGate');
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

// POST /api/applications/me/submit — Draft -> Submitted, and create the fee.
async function submitMyApplication(req, res) {
  const application = await Application.findOne({ applicant: req.user.id });
  if (!application) {
    throw httpError(404, 'You have not started an application yet');
  }

  const [courseExists, documents] = await Promise.all([
    Course.exists({ _id: application.course }),
    Document.find({ application: application._id }),
  ]);
  const reasons = getSubmissionBlockers({ application, courseExists: !!courseExists, documents });
  if (reasons.length > 0) {
    // 400 with the first reason as the headline and all of them listed;
    // nothing is changed.
    return res.status(400).json({ error: reasons[0], reasons });
  }

  assertTransition(application.status, APPLICATION_STATUS.SUBMITTED, ROLES.APPLICANT);

  // Atomic: only flips the status if it is STILL Draft, so two submit clicks
  // arriving together can't both succeed.
  const submitted = await Application.findOneAndUpdate(
    { _id: application._id, status: APPLICATION_STATUS.DRAFT },
    { $set: { status: APPLICATION_STATUS.SUBMITTED } },
    { returnDocument: 'after' }
  ).populate('course');
  if (!submitted) {
    return res.status(400).json({ error: 'Application has already been submitted' });
  }

  // A standalone MongoDB has no multi-document transactions, so if creating
  // the fee record fails, put the status back by hand instead.
  let feeRecord;
  try {
    feeRecord = await FeeRecord.create({ application: submitted._id, amount: APPLICATION_FEE_AMOUNT });
  } catch (err) {
    await Application.updateOne({ _id: submitted._id }, { $set: { status: APPLICATION_STATUS.DRAFT } });
    throw err;
  }

  res.json({ applicationId: submitted._id, application: submitted, feeRecord });
}

module.exports = { createApplication, getMyApplication, updateMyApplication, submitMyApplication };
