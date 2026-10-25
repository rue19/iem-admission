// Phase 5 integration tests: admin list/filter/search, review, status
// transitions, entrance scores, document download, and admin-only access.
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../src/app');
const env = require('../src/config/env');
const Course = require('../src/models/Course');
const Application = require('../src/models/Application');
const FeeRecord = require('../src/models/FeeRecord');
const User = require('../src/models/User');
const { connectTestDB, clearTestDB, disconnectTestDB } = require('./helpers/db');
const { createUser } = require('./helpers/users');

const pdf = () => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(500, 0x20)]);

let admin;
let cse;
let bba;

beforeAll(connectTestDB);
beforeEach(async () => {
  [cse, bba] = await Course.create([
    { courseName: 'B.Tech CSE', eligibility: '10+2 PCM' },
    { courseName: 'BBA', eligibility: '10+2 any stream' },
  ]);
  admin = await createUser('admin');
});
afterEach(async () => {
  await clearTestDB();
  for (const f of fs.readdirSync(env.uploadDir)) fs.rmSync(path.join(env.uploadDir, f));
});
afterAll(async () => {
  fs.rmSync(env.uploadDir, { recursive: true, force: true });
  await disconnectTestDB();
});

// An applicant with an application already in `status` (default Submitted).
async function applicantWith({ status = 'Submitted', course = cse, name } = {}) {
  const who = await createUser('applicant');
  if (name) await User.updateOne({ _id: who.user._id }, { name });
  const application = await Application.create({
    applicant: who.user._id,
    course: course._id,
    qualifyingPercent: 80,
    status,
  });
  return { ...who, application };
}

const list = (query = '') => request(app).get(`/api/admin/applications${query}`).set(admin.auth);
const detail = (id) => request(app).get(`/api/admin/applications/${id}`).set(admin.auth);
const setStatus = (id, status, who = admin) =>
  request(app).patch(`/api/admin/applications/${id}/status`).set(who.auth).send({ status });
const setScore = (id, body, who = admin) =>
  request(app).patch(`/api/admin/applications/${id}/entrance-score`).set(who.auth).send(body);
const statusOf = async (id) => (await Application.findById(id)).status;

describe('View applications (GET /api/admin/applications)', () => {
  test('ADM-01 lists every application with applicant and course populated', async () => {
    await applicantWith();
    await applicantWith({ status: 'Draft', course: bba });
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.body.applications).toHaveLength(2);
    const [first] = res.body.applications;
    expect(first.applicant).toEqual(expect.objectContaining({ name: expect.any(String), email: expect.any(String) }));
    expect(first.applicant.passwordHash).toBeUndefined();
    expect(first.course.courseName).toEqual(expect.any(String));
  });

  test('ADM-02 filters by status', async () => {
    await applicantWith({ status: 'Submitted' });
    await applicantWith({ status: 'Under Review' });
    const res = await list('?status=Under%20Review');
    expect(res.body.applications.map((a) => a.status)).toEqual(['Under Review']);
  });

  test('ADM-03 filters by course, and by course + status together', async () => {
    await applicantWith({ course: cse });
    await applicantWith({ course: bba });
    await applicantWith({ course: bba, status: 'Under Review' });
    expect((await list(`?course=${bba._id}`)).body.applications).toHaveLength(2);
    const both = await list(`?course=${bba._id}&status=Submitted`);
    expect(both.body.applications).toHaveLength(1);
  });

  test('ADM-04 empty filter values mean "all"', async () => {
    await applicantWith();
    expect((await list('?status=&course=&q=')).body.applications).toHaveLength(1);
  });

  test.each([
    ['unknown status', '?status=Selected', 'status'],
    ['malformed course id', '?course=abc', 'course'],
  ])('ADM-05 %s returns 400', async (_label, query, field) => {
    const res = await list(query);
    expect(res.status).toBe(400);
    expect(res.body.field).toBe(field);
  });

  test('ADM-06 searches by Application ID, by name (case-insensitive) and by email', async () => {
    const asha = await applicantWith({ name: 'Asha Roy' });
    await applicantWith({ name: 'Rahul Sen' });
    expect((await list(`?q=${asha.application._id}`)).body.applications).toHaveLength(1);
    expect((await list('?q=asha')).body.applications[0].applicant.name).toBe('Asha Roy');
    expect((await list(`?q=${asha.user.email}`)).body.applications).toHaveLength(1);
    expect((await list('?q=nobody')).body.applications).toHaveLength(0);
  });

  test('ADM-07 regex characters in the search are treated literally', async () => {
    await applicantWith({ name: 'Asha Roy' });
    expect((await list('?q=.*')).body.applications).toHaveLength(0);
  });
});

