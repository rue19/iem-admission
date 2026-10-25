// The application status state machine (spec section 8.3). This map is the
// ONLY place that decides which status changes are legal and who may make
// them. Anything not listed here, including "change to the same status", is
// rejected with 409.
const { APPLICATION_STATUS: S, ROLES } = require('../config/constants');
const httpError = require('../utils/httpError');

// from -> { to: role allowed to make that change }
const TRANSITIONS = Object.freeze({
  [S.DRAFT]: { [S.SUBMITTED]: ROLES.APPLICANT }, // via POST /submit
  [S.SUBMITTED]: { [S.UNDER_REVIEW]: ROLES.ADMIN },
  [S.UNDER_REVIEW]: {
    [S.APPROVED]: ROLES.ADMIN,
    [S.REJECTED]: ROLES.ADMIN,
    [S.WAITLISTED]: ROLES.ADMIN,
  },
  [S.WAITLISTED]: {
    [S.APPROVED]: ROLES.ADMIN,
    [S.REJECTED]: ROLES.ADMIN,
  },
  // Approved and Rejected are final: no way out.
  [S.APPROVED]: {},
  [S.REJECTED]: {},
});

// Is from -> to in the map at all (for anyone)?
function canTransition(from, to) {
  return Object.hasOwn(TRANSITIONS[from] ?? {}, to);
}

// The statuses `role` may move an application to from `from`. The admin page
// uses this to enable only the buttons the server would accept.
function allowedNextStatuses(from, role) {
  return Object.entries(TRANSITIONS[from] ?? {})
    .filter(([, allowedRole]) => role === undefined || allowedRole === role)
    .map(([to]) => to);
}

// Throws 409 unless `role` may move an application from `from` to `to`.
function assertTransition(from, to, role) {
  if (!canTransition(from, to)) {
    throw httpError(409, `Illegal status change: ${from} → ${to}`);
  }
  if (TRANSITIONS[from][to] !== role) {
    throw httpError(409, `Only an ${TRANSITIONS[from][to]} can change status from ${from} to ${to}`);
  }
}

module.exports = { TRANSITIONS, canTransition, allowedNextStatuses, assertTransition };
