// Eligibility and merit (spec section 8.4). Pure functions: numbers in,
// decision out. No database or HTTP, so the decision table is easy to test.
const { FEE_STATUS } = require('../config/constants');

const MIN_QUALIFYING_PERCENT = 60;
const ENTRANCE_CUTOFF = 50; // out of 100
const SPORTS_QUOTA_BONUS = 5;
const MAX_MERIT = 100;

const MESSAGES = Object.freeze({
  ELIGIBLE: 'Eligible',
  FEE_PENDING: 'Application incomplete: fee payment pending',
  SCORE_MISSING: 'Application incomplete: entrance score not recorded',
  ENTRANCE_LOW: 'Not eligible: entrance score below qualifying cutoff.',
  QUALIFYING_LOW: 'Not eligible: qualifying percentage below minimum requirement.',
});

// Eligible only if ALL hold: qualifyingPercent >= 60, entranceScore >= 50 and
// the fee is Paid. When several fail, ONE message is reported, in this order:
//   1. fee not paid          (the application isn't complete yet)
//   2. entrance score missing (not in the spec's table; can't decide without it)
//   3. entrance score < 50
//   4. qualifying % < 60
// The cut-offs are inclusive: exactly 60 and exactly 50 pass.
function checkEligibility({ qualifyingPercent, entranceScore, feeStatus }) {
  if (feeStatus !== FEE_STATUS.PAID) {
    return { eligible: false, message: MESSAGES.FEE_PENDING };
  }
  if (entranceScore === null || entranceScore === undefined) {
    return { eligible: false, message: MESSAGES.SCORE_MISSING };
  }
  if (entranceScore < ENTRANCE_CUTOFF) {
    return { eligible: false, message: MESSAGES.ENTRANCE_LOW };
  }
  if (qualifyingPercent < MIN_QUALIFYING_PERCENT) {
    return { eligible: false, message: MESSAGES.QUALIFYING_LOW };
  }
  return { eligible: true, message: MESSAGES.ELIGIBLE };
}

// Exactly the spec's pseudocode:
//   score = 0
//   if entranceScore >= 50:
//       score = qualifyingPercent*0.4 + entranceScore*0.6
//       if sportsQuota: score += 5
//       if score > 100: score = 100
//   return score
// plus rounding to 2 decimals. Without it, 77.7*0.4 + 66.6*0.6 gives
// 71.03999999999999 (binary floating point can't store 0.4 or 0.6 exactly).
function calculateMeritScore(qualifyingPercent, entranceScore, sportsQuota) {
  let score = 0;
  if (entranceScore >= ENTRANCE_CUTOFF) {
    score = qualifyingPercent * 0.4 + entranceScore * 0.6;
    if (sportsQuota) score += SPORTS_QUOTA_BONUS;
    if (score > MAX_MERIT) score = MAX_MERIT;
  }
  return Math.round(score * 100) / 100;
}

module.exports = {
  MIN_QUALIFYING_PERCENT,
  ENTRANCE_CUTOFF,
  MESSAGES,
  checkEligibility,
  calculateMeritScore,
};