describe('View one application (GET /api/admin/applications/:id)', () => {
  test('ADM-08 returns application, documents, fee record and allowed next statuses', async () => {
    const a = await applicantWith({ status: 'Draft' });
    await request(app)
      .post('/api/applications/me/documents')
      .set(a.auth)
      .field('documentType', 'Identity Proof')
      .attach('file', pdf(), 'id.pdf');
    await Application.updateOne({ _id: a.application._id }, { status: 'Submitted' });
    await FeeRecord.create({ application: a.application._id, amount: 1000 });

    const res = await detail(a.application._id);
    expect(res.status).toBe(200);
    expect(res.body.application.applicant.name).toEqual(expect.any(String));
    expect(res.body.documents).toHaveLength(1);
    expect(res.body.documents[0].filePath).toBeUndefined();
    expect(res.body.feeRecord.feeStatus).toBe('Pending');
    expect(res.body.allowedNextStatuses).toEqual(['Under Review']);
  });

  test('ADM-09 unknown id returns 404, malformed id returns 400', async () => {
    expect((await detail('507f1f77bcf86cd799439011')).status).toBe(404);
    const bad = await detail('not-an-id');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('Invalid application id');
  });
});

describe('Status transitions (PATCH /api/admin/applications/:id/status)', () => {
  test('ADM-10 full path: Submitted → Under Review → Waitlisted → Approved', async () => {
    const { application } = await applicantWith();
    for (const [to, next] of [
      ['Under Review', ['Approved', 'Rejected', 'Waitlisted']],
      ['Waitlisted', ['Approved', 'Rejected']],
      ['Approved', []],
    ]) {
      const res = await setStatus(application._id, to);
      expect(res.status).toBe(200);
      expect(res.body.application.status).toBe(to);
      expect(res.body.allowedNextStatuses).toEqual(next);
    }
  });

  test('ADM-11 Under Review → Rejected', async () => {
    const { application } = await applicantWith({ status: 'Under Review' });
    expect((await setStatus(application._id, 'Rejected')).status).toBe(200);
  });

  test.each([
    ['Submitted', 'Approved'],
    ['Submitted', 'Submitted'],
    ['Under Review', 'Submitted'],
    ['Waitlisted', 'Under Review'],
    ['Approved', 'Rejected'],
    ['Rejected', 'Approved'],
    ['Approved', 'Draft'],
  ])('ADM-12 illegal %s → %s returns 409 and leaves the status unchanged', async (from, to) => {
    const { application } = await applicantWith({ status: from });
    const res = await setStatus(application._id, to);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Illegal status change/);
    expect(await statusOf(application._id)).toBe(from);
  });

  test('ADM-13 admin cannot submit a Draft on the applicant\'s behalf', async () => {
    const { application } = await applicantWith({ status: 'Draft' });
    const res = await setStatus(application._id, 'Submitted');
    expect(res.status).toBe(409);
    expect(await statusOf(application._id)).toBe('Draft');
  });

  test.each([
    ['an unknown status', { status: 'Selected' }],
    ['a missing status', {}],
    ['an extra field', { status: 'Under Review', entranceScore: 90 }],
  ])('ADM-14 %s returns 400', async (_label, body) => {
    const { application } = await applicantWith();
    const res = await request(app)
      .patch(`/api/admin/applications/${application._id}/status`)
      .set(admin.auth)
      .send(body);
    expect(res.status).toBe(400);
    expect(await statusOf(application._id)).toBe('Submitted');
  });

  test('ADM-15 two admins deciding at once: exactly one wins', async () => {
    const { application } = await applicantWith({ status: 'Under Review' });
    const admin2 = await createUser('admin');
    const [a, b] = await Promise.all([
      setStatus(application._id, 'Approved', admin),
      setStatus(application._id, 'Rejected', admin2),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  test('ADM-16 the applicant sees the new status on their own endpoint', async () => {
    const a = await applicantWith();
    await setStatus(a.application._id, 'Under Review');
    await setStatus(a.application._id, 'Approved');
    const res = await request(app).get('/api/applications/me').set(a.auth);
    expect(res.body.application.status).toBe('Approved');
  });
});

describe('Entrance score (PATCH /api/admin/applications/:id/entrance-score)', () => {
  test.each([0, 50, 72.5, 100])('ADM-20 records a score of %p', async (score) => {
    const { application } = await applicantWith({ status: 'Under Review' });
    const res = await setScore(application._id, { entranceScore: score });
    expect(res.status).toBe(200);
    expect(res.body.application.entranceScore).toBe(score);
  });

  test.each([
    ['above 100', { entranceScore: 100.5 }],
    ['below 0', { entranceScore: -1 }],
    ['a string', { entranceScore: '50' }],
    ['null', { entranceScore: null }],
    ['missing', {}],
    ['with an extra field', { entranceScore: 50, status: 'Approved' }],
  ])('ADM-21 a score %s returns 400', async (_label, body) => {
    const { application } = await applicantWith();
    const res = await setScore(application._id, body);
    expect(res.status).toBe(400);
    expect((await Application.findById(application._id)).entranceScore).toBeNull();
  });

  test.each(['Draft', 'Approved', 'Rejected'])('ADM-22 cannot record a score while %s (409)', async (status) => {
    const { application } = await applicantWith({ status });
    const res = await setScore(application._id, { entranceScore: 60 });
    expect(res.status).toBe(409);
  });

  test('ADM-23 unknown application returns 404', async () => {
    expect((await setScore('507f1f77bcf86cd799439011', { entranceScore: 60 })).status).toBe(404);
  });
});

describe('Document file (GET /api/admin/documents/:id/file)', () => {
  async function uploadedDoc(buffer, name) {
    const a = await applicantWith({ status: 'Draft' });
    const res = await request(app)
      .post('/api/applications/me/documents')
      .set(a.auth)
      .field('documentType', 'Identity Proof')
      .attach('file', buffer, name);
    return { a, doc: res.body.document };
  }

  test('ADM-30 admin can open a valid uploaded file', async () => {
    const { doc } = await uploadedDoc(pdf(), 'my id.pdf');
    const res = await request(app).get(`/api/admin/documents/${doc._id}/file`).set(admin.auth);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/pdf/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toBe("inline; filename*=UTF-8''my%20id.pdf");
    expect(res.body.subarray(0, 4).toString()).toBe('%PDF');
  });

  test('ADM-31 a rejected upload has no file to open (404)', async () => {
    const { doc } = await uploadedDoc(Buffer.from('ID3...'), 'song.mp3');
    const res = await request(app).get(`/api/admin/documents/${doc._id}/file`).set(admin.auth);
    expect(res.status).toBe(404);
  });

  test('ADM-32 applicants cannot use the admin download route, even for their own file', async () => {
    const { a, doc } = await uploadedDoc(pdf(), 'id.pdf');
    const res = await request(app).get(`/api/admin/documents/${doc._id}/file`).set(a.auth);
    expect(res.status).toBe(403);
  });
});

describe('Admin-only access', () => {
  const ID = '507f1f77bcf86cd799439011';
  const ROUTES = [
    ['get', '/api/admin/applications'],
    ['get', `/api/admin/applications/${ID}`],
    ['patch', `/api/admin/applications/${ID}/status`],
    ['patch', `/api/admin/applications/${ID}/entrance-score`],
    ['get', `/api/admin/documents/${ID}/file`],
    ['get', '/api/admin/anything-else'],
  ];

  test.each(ROUTES)('SEC-02 applicant gets 403 on %s %s', async (method, url) => {
    const applicant = await createUser('applicant');
    const res = await request(app)[method](url).set(applicant.auth).send({ status: 'Approved', entranceScore: 99 });
    expect(res.status).toBe(403);
  });

  test.each(ROUTES)('SEC-10 no token gets 401 on %s %s', async (method, url) => {
    const res = await request(app)[method](url);
    expect(res.status).toBe(401);
  });

  test('SEC-11 an applicant cannot approve their own application through any route', async () => {
    const a = await applicantWith({ status: 'Under Review' });
    await request(app).patch(`/api/admin/applications/${a.application._id}/status`).set(a.auth).send({ status: 'Approved' });
    await request(app).put('/api/applications/me').set(a.auth).send({ status: 'Approved' });
    expect(await statusOf(a.application._id)).toBe('Under Review');
  });
});
