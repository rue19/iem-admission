// Submission gating (spec section 8.2) as a pure function: given the
// application and its documents, list every reason it can't be submitted yet.
// An empty list means "go ahead". Kept separate from the controller so each
// rule can be unit-tested without HTTP or a database.
const { APPLICATION_STATUS } = require('../config/constants');
const { REQUIRED_DOCUMENT_TYPES } = require('../models/Document');

function getSubmissionBlockers({ application, courseExists, documents }) {
  const reasons = [];

  if (application.status !== APPLICATION_STATUS.DRAFT) {
    reasons.push(`Application has already been submitted (status: ${application.status})`);
    // Nothing else matters once it's past Draft.
    return reasons;
  }

  if (!application.course || !courseExists) {
    reasons.push('Select a course before submitting');
  }

  const pct = application.qualifyingPercent;
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 100) {
    reasons.push('Qualifying percentage must be between 0 and 100');
  }

  for (const type of REQUIRED_DOCUMENT_TYPES) {
    const doc = documents.find((d) => d.documentType === type);
    if (!doc) {
      reasons.push(`${type} has not been uploaded`);
    } else if (doc.validationStatus !== 'Valid') {
      reasons.push(`${type} is invalid (${doc.validationMessage}). Upload a corrected file`);
    }
  }

  return reasons;
}

module.exports = { getSubmissionBlockers };
