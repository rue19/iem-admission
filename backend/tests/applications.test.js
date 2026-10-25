// Phase 2: course list and Draft application create / read / update.
const request = require('supertest');
const app = require('../src/app');
const Course = require('../src/models/Course');
const Application = require('../src/models/Application');
const { connectTestDB, clearTestDB, disconnectTestDB } = require('./helpers/db');
const { createUser } = require('./helpers/users');

let course;
let otherCourse;
let applicantA;
let applicantB;

beforeAll(connectTestDB);
beforeEach(async () => {
  [course, otherCourse] = await Course.create([
    { courseName: 'B.Tech CSE', eligibility: '10+2 PCM' },
    { courseName: 'BBA', eligibility: '10+2 any stream' },
  ]);
  applicantA = await createUser('applicant');
  applicantB = await createUser('applicant');
});
afterEach(clearTestDB);
afterAll(disconnectTestDB);

const draft = () => ({ course: course._id.toString(), qualifyingPercent: 78.5, sportsQuota: false });

function createFor(who, body = draft()) {
  return request(app).post('/api/applications').set(who.auth).send(body);
}

describe('Courses (GET /api/courses)', () => {
  test('COURSE-01 requires login', async () => {
    const res = await request(app).get('/api/courses');
    expect(res.status).toBe(401);
  });

  test('COURSE-02 returns courses sorted by name for any logged-in user', async () => {
    const admin = await createUser('admin');
    for (const who of [applicantA, admin]) {
      const res = await request(app).get('/api/courses').set(who.auth);
      expect(res.status).toBe(200);
      expect(res.body.courses.map((c) => c.courseName)).toEqual(['B.Tech CSE', 'BBA']);
    }
  });
});

describe('Create application (POST /api/applications)', () => {
  test('APP-01 creates a Draft owned by the logged-in applicant', async () => {
    const res = await createFor(applicantA);
    expect(res.status).toBe(201);
    expect(res.body.application).toMatchObject({
      status: 'Draft',
      qualifyingPercent: 78.5,
      applicant: applicantA.user._id.toString(),
      entranceScore: null,
      meritScore: null,
    });
    expect(res.body.application.course.courseName).toBe('B.Tech CSE');
  });

  test('APP-02 a second application for the same applicant returns 409', async () => {
    await createFor(applicantA);
    const res = await createFor(applicantA);
    expect(res.status).toBe(409);
    expect(await Application.countDocuments({ applicant: applicantA.user._id })).toBe(1);
  });

  test.each([
    ['above 100', 100.01],
    ['below 0', -1],
    ['a string', '80'],
    ['missing', undefined],
  ])('APP-03 qualifyingPercent %s returns 400', async (_label, value) => {
    const res = await createFor(applicantA, { ...draft(), qualifyingPercent: value });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('qualifyingPercent');
  });

  test('APP-04 boundary qualifyingPercent 0 and 100 are accepted', async () => {
    expect((await createFor(applicantA, { ...draft(), qualifyingPercent: 0 })).status).toBe(201);
    expect((await createFor(applicantB, { ...draft(), qualifyingPercent: 100 })).status).toBe(201);
  });

  test('APP-05 a course id that does not exist returns 400', async () => {
    const res = await createFor(applicantA, { ...draft(), course: '507f1f77bcf86cd799439011' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Selected course does not exist');
  });

  test('APP-06 a malformed course id returns 400', async () => {
    const res = await createFor(applicantA, { ...draft(), course: 'not-an-id' });
    expect(res.status).toBe(400);
  });

  test.each([
    ['status', 'Approved'],
    ['entranceScore', 99],
    ['meritScore', 100],
  ])('SEC-05 applicant cannot set server-owned field "%s" on create', async (field, value) => {
    const res = await createFor(applicantA, { ...draft(), [field]: value });
    expect(res.status).toBe(400);
    expect(await Application.countDocuments()).toBe(0);
  });

  test('SEC-06 applicant cannot create an application on behalf of someone else', async () => {
    const res = await createFor(applicantA, { ...draft(), applicant: applicantB.user._id.toString() });
    expect(res.status).toBe(400);
    expect(await Application.countDocuments()).toBe(0);
  });
});

describe('Read my application (GET /api/applications/me)', () => {
  test('APP-07 returns 404 before an application is started', async () => {
    const res = await request(app).get('/api/applications/me').set(applicantA.auth);
    expect(res.status).toBe(404);
  });

  test('APP-08 returns my application with the course populated', async () => {
    await createFor(applicantA);
    const res = await request(app).get('/api/applications/me').set(applicantA.auth);
    expect(res.status).toBe(200);
    expect(res.body.application.course.courseName).toBe('B.Tech CSE');
  });

  test('SEC-01 applicant B never sees applicant A\'s application', async () => {
    await createFor(applicantA);
    const res = await request(app).get('/api/applications/me').set(applicantB.auth);
    expect(res.status).toBe(404);
  });
});

describe('Update my application (PUT /api/applications/me)', () => {
  function update(who, body) {
    return request(app).put('/api/applications/me').set(who.auth).send(body);
  }

  test('APP-09 Draft can be edited', async () => {
    await createFor(applicantA);
    const res = await update(applicantA, {
      course: otherCourse._id.toString(),
      qualifyingPercent: 82,
      sportsQuota: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.application).toMatchObject({ qualifyingPercent: 82, sportsQuota: true, status: 'Draft' });
    expect(res.body.application.course.courseName).toBe('BBA');
  });

  test('APP-10 empty update returns 400', async () => {
    await createFor(applicantA);
    const res = await update(applicantA, {});
    expect(res.status).toBe(400);
  });

  test('APP-11 update before creating returns 404', async () => {
    const res = await update(applicantA, { qualifyingPercent: 70 });
    expect(res.status).toBe(404);
  });

  test('APP-12 non-Draft application cannot be edited (409) and is unchanged', async () => {
    await createFor(applicantA);
    await Application.updateOne({ applicant: applicantA.user._id }, { status: 'Submitted' });
    const res = await update(applicantA, { qualifyingPercent: 99 });
    expect(res.status).toBe(409);
    const stored = await Application.findOne({ applicant: applicantA.user._id });
    expect(stored.qualifyingPercent).toBe(78.5);
  });

  test('SEC-05 status cannot be set through the applicant update endpoint', async () => {
    await createFor(applicantA);
    const res = await update(applicantA, { status: 'Approved' });
    expect(res.status).toBe(400);
    const stored = await Application.findOne({ applicant: applicantA.user._id });
    expect(stored.status).toBe('Draft');
  });

  test('SEC-01 applicant B\'s update never touches applicant A\'s application', async () => {
    await createFor(applicantA);
    const res = await update(applicantB, { qualifyingPercent: 10 });
    expect(res.status).toBe(404);
    const stored = await Application.findOne({ applicant: applicantA.user._id });
    expect(stored.qualifyingPercent).toBe(78.5);
  });
});

describe('Role check on applicant routes', () => {
  test('SEC-07 admin gets 403 on applicant-only routes', async () => {
    const admin = await createUser('admin');
    const res = await request(app).get('/api/applications/me').set(admin.auth);
    expect(res.status).toBe(403);
  });
});
