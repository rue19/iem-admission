// Phase 4 unit tests: the status state machine (services/statusWorkflow.js)
// and the submission gate (services/submissionGate.js).
const { APPLICATION_STATUS: S } = require('../src/config/constants');
const {
  canTransition,
  allowedNextStatuses,
  assertTransition,
} = require('../src/services/statusWorkflow');
const { getSubmissionBlockers } = require('../src/services/submissionGate');

const ALL = Object.values(S);

// The complete list of legal moves from the spec, and who makes each.
const ALLOWED = [
  [S.DRAFT, S.SUBMITTED, 'applicant'],
  [S.SUBMITTED, S.UNDER_REVIEW, 'admin'],
  [S.UNDER_REVIEW, S.APPROVED, 'admin'],
  [S.UNDER_REVIEW, S.REJECTED, 'admin'],
  [S.UNDER_REVIEW, S.WAITLISTED, 'admin'],
  [S.WAITLISTED, S.APPROVED, 'admin'],
  [S.WAITLISTED, S.REJECTED, 'admin'],
];
const isAllowed = (from, to) => ALLOWED.some(([f, t]) => f === from && t === to);

describe('statusWorkflow — allowed transitions', () => {
  test.each(ALLOWED)('WF-01 %s -> %s is allowed for %s', (from, to, role) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to, role)).not.toThrow();
  });
});

describe('statusWorkflow — every other pair is illegal', () => {
  // All 36 from/to combinations minus the 7 legal ones = 29 illegal moves,
  // including "same status" (e.g. Draft -> Draft) and leaving a final state.
  const illegal = ALL.flatMap((from) => ALL.map((to) => [from, to])).filter(([f, t]) => !isAllowed(f, t));

  test('WF-02 there are exactly 29 illegal pairs', () => {
    expect(illegal).toHaveLength(29);
  });

  test.each(illegal)('WF-03 %s -> %s is rejected with 409', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    for (const role of ['applicant', 'admin']) {
      expect(() => assertTransition(from, to, role)).toThrow(/Illegal status change/);
      try {
        assertTransition(from, to, role);
      } catch (err) {
        expect(err.status).toBe(409);
      }
    }
  });

  test.each(['Selected', 'approved', '', undefined])('WF-04 unknown status %p is rejected', (to) => {
    expect(canTransition(S.UNDER_REVIEW, to)).toBe(false);
    expect(canTransition(to, S.APPROVED)).toBe(false);
  });
});

describe('statusWorkflow — who may make each move', () => {
  test('WF-05 an admin cannot submit on the applicant\'s behalf', () => {
    expect(() => assertTransition(S.DRAFT, S.SUBMITTED, 'admin')).toThrow(/Only an applicant/);
  });

  test.each(ALLOWED.filter(([, , role]) => role === 'admin'))(
    'WF-06 an applicant cannot move %s -> %s',
    (from, to) => {
      expect(() => assertTransition(from, to, 'applicant')).toThrow(/Only an admin/);
    }
  );

  test('WF-07 allowedNextStatuses lists only moves that role may make', () => {
    expect(allowedNextStatuses(S.DRAFT, 'applicant')).toEqual([S.SUBMITTED]);
    expect(allowedNextStatuses(S.DRAFT, 'admin')).toEqual([]);
    expect(allowedNextStatuses(S.SUBMITTED, 'admin')).toEqual([S.UNDER_REVIEW]);
    expect(allowedNextStatuses(S.UNDER_REVIEW, 'admin')).toEqual([S.APPROVED, S.REJECTED, S.WAITLISTED]);
    expect(allowedNextStatuses(S.WAITLISTED, 'admin')).toEqual([S.APPROVED, S.REJECTED]);
  });

  test.each([S.APPROVED, S.REJECTED])('WF-08 %s is final: no way out', (status) => {
    expect(allowedNextStatuses(status)).toEqual([]);
  });
});

describe('submissionGate — getSubmissionBlockers', () => {
  const valid = (documentType) => ({ documentType, validationStatus: 'Valid' });
  const base = () => ({
    application: { status: S.DRAFT, course: 'course-id', qualifyingPercent: 80 },
    courseExists: true,
    documents: [valid('Identity Proof'), valid('Academic Certificate')],
  });

  test('GATE-01 a complete Draft has no blockers', () => {
    expect(getSubmissionBlockers(base())).toEqual([]);
  });

  test('GATE-02 the optional "Other" slot never blocks, even when Invalid (spec: required docs only)', () => {
    const input = base();
    input.documents.push({ documentType: 'Other', validationStatus: 'Invalid', validationMessage: 'File is empty' });
    expect(getSubmissionBlockers(input)).toEqual([]);
  });

  test('GATE-03 not Draft blocks, and is the only reason given', () => {
    const input = base();
    input.application.status = S.SUBMITTED;
    input.documents = [];
    expect(getSubmissionBlockers(input)).toEqual(['Application has already been submitted (status: Submitted)']);
  });

  test('GATE-04 missing or deleted course blocks', () => {
    const input = base();
    input.courseExists = false;
    expect(getSubmissionBlockers(input)).toEqual(['Select a course before submitting']);
  });

  test.each([-1, 100.5, NaN, null, '80'])('GATE-05 qualifyingPercent %p blocks', (pct) => {
    const input = base();
    input.application.qualifyingPercent = pct;
    expect(getSubmissionBlockers(input)).toEqual(['Qualifying percentage must be between 0 and 100']);
  });

  test('GATE-06 each missing required document is listed', () => {
    const input = base();
    input.documents = [];
    expect(getSubmissionBlockers(input)).toEqual([
      'Identity Proof has not been uploaded',
      'Academic Certificate has not been uploaded',
    ]);
  });

  test('GATE-07 an invalid required document blocks, with its reason', () => {
    const input = base();
    input.documents[1] = {
      documentType: 'Academic Certificate',
      validationStatus: 'Invalid',
      validationMessage: 'File is empty',
    };
    expect(getSubmissionBlockers(input)).toEqual([
      'Academic Certificate is invalid (File is empty). Upload a corrected file',
    ]);
  });
});
