// Phase 7: the spec's Definition of Done as ONE test, through the public API
// only (no shortcuts into the database):
// register -> login -> create application -> upload valid docs -> submit ->
// pay -> admin reviews -> status changes -> applicant sees the new status.
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../src/app');
const env = require('../src/config/env');
const Course = require('../src/models/Course');
const User = require('../src/models/User');
const { connectTestDB, clearTestDB, disconnectTestDB } = require('./helpers/db');

const pdf = () => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048, 0x20)]);

beforeAll(connectTestDB);
afterEach(async () => {
  await clearTestDB();
  for (const f of fs.readdirSync(env.uploadDir)) fs.rmSync(path.join(env.uploadDir, f));
});
afterAll(async () => {
  fs.rmSync(env.uploadDir, { recursive: true, force: true });
  await disconnectTestDB();
});

test('E2E-01 full admission cycle through the API', async () => {
  // Setup that `npm run seed` normally does: one course and one admin.
  const course = await Course.create({ courseName: 'B.Tech CSE', eligibility: '10+2 PCM' });
  await request(app).post('/api/auth/register').send({ name: 'Admin', email: 'admin@example.com', password: 'adminpass1' });
  await User.updateOne({ email: 'admin@example.com' }, { role: 'admin' });

  // 1. Register and log in as an applicant.
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Asha Roy', email: 'asha@example.com', password: 'secret123', contactNumber: '9876543210' });
  expect(reg.status).toBe(201);
  const login = await request(app).post('/api/auth/login').send({ email: 'asha@example.com', password: 'secret123' });
  expect(login.status).toBe(200);
  const me = { Authorization: `Bearer ${login.body.token}` };

  // 2. Create the Draft.
  const created = await request(app)
    .post('/api/applications')
    .set(me)
    .send({ course: course._id.toString(), qualifyingPercent: 82.5, sportsQuota: true });
  expect(created.status).toBe(201);
  expect(created.body.application.status).toBe('Draft');

  // 3. Upload both required documents.
  for (const documentType of ['Identity Proof', 'Academic Certificate']) {
    const up = await request(app)
      .post('/api/applications/me/documents')
      .set(me)
      .field('documentType', documentType)
      .attach('file', pdf(), `${documentType}.pdf`);
    expect(up.status).toBe(201);
  }

  // 4. Submit: status Submitted, Pending fee, Application ID returned.
  const submitted = await request(app).post('/api/applications/me/submit').set(me);
  expect(submitted.status).toBe(200);
  const id = submitted.body.applicationId;
  expect(submitted.body.feeRecord.feeStatus).toBe('Pending');

  // 5. Pay the (mock) fee.
  const paid = await request(app).post('/api/fees/me/pay').set(me);
  expect(paid.body.feeRecord.feeStatus).toBe('Paid');

  // 6. Admin logs in, finds and reviews it.
  const adminLogin = await request(app).post('/api/auth/login').send({ email: 'admin@example.com', password: 'adminpass1' });
  const admin = { Authorization: `Bearer ${adminLogin.body.token}` };
  const found = await request(app).get('/api/admin/applications?q=asha').set(admin);
  expect(found.body.applications.map((a) => a._id)).toEqual([id]);

  const review = await request(app).get(`/api/admin/applications/${id}`).set(admin);
  expect(review.body.documents.every((d) => d.validationStatus === 'Valid')).toBe(true);
  expect(review.body.allowedNextStatuses).toEqual(['Under Review']);

  // 7. Status changes, score and decision.
  expect((await request(app).patch(`/api/admin/applications/${id}/status`).set(admin).send({ status: 'Approved' })).status).toBe(409);
  expect((await request(app).patch(`/api/admin/applications/${id}/status`).set(admin).send({ status: 'Under Review' })).status).toBe(200);
  const scored = await request(app).patch(`/api/admin/applications/${id}/entrance-score`).set(admin).send({ entranceScore: 78 });
  // 82.5*0.4 + 78*0.6 + 5 (sports) = 33 + 46.8 + 5 = 84.8
  expect(scored.body.application.meritScore).toBe(84.8);
  const verdict = await request(app).get(`/api/admin/applications/${id}`).set(admin);
  expect(verdict.body.eligibility).toEqual({ eligible: true, message: 'Eligible' });
  expect((await request(app).patch(`/api/admin/applications/${id}/status`).set(admin).send({ status: 'Approved' })).status).toBe(200);

  const counts = await request(app).get('/api/admin/dashboard').set(admin);
  expect(counts.body.byStatus).toEqual([{ _id: 'Approved', count: 1 }]);

  // 8. The applicant sees the decision.
  const track = await request(app).get('/api/applications/me').set(me);
  expect(track.body.application.status).toBe('Approved');
});
