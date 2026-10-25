// Creates a user straight in the database and returns a valid token for them,
// so tests can act as "applicant A", "applicant B" or "admin" without going
// through the register/login endpoints every time.
const jwt = require('jsonwebtoken');
const User = require('../../src/models/User');

let counter = 0;

async function createUser(role = 'applicant') {
  counter += 1;
  const user = await User.create({
    name: `Test ${role} ${counter}`,
    email: `${role}${counter}@example.com`,
    passwordHash: 'not-used-in-these-tests',
    role,
  });
  const token = jwt.sign({ id: user._id.toString(), role }, process.env.JWT_SECRET);
  return { user, token, auth: { Authorization: `Bearer ${token}` } };
}

module.exports = { createUser };
