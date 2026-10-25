// D5 fee records. Created (Pending) when an application is submitted; set to
// Paid by the mock payment endpoint. No real gateway is involved.
const mongoose = require('mongoose');
const { FEE_STATUS } = require('../config/constants');

const feeRecordSchema = new mongoose.Schema(
  {
    // unique: exactly one fee record per application (Application 1-1 FeeRecord).
    application: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', required: true, unique: true },
    amount: { type: Number, required: true, min: 0 },
    feeStatus: { type: String, enum: Object.values(FEE_STATUS), default: FEE_STATUS.PENDING },
    createdDate: { type: Date, default: Date.now },
    paidDate: { type: Date, default: null },
    // Fake receipt number from the mock payment, so the UI has something to show.
    transactionRef: { type: String, default: null },
  },
  { timestamps: true }
);

feeRecordSchema.set('toJSON', {
  transform(doc, ret) {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('FeeRecord', feeRecordSchema);
