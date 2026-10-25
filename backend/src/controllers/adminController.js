const path = require('path');
const mongoose = require('mongoose');
const env = require('../config/env');
const Application = require('../models/Application');
const Document = require('../models/Document');
const FeeRecord = require('../models/FeeRecord');
const User = require('../models/User');
const { APPLICATION_STATUS, ROLES } = require('../config/constants');
const { assertTransition, allowedNextStatuses } = require('../services/statusWorkflow');
const httpError = require('../utils/httpError');

// Admin-visible applicant fields. passwordHash is excluded by the model anyway;
// listing fields here also keeps responses small.
const APPLICANT_FIELDS = 'name email contactNumber';

function assertObjectId(id, label) {
  if (!mongoose.isValidObjectId(id)) {
    throw httpError(400, `Invalid ${label} id`);
  }
}

// Escapes regex special characters so a search for ".*" means the literal
// text ".*", not "match everything".
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// GET /api/admin/applications?status=&course=&q=
async function listApplications(req, res) {
  const { status, course, q } = req.validatedQuery;
  const filter = {};
  if (status) filter.status = status;
  if (course) filter.course = course;

  if (q) {
    // q may be an Application ID, or part of an applicant's name or email.
    const pattern = new RegExp(escapeRegex(q), 'i');
    const applicants = await User.find({ $or: [{ name: pattern }, { email: pattern }] }).select('_id');
    const or = [{ applicant: { $in: applicants.map((u) => u._id) } }];
    if (mongoose.isValidObjectId(q)) or.push({ _id: q });
    filter.$or = or;
  }

  // Drafts are visible too: an admin may want to see who has started but not
  // submitted. The status filter narrows it down.
  const applications = await Application.find(filter)
    .populate('applicant', APPLICANT_FIELDS)
    .populate('course')
    .sort({ updatedAt: -1 })
    .limit(200);

  res.json({ applications });
}

// GET /api/admin/applications/:id — everything the review screen needs.
async function getApplication(req, res) {
  assertObjectId(req.params.id, 'application');
  const application = await Application.findById(req.params.id)
    .populate('applicant', APPLICANT_FIELDS)
    .populate('course');
  if (!application) {
    throw httpError(404, 'Application not found');
  }

  const [documents, feeRecord] = await Promise.all([
    Document.find({ application: application._id }).sort({ documentType: 1 }),
    FeeRecord.findOne({ application: application._id }),
  ]);

  res.json({
    application,
    documents,
    feeRecord,
    // The UI enables exactly these buttons; the server re-checks on PATCH.
    allowedNextStatuses: allowedNextStatuses(application.status, ROLES.ADMIN),
  });
}

// PATCH /api/admin/applications/:id/status   { status }
async function updateStatus(req, res) {
  assertObjectId(req.params.id, 'application');
  const { status: next } = req.body;

  const current = await Application.findById(req.params.id);
  if (!current) {
    throw httpError(404, 'Application not found');
  }

  assertTransition(current.status, next, ROLES.ADMIN); // 409 if illegal

  // Atomic: only applies if the status is still what we just checked. If
  // another admin changed it in between, this matches nothing.
  const updated = await Application.findOneAndUpdate(
    { _id: current._id, status: current.status },
    { $set: { status: next } },
    { returnDocument: 'after' }
  )
    .populate('applicant', APPLICANT_FIELDS)
    .populate('course');
  if (!updated) {
    throw httpError(409, 'The status was changed by someone else. Reload and try again');
  }

  res.json({ application: updated, allowedNextStatuses: allowedNextStatuses(updated.status, ROLES.ADMIN) });
}

// Entrance scores belong to submitted applications that are still being decided.
const SCORABLE = [APPLICATION_STATUS.SUBMITTED, APPLICATION_STATUS.UNDER_REVIEW, APPLICATION_STATUS.WAITLISTED];

// PATCH /api/admin/applications/:id/entrance-score   { entranceScore }
async function setEntranceScore(req, res) {
  assertObjectId(req.params.id, 'application');

  const updated = await Application.findOneAndUpdate(
    { _id: req.params.id, status: { $in: SCORABLE } },
    { $set: { entranceScore: req.body.entranceScore } },
    { returnDocument: 'after', runValidators: true }
  )
    .populate('applicant', APPLICANT_FIELDS)
    .populate('course');

  if (!updated) {
    const existing = await Application.findById(req.params.id);
    if (!existing) throw httpError(404, 'Application not found');
    throw httpError(409, `Entrance score can't be recorded while the status is ${existing.status}`);
  }

  res.json({ application: updated });
}

// GET /api/admin/documents/:id/file — lets the admin open an uploaded file.
async function downloadDocument(req, res) {
  assertObjectId(req.params.id, 'document');
  const document = await Document.findById(req.params.id);
  if (!document) {
    throw httpError(404, 'Document not found');
  }
  if (!document.filePath) {
    // Invalid uploads were deleted from disk; only their metadata remains.
    throw httpError(404, 'This upload was rejected, so no file is stored');
  }

  // sendFile with `root` refuses any path that escapes the upload folder.
  const fileName = path.basename(document.filePath);
  res.type(document.mimeType);
  // filename* (RFC 5987) safely carries any characters in the original name.
  res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(document.originalName)}`);
  // Stop the browser guessing a different type (e.g. treating an upload as HTML).
  res.set('X-Content-Type-Options', 'nosniff');
  res.sendFile(fileName, { root: env.uploadDir });
}

module.exports = { listApplications, getApplication, updateStatus, setEntranceScore, downloadDocument };
