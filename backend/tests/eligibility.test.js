// Phase 6 unit tests: eligibility decision table and merit score paths
// (services/eligibility.js).
const { checkEligibility, calculateMeritScore, MESSAGES } = require('../src/services/eligibility');

describe('checkEligibility — decision table (Qualifying % / Entrance / Fee)', () => {
  // Q >= 60 ?   E >= 50 ?   Fee Paid ?   ->  result
  // Values chosen as clear passes (80 / 70) and clear fails (55 / 40).
  test.each([
    ['ELIG-1', 80, 70, 'Paid', true, MESSAGES.ELIGIBLE],
    ['ELIG-2', 80, 70, 'Pending', false, MESSAGES.FEE_PENDING],
    ['ELIG-3', 80, 40, 'Paid', false, MESSAGES.ENTRANCE_LOW],
    ['ELIG-4', 80, 40, 'Pending', false, MESSAGES.FEE_PENDING],
    ['ELIG-5', 55, 70, 'Paid', false, MESSAGES.QUALIFYING_LOW],
    ['ELIG-6', 55, 70, 'Pending', false, MESSAGES.FEE_PENDING],
    ['ELIG-7', 55, 40, 'Paid', false, MESSAGES.ENTRANCE_LOW],
    ['ELIG-8', 55, 40, 'Pending', false, MESSAGES.FEE_PENDING],
  ])('%s Q=%d E=%d fee=%s -> eligible=%p', (_id, qualifyingPercent, entranceScore, feeStatus, eligible, message) => {
    expect(checkEligibility({ qualifyingPercent, entranceScore, feeStatus })).toEqual({ eligible, message });
  });

  test('ELIG-9 the messages are exactly the spec\'s wording', () => {
    expect(MESSAGES.FEE_PENDING).toBe('Application incomplete: fee payment pending');
    expect(MESSAGES.ENTRANCE_LOW).toBe('Not eligible: entrance score below qualifying cutoff.');
    expect(MESSAGES.QUALIFYING_LOW).toBe('Not eligible: qualifying percentage below minimum requirement.');
  });
});

describe('checkEligibility — boundaries', () => {
  const paid = (q, e) => checkEligibility({ qualifyingPercent: q, entranceScore: e, feeStatus: 'Paid' });

  test('ELIG-10 exactly 60% and exactly 50 are eligible (inclusive cut-offs)', () => {
    expect(paid(60, 50).eligible).toBe(true);
  });

  test('ELIG-11 59.99% is below the minimum', () => {
    expect(paid(59.99, 90).message).toBe(MESSAGES.QUALIFYING_LOW);
  });

  test('ELIG-12 an entrance score of 49.99 is below the cutoff', () => {
    expect(paid(90, 49.99).message).toBe(MESSAGES.ENTRANCE_LOW);
  });

  test('ELIG-13 no fee record at all counts as unpaid', () => {
    expect(checkEligibility({ qualifyingPercent: 90, entranceScore: 90, feeStatus: undefined }).message).toBe(
      MESSAGES.FEE_PENDING
    );
  });

  test('ELIG-14 entrance score not recorded yet: incomplete, not "below cutoff"', () => {
    expect(paid(90, null)).toEqual({ eligible: false, message: MESSAGES.SCORE_MISSING });
  });
});

describe('calculateMeritScore — paths', () => {
  test('MERIT-01 below the entrance cutoff scores 0 (70, 40, false)', () => {
    expect(calculateMeritScore(70, 40, false)).toBe(0);
  });

  test('MERIT-02 weighted 40/60 score (70, 70, false) = 70.0', () => {
    expect(calculateMeritScore(70, 70, false)).toBe(70);
  });

  test('MERIT-03 sports quota adds 5 (70, 70, true) = 75.0', () => {
    expect(calculateMeritScore(70, 70, true)).toBe(75);
  });

  test('MERIT-04 capped at 100 (95, 100, true)', () => {
    // 95*0.4 + 100*0.6 + 5 = 103 -> 100
    expect(calculateMeritScore(95, 100, true)).toBe(100);
  });

  test('MERIT-05 below the cutoff, sports quota does not add anything', () => {
    expect(calculateMeritScore(90, 49, true)).toBe(0);
  });

  test('MERIT-06 exactly 50 is at the cutoff and is scored', () => {
    // 60*0.4 + 50*0.6 = 24 + 30 = 54
    expect(calculateMeritScore(60, 50, false)).toBe(54);
  });

  test('MERIT-07 a result of exactly 100 is not changed by the cap', () => {
    expect(calculateMeritScore(100, 100, false)).toBe(100);
  });

  test('MERIT-08 floating-point noise is rounded away (2 decimals)', () => {
    // Without rounding, 77.7*0.4 + 66.6*0.6 is 71.03999999999999.
    expect(77.7 * 0.4 + 66.6 * 0.6).not.toBe(71.04);
    expect(calculateMeritScore(77.7, 66.6, false)).toBe(71.04);
  });
});
