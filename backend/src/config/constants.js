// Every fixed vocabulary in the system lives here, so a rename (e.g. "Approved"
// -> "Selected") is a one-line change instead of a search across the codebase.

const ROLES = Object.freeze({
  APPLICANT: 'applicant',
  ADMIN: 'admin',
});

const APPLICATION_STATUS = Object.freeze({
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under Review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  WAITLISTED: 'Waitlisted',
});

module.exports = { ROLES, APPLICATION_STATUS };
