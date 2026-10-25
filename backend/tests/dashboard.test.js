// Phase 6 integration tests: the aggregation dashboard, plus merit and
// eligibility as the admin sees them.
const request = require('supertest');
const app = require('../src/app');
const Course = require('../src/models/Course');
const Application = require('../src/models/Application');
const FeeRecord = require('../src/models/FeeRecord');
const { connectTestDB, clearTestDB, disconnectTestDB } = require('./helpers/db');
const { createUser } = require('./helpers/users');

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
afterEach(clearTestDB);
afterAll(disconnectTestDB);

async function makeApplication({ course = cse, status = 'Submitted', qualifyingPercent = 80, sportsQuota = false } = {}) {
  const who = await createUser('applicant');
  return Application.create({ applicant: who.user._id, course: course._id, status, qualifyingPercent, sportsQuota });
}

const dashboard = (query = '') => request(app).get(`/api/admin/dashboard${query}`).set(admin.auth);

describe('Dashboard (GET /api/admin/dashboard)', () => {
  beforeEach(async () => {
    // CSE: 2 Submitted, 1 Approved.  BBA: 1 Submitted, 1 Draft.
    await makeApplication({ course: cse });
    await makeApplication({ course: cse });
    await makeApplication({ course: cse, status: 'Approved' });
    await makeApplication({ course: bba });
    await makeApplication({ course: bba, status: 'Draft' });
  });

  test('DASH-01 counts by status (GROUP BY status)', async () => {
    const res = await dashboard();
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(5);
    expect(res.body.byStatus).toEqual([
      { _id: 'Submitted', count: 3 },
      { _id: 'Approved', count: 1 },
      { _id: 'Draft', count: 1 },
    ]);
  });

  test('DASH-02 counts by course, with names joined in ($lookup)', async () => {
    const res = await dashboard();
    expect(res.body.byCourse).toEqual([
      { _id: cse._id.toString(), courseName: 'B.Tech CSE', count: 3 },
      { _id: bba._id.toString(), courseName: 'BBA', count: 2 },
    ]);
  });

  test('DASH-03 counts by course and status together', async () => {
    const res = await dashboard();
    const rows = res.body.byCourseAndStatus.map((r) => `${r.courseName}/${r.status}=${r.count}`);
    expect(rows).toEqual(['B.Tech CSE/Approved=1', 'B.Tech CSE/Submitted=2', 'BBA/Draft=1', 'BBA/Submitted=1']);
  });

  test('DASH-04 optional status filter ($match)', async () => {
    const res = await dashboard('?status=Submitted');
    expect(res.body.total).toBe(3);
    expect(res.body.byCourse.map((c) => [c.courseName, c.count])).toEqual([
      ['B.Tech CSE', 2],
      ['BBA', 1],
    ]);
  });

  test('DASH-05 optional course filter ($match on an ObjectId)', async () => {
    const res = await dashboard(`?course=${bba._id}`);
    expect(res.body.total).toBe(2);
    expect(res.body.byStatus.map((s) => s._id).sort()).toEqual(['Draft', 'Submitted']);
  });

  test('DASH-06 a filter that matches nothing returns zeros, not an error', async () => {
    const res = await dashboard('?status=Waitlisted');
    expect(res.body).toEqual({ total: 0, byStatus: [], byCourse: [], byCourseAndStatus: [] });
  });

  test('DASH-07 a deleted course is labelled, not dropped', async () => {
    await Course.deleteOne({ _id: bba._id });
    const res = await dashboard();
    expect(res.body.byCourse.find((c) => c._id === bba._id.toString()).courseName).toBe('(deleted course)');
    expect(res.body.total).toBe(5);
  });

  test.each([
    ['?status=Selected', 'status'],
    ['?course=abc', 'course'],
  ])('DASH-08 invalid filter %s returns 400', async (query, field) => {
    const res = await dashboard(query);
    expect(res.status).toBe(400);
    expect(res.body.field).toBe(field);
  });

  test('SEC-02 applicant gets 403 on the dashboard', async () => {
    const applicant = await createUser('applicant');
    expect((await request(app).get('/api/admin/dashboard').set(applicant.auth)).status).toBe(403);
  });
});

describe('Merit score is stored when the entrance score is recorded', () => {
  const setScore = (id, entranceScore) =>
    request(app).patch(`/api/admin/applications/${id}/entrance-score`).set(admin.auth).send({ entranceScore });

  test.each([
    ['MERIT-INT-01 below cutoff', 70, 40, false, 0],
    ['MERIT-INT-02 weighted', 70, 70, false, 70],
    ['MERIT-INT-03 sports quota', 70, 70, true, 75],
    ['MERIT-INT-04 capped', 95, 100, true, 100],
  ])('%s: Q=%d E=%d sports=%p -> merit %d', async (_label, q, e, sports, merit) => {
    const application = await makeApplication({ qualifyingPercent: q, sportsQuota: sports, status: 'Under Review' });
    const res = await setScore(application._id, e);
    expect(res.status).toBe(200);
    expect(res.body.application.meritScore).toBe(merit);
    expect((await Application.findById(application._id)).meritScore).toBe(merit);
  });

  test('MERIT-INT-05 re-recording the score recalculates the merit', async () => {
    const application = await makeApplication({ qualifyingPercent: 70, status: 'Under Review' });
    await setScore(application._id, 70);
    const res = await setScore(application._id, 40);
    expect(res.body.application.meritScore).toBe(0);
  });

  test('MERIT-INT-06 a refused score (wrong status) does not touch the merit', async () => {
    const application = await makeApplication({ status: 'Approved' });
    expect((await setScore(application._id, 90)).status).toBe(409);
    expect((await Application.findById(application._id)).meritScore).toBeNull();
  });
});

describe('Eligibility in the admin detail view', () => {
  const detail = (id) => request(app).get(`/api/admin/applications/${id}`).set(admin.auth);

  test('ELIG-INT-01 no fee record yet: fee pending', async () => {
    const application = await makeApplication();
    const res = await detail(application._id);
    expect(res.body.eligibility).toEqual({ eligible: false, message: 'Application incomplete: fee payment pending' });
  });

  test('ELIG-INT-02 paid fee, no entrance score yet: incomplete', async () => {
    const application = await makeApplication();
    await FeeRecord.create({ application: application._id, amount: 1000, feeStatus: 'Paid' });
    const res = await detail(application._id);
    expect(res.body.eligibility.message).toBe('Application incomplete: entrance score not recorded');
  });

  test('ELIG-INT-03 paid, 80%, entrance 70: eligible', async () => {
    const application = await makeApplication({ qualifyingPercent: 80 });
    await Application.updateOne({ _id: application._id }, { entranceScore: 70 });
    await FeeRecord.create({ application: application._id, amount: 1000, feeStatus: 'Paid' });
    const res = await detail(application._id);
    expect(res.body.eligibility).toEqual({ eligible: true, message: 'Eligible' });
  });

  test('ELIG-INT-04 paid, 55%, entrance 70: qualifying below minimum', async () => {
    const application = await makeApplication({ qualifyingPercent: 55 });
    await Application.updateOne({ _id: application._id }, { entranceScore: 70 });
    await FeeRecord.create({ application: application._id, amount: 1000, feeStatus: 'Paid' });
    const res = await detail(application._id);
    expect(res.body.eligibility.message).toBe('Not eligible: qualifying percentage below minimum requirement.');
  });
});
