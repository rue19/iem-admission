// Phase 7: security pass. Section 11 of the spec asks for tests proving that
// (a) applicant A can't read or modify applicant B's data, (b) applicants get
// 403 on every admin route, (c) a forged role is ignored, (d) illegal status
// changes are rejected and (e) the applicant can't set the status. Earlier
// suites cover each of those (SEC-01..11). This file adds the attacks a
// reviewer is likely to try by hand.
const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const Course = require('../src/models/Course');
const Application = require('../src/models/Application');
const User = require('../src/models/User');
const { connectTestDB, clearTestDB, disconnectTestDB } = require('./helpers/db');
const { createUser } = require('./helpers/users');

beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

describe('Injection and malformed input', () => {
  test('SEC-20 NoSQL operator injection in login is rejected (400), not evaluated', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Victim', email: 'victim@example.com', password: 'secret123' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(400);
    expect(res.body.token).toBeUndefined();
  });

  test.each(['/api/admin/applications', '/api/admin/dashboard'])(
    'SEC-21 operator injection or unknown query parameters on %s are rejected (400)',
    async (url) => {
      // Express 5's simple query parser never builds { $ne: ... } objects; the
      // strict schema also refuses the unknown key instead of ignoring it.
      const admin = await createUser('admin');
      for (const query of ['?status[$ne]=Draft', '?course[$gt]=', '?sort=-1']) {
        const res = await request(app).get(url + query).set(admin.auth);
        expect(res.status).toBe(400);
      }
    }
  );

  test('SEC-22 a JSON body over 100 KB is refused with 413', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a@example.com', password: 'x'.repeat(150 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.body.error).toBe('Request body is too large');
  });

  test('SEC-23 __proto__ in a body cannot add fields (prototype pollution)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .send('{"name":"Eve","email":"eve@example.com","password":"secret123","__proto__":{"role":"admin"}}');
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('applicant');
    expect({}.role).toBeUndefined();
  });
});

describe('Token attacks', () => {
  const someId = '507f1f77bcf86cd799439011';

  test('SEC-24 an unsigned token (alg "none") is rejected', async () => {
    const unsigned = jwt.sign({ id: someId, role: 'admin' }, null, { algorithm: 'none' });
    const res = await request(app).get('/api/admin/applications').set('Authorization', `Bearer ${unsigned}`);
    expect(res.status).toBe(401);
  });

  test('SEC-25 changing the role inside a real token breaks its signature', async () => {
    const applicant = await createUser('applicant');
    const [header, , signature] = applicant.token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ id: applicant.user._id, role: 'admin' })).toString('base64url');
    const res = await request(app)
      .get('/api/admin/applications')
      .set('Authorization', `Bearer ${header}.${forgedPayload}.${signature}`);
    expect(res.status).toBe(401);
  });

  test.each(['Token abc', 'Bearer', 'bearer x.y.z', 'Basic YWRtaW46YWRtaW4='])(
    'SEC-26 malformed Authorization header %p gets 401',
    async (value) => {
      const res = await request(app).get('/api/auth/me').set('Authorization', value);
      expect(res.status).toBe(401);
    }
  );

  test('SEC-27 a token for a deleted account is refused on /me', async () => {
    const applicant = await createUser('applicant');
    await User.deleteOne({ _id: applicant.user._id });
    const res = await request(app).get('/api/auth/me').set(applicant.auth);
    expect(res.status).toBe(401);
  });
});

describe('Information leaks', () => {
  test('SEC-28 passwordHash never appears in any admin response', async () => {
    const admin = await createUser('admin');
    const course = await Course.create({ courseName: 'BBA', eligibility: '10+2' });
    const applicant = await createUser('applicant');
    const application = await Application.create({
      applicant: applicant.user._id,
      course: course._id,
      qualifyingPercent: 70,
      status: 'Submitted',
    });
    const list = await request(app).get('/api/admin/applications').set(admin.auth);
    const detail = await request(app).get(`/api/admin/applications/${application._id}`).set(admin.auth);
    for (const res of [list, detail]) {
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
    }
  });

  test('SEC-29 responses do not advertise the framework', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  test('SEC-30 server errors never leak stack traces', async () => {
    // A request that reaches the error handler with an unexpected 500.
    const spy = jest.spyOn(Course, 'find').mockImplementation(() => {
      throw new Error('secret internal detail at /srv/app/db.js:42');
    });
    const silence = jest.spyOn(console, 'error').mockImplementation(() => {});
    const applicant = await createUser('applicant');
    const res = await request(app).get('/api/courses').set(applicant.auth);
    spy.mockRestore();
    silence.mockRestore();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });

  test('SEC-31 CORS allows only the configured Angular origin', async () => {
    const allowed = await request(app).get('/api/health').set('Origin', 'http://localhost:4200');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:4200');
    const other = await request(app).get('/api/health').set('Origin', 'https://evil.example.com');
    expect(other.headers['access-control-allow-origin']).not.toBe('https://evil.example.com');
  });
});
