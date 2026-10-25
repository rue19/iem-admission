// Phase 1: registration, login, JWT verification and role checks.
const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const User = require('../src/models/User');
const { verifyToken } = require('../src/middleware/auth');
const requireRole = require('../src/middleware/requireRole');
const { connectTestDB, clearTestDB, disconnectTestDB } = require('./helpers/db');

const applicant = {
  name: 'Asha Roy',
  email: 'asha@example.com',
  password: 'secret123',
  contactNumber: '9876543210',
};

beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

function register(body = applicant) {
  return request(app).post('/api/auth/register').send(body);
}

describe('Register (POST /api/auth/register)', () => {
  test('AUTH-01 valid registration returns 201, a token and an applicant user', async () => {
    const res = await register();
    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: applicant.email, role: 'applicant' });
  });

  test('AUTH-02 response never contains passwordHash', async () => {
    const res = await register();
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(applicant.password);
  });

  test('AUTH-03 password is stored as a bcrypt hash, not plain text', async () => {
    await register();
    const user = await User.findOne({ email: applicant.email }).select('+passwordHash');
    expect(user.passwordHash).not.toBe(applicant.password);
    expect(user.passwordHash).toMatch(/^\$2[aby]\$10\$/);
  });

  test('SEC-03 forged role "admin" in the body is ignored', async () => {
    const res = await register({ ...applicant, role: 'admin' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('applicant');
    const stored = await User.findOne({ email: applicant.email });
    expect(stored.role).toBe('applicant');
  });

  test('AUTH-04 duplicate email (any case) returns 409', async () => {
    await register();
    const res = await register({ ...applicant, email: 'ASHA@Example.com' });
    expect(res.status).toBe(409);
  });

  test.each([
    ['invalid email', { email: 'not-an-email' }, 'email'],
    ['short password', { password: 'short' }, 'password'],
    ['missing name', { name: undefined }, 'name'],
    ['bad contact number', { contactNumber: '12ab' }, 'contactNumber'],
  ])('AUTH-05 %s returns 400', async (_label, override, field) => {
    const res = await register({ ...applicant, ...override });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe(field);
  });
});

describe('Login (POST /api/auth/login)', () => {
  beforeEach(() => register());

  test('AUTH-06 correct credentials return a JWT containing id and role', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: applicant.email, password: applicant.password });
    expect(res.status).toBe(200);
    const payload = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(payload).toMatchObject({ id: res.body.user._id, role: 'applicant' });
  });

  test('AUTH-07 wrong password and unknown email give the same 401 message', async () => {
    const wrongPw = await request(app)
      .post('/api/auth/login')
      .send({ email: applicant.email, password: 'wrong-password' });
    const noUser = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever1' });
    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPw.body.error).toBe(noUser.body.error);
  });
});

describe('verifyToken (GET /api/auth/me)', () => {
  test('AUTH-08 valid token returns the current user', async () => {
    const { body } = await register();
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(applicant.email);
  });

  test('AUTH-09 missing token returns 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('AUTH-10 token signed with a different secret returns 401', async () => {
    const forged = jwt.sign({ id: '507f1f77bcf86cd799439011', role: 'admin' }, 'attacker-secret');
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  test('AUTH-11 expired token returns 401 with a session-expired message', async () => {
    const expired = jwt.sign({ id: '507f1f77bcf86cd799439011', role: 'applicant' }, process.env.JWT_SECRET, {
      expiresIn: -10,
    });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/expired/i);
  });
});

describe('requireRole', () => {
  // A tiny stand-in app: the real /api/admin routes arrive in Phase 5.
  const guarded = express();
  guarded.get('/admin-only', verifyToken, requireRole('admin'), (req, res) => res.json({ ok: true }));
  const tokenFor = (role) =>
    jwt.sign({ id: '507f1f77bcf86cd799439011', role }, process.env.JWT_SECRET);

  test('AUTH-12 applicant gets 403 on an admin-only route', async () => {
    const res = await request(guarded).get('/admin-only').set('Authorization', `Bearer ${tokenFor('applicant')}`);
    expect(res.status).toBe(403);
  });

  test('AUTH-13 admin passes an admin-only route', async () => {
    const res = await request(guarded).get('/admin-only').set('Authorization', `Bearer ${tokenFor('admin')}`);
    expect(res.status).toBe(200);
  });
});
