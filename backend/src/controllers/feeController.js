const crypto = require('crypto');
const Application = require('../models/Application');
const FeeRecord = require('../models/FeeRecord');
const { FEE_STATUS } = require('../config/constants');
const httpError = require('../utils/httpError');

// Like applications, fees are found through the logged-in applicant's own
// application; no fee or application id is ever accepted from the client.
async function findMyFee(userId) {
  const application = await Application.findOne({ applicant: userId });
  if (!application) {
    throw httpError(404, 'You have not started an application yet');
  }
  const fee = await FeeRecord.findOne({ application: application._id });
  if (!fee) {
    throw httpError(404, 'No fee is due yet. Submit your application first');
  }
  return fee;
}

// GET /api/fees/me
async function getMyFee(req, res) {
  res.json({ feeRecord: await findMyFee(req.user.id) });
}

// POST /api/fees/me/pay — MOCK payment: no gateway, no card details, no
// amount from the client. It simply marks the fee Paid.
async function payMyFee(req, res) {
  const fee = await findMyFee(req.user.id);

  // Atomic "only if still Pending", so a double click can't pay twice.
  const paid = await FeeRecord.findOneAndUpdate(
    { _id: fee._id, feeStatus: FEE_STATUS.PENDING },
    {
      $set: {
        feeStatus: FEE_STATUS.PAID,
        paidDate: new Date(),
        transactionRef: `MOCK-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
      },
    },
    { returnDocument: 'after' }
  );
  if (!paid) {
    throw httpError(409, 'Fee has already been paid');
  }
  res.json({ feeRecord: paid });
}

module.exports = { getMyFee, payMyFee };
