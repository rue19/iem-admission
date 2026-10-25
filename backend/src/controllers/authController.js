const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const env = require('../config/env');
const { ROLES } = require('../config/constants');
const httpError = require('../utils/httpError');

// Cost factor 10 = 2^10 hashing rounds: slow enough to resist brute force,
// fast enough (~100 ms) for a login request.
const BCRYPT_ROUNDS = 10;

function signToken(user) {
  // Only id and role go in the token: it is readable by anyone who holds it
  // (signed, not encrypted), so no personal data.
  return jwt.sign({ id: user._id.toString(), role: user.role }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

// POST /api/auth/register
async function register(req, res) {
  const { name, email, password, contactNumber } = req.body;

  if (await User.exists({ email })) {
    throw httpError(409, 'An account with this email already exists');
  }

  const user = await User.create({
    name,
    email,
    contactNumber,
    passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
    // Hard-coded: public registration can only ever create applicants.
    // Admins are created by the seed script.
    role: ROLES.APPLICANT,
  });

  res.status(201).json({ token: signToken(user), user });
}

// POST /api/auth/login
async function login(req, res) {
  const { email, password } = req.body;

  // passwordHash has select:false on the model, so ask for it explicitly here.
  const user = await User.findOne({ email }).select('+passwordHash');
  const ok = user && (await bcrypt.compare(password, user.passwordHash));

  // Same message for "no such email" and "wrong password", so the API cannot
  // be used to discover which emails are registered.
  if (!ok) {
    throw httpError(401, 'Invalid email or password');
  }

  res.json({ token: signToken(user), user });
}

// GET /api/auth/me — who does this token belong to?
async function me(req, res) {
  const user = await User.findById(req.user.id);
  if (!user) {
    throw httpError(401, 'Account no longer exists');
  }
  res.json({ user });
}

module.exports = { register, login, me };
