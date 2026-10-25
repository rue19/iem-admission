// D3 courses. Created in Phase 1 only because the seed script inserts them;
// the routes that use it arrive in Phase 2.
const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema(
  {
    courseName: { type: String, required: true, unique: true, trim: true },
    eligibility: { type: String, required: true, trim: true },
    minQualifyingPercent: { type: Number, default: 60, min: 0, max: 100 },
  },
  { timestamps: true }
);

courseSchema.set('toJSON', {
  transform(doc, ret) {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Course', courseSchema);
