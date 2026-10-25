// D2 applications. One document per applicant (POC simplification).
const mongoose = require('mongoose');
const { APPLICATION_STATUS } = require('../config/constants');

const applicationSchema = new mongoose.Schema(
  {
    // unique: the DATABASE guarantees one application per applicant, even if
    // two "create" requests arrive at the same moment.
    applicant: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    qualifyingPercent: { type: Number, required: true, min: 0, max: 100 },
    // Set by the admin after the entrance exam (Phase 5); null until then.
    entranceScore: { type: Number, min: 0, max: 100, default: null },
    sportsQuota: { type: Boolean, default: false },
    applicationDate: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: Object.values(APPLICATION_STATUS),
      default: APPLICATION_STATUS.DRAFT,
    },
    // Calculated in Phase 6; null until then.
    meritScore: { type: Number, default: null },
  },
  { timestamps: true }
);

applicationSchema.set('toJSON', {
  transform(doc, ret) {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Application', applicationSchema);
