// D1 users. The class diagram's Applicant and Administrator both inherit from
// User; here that becomes ONE collection with a `role` field, because both
// share the same fields and only differ in what they are allowed to do.
const mongoose = require('mongoose');
const { ROLES } = require('../config/constants');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // unique creates a MongoDB index, so the DATABASE rejects duplicates even
    // if two registrations race past the controller's check.
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // select: false -> never loaded unless a query explicitly asks for it.
    passwordHash: { type: String, required: true, select: false },
    contactNumber: { type: String, trim: true },
    role: {
      type: String,
      enum: Object.values(ROLES),
      default: ROLES.APPLICANT,
    },
  },
  { timestamps: true }
);

// Second safety net: even if a query did load passwordHash, it is stripped
// whenever the document is turned into JSON for a response.
userSchema.set('toJSON', {
  transform(doc, ret) {
    delete ret.passwordHash;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);
