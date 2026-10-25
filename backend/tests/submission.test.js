// Phase 4 integration tests: submit gating, fee record creation and the mock
// payment, through real HTTP requests.
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../src/app');
const env = require('../src/config/env');
const Course = require('../src/models/Course');
const Application = require('../src/models/Application');
const FeeRecord = require('../src/models/FeeRecord');
const { connectTestDB, clearTestDB, disconnectTestDB } = require('./helpers/db');
const { createUser } = require('./helpers/users');

const pdf = () => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(500, 0x20)]);
const mp3 = () => Buffer.concat([Buffer.from('ID3'), Buffer.alloc(500)]);

let applicant;
let application;

beforeAll(connectTestDB);
beforeEach(async () => {
  const course = await Course.create({ courseName: 'B.Tech CSE', eligibility: '10+2 PCM' });
  applicant = await createUser('applicant');
  application = await Application.create({
    applicant: applicant.user._id,
    course: course._id,
    qualifyingPercent: 80,
  });
});
afterEach(async () => {
  await clearTestDB();
  for (const f of fs.readdirSync(env.uploadDir)) fs.rmSync(path.join(env.uploadDir, f));
});
afterAll(async () => {
  fs.rmSync(env.uploadDir, { recursive: true, force: true });
  await disconnectTestDB();
});

const upload = (who, documentType, buffer, name) =>
  request(app)
    .post('/api/applications/me/documents')
    .set(who.auth)
    .field('documentType', documentType)
    .attach('file', buffer, name);
const uploadBothValid = async (who = applicant) => {
  await upload(who, 'Identity Proof', pdf(), 'id.pdf');
  await upload(who, 'Academic Certificate', pdf(), 'marks.pdf');
};
const submit = (who = applicant, body) => request(app).post('/api/applications/me/submit').set(who.auth).send(body);
const pay = (who = applicant, body) => request(app).post('/api/fees/me/pay').set(who.auth).send(body);
const statusNow = async () => (await Application.findById(application._id)).status;

describe('Submission gating (POST /api/applications/me/submit)', () => {
  test('SUB-01 blocked with no documents: 400, reasons listed, status unchanged, no fee', async () => {
    const res = await submit();
    expect(res.status).toBe(400);
    expect(res.body.reasons).toEqual([
      'Identity Proof has not been uploaded',
      'Academic Certificate has not been uploaded',
    ]);
    expect(await statusNow()).toBe('Draft');
    expect(await FeeRecord.countDocuments()).toBe(0);
  });

  test('SUB-02 blocked while a required document is invalid', async () => {
    await upload(applicant, 'Identity Proof', pdf(), 'id.pdf');
    await upload(applicant, 'Academic Certificate', mp3(), 'marks.mp3');
    const res = await submit();
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      'Academic Certificate is invalid (Invalid file type: only PDF, JPG and PNG are allowed). Upload a corrected file'
    );
    expect(await statusNow()).toBe('Draft');
  });

  test('SUB-03 blocked when only one required document is uploaded', async () => {
    await upload(applicant, 'Identity Proof', pdf(), 'id.pdf');
    const res = await submit();
    expect(res.status).toBe(400);
    expect(res.body.reasons).toEqual(['Academic Certificate has not been uploaded']);
  });

  test('SUB-04 succeeds: status Submitted, Pending FeeRecord created, Application ID returned', async () => {
    await uploadBothValid();
    const res = await submit();
    expect(res.status).toBe(200);
    expect(res.body.applicationId).toBe(application._id.toString());
    expect(res.body.application.status).toBe('Submitted');
    expect(res.body.feeRecord).toMatchObject({ feeStatus: 'Pending', amount: 1000 });

    expect(await statusNow()).toBe('Submitted');
    const fee = await FeeRecord.findOne({ application: application._id });
    expect(fee.feeStatus).toBe('Pending');
  });

  test('SUB-05 re-uploading a corrected document enables submit', async () => {
    await upload(applicant, 'Identity Proof', pdf(), 'id.pdf');
    await upload(applicant, 'Academic Certificate', Buffer.from('not a pdf'), 'marks.pdf');
    expect((await submit()).status).toBe(400);

    await upload(applicant, 'Academic Certificate', pdf(), 'marks-fixed.pdf');
    const res = await submit();
    expect(res.status).toBe(200);
    expect(res.body.application.status).toBe('Submitted');
  });

  test('SUB-06 submitting twice fails the second time and creates only one fee', async () => {
    await uploadBothValid();
    await submit();
    const res = await submit();
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already been submitted/);
    expect(await FeeRecord.countDocuments()).toBe(1);
  });

  test('SUB-07 two simultaneous submits: exactly one wins', async () => {
    await uploadBothValid();
    const results = await Promise.all([submit(), submit(), submit()]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await FeeRecord.countDocuments()).toBe(1);
  });

  test('SUB-08 blocked if the selected course no longer exists', async () => {
    await uploadBothValid();
    await Course.deleteMany({});
    const res = await submit();
    expect(res.status).toBe(400);
    expect(res.body.reasons).toContain('Select a course before submitting');
    expect(await statusNow()).toBe('Draft');
  });

  test('SUB-09 blocked if the stored qualifying percentage is out of range', async () => {
    await uploadBothValid();
    // Bypass schema validators to simulate bad data that reached the database.
    await Application.collection.updateOne({ _id: application._id }, { $set: { qualifyingPercent: 150 } });
    const res = await submit();
    expect(res.status).toBe(400);
    expect(res.body.reasons).toEqual(['Qualifying percentage must be between 0 and 100']);
  });

  test('SUB-10 submit with no application returns 404', async () => {
    const newcomer = await createUser('applicant');
    const res = await submit(newcomer);
    expect(res.status).toBe(404);
  });

  test('SUB-11 a status in the request body is ignored', async () => {
    await uploadBothValid();
    const res = await submit(applicant, { status: 'Approved' });
    expect(res.body.application.status).toBe('Submitted');
  });

  test('SUB-12 after submitting, the application and its documents are frozen', async () => {
    await uploadBothValid();
    await submit();
    const edit = await request(app).put('/api/applications/me').set(applicant.auth).send({ qualifyingPercent: 99 });
    expect(edit.status).toBe(409);
    const reupload = await upload(applicant, 'Identity Proof', pdf(), 'new.pdf');
    expect(reupload.status).toBe(409);
  });
});

describe('Mock fee payment', () => {
  test('FEE-01 no fee is due before submitting', async () => {
    const res = await pay();
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Submit your application first/);
  });

  test('FEE-02 GET /api/fees/me shows the Pending fee after submit', async () => {
    await uploadBothValid();
    await submit();
    const res = await request(app).get('/api/fees/me').set(applicant.auth);
    expect(res.status).toBe(200);
    expect(res.body.feeRecord).toMatchObject({ feeStatus: 'Pending', amount: 1000, paidDate: null });
  });

  test('FEE-03 paying marks the fee Paid with a date and a mock reference', async () => {
    await uploadBothValid();
    await submit();
    const res = await pay();
    expect(res.status).toBe(200);
    expect(res.body.feeRecord.feeStatus).toBe('Paid');
    expect(res.body.feeRecord.paidDate).toEqual(expect.any(String));
    expect(res.body.feeRecord.transactionRef).toMatch(/^MOCK-[0-9A-F]{12}$/);
  });

  test('FEE-04 paying twice returns 409', async () => {
    await uploadBothValid();
    await submit();
    await pay();
    const res = await pay();
    expect(res.status).toBe(409);
  });

  test('FEE-05 an amount or status sent by the client is ignored', async () => {
    await uploadBothValid();
    await submit();
    const res = await pay(applicant, { amount: 1, feeStatus: 'Refunded' });
    expect(res.body.feeRecord).toMatchObject({ amount: 1000, feeStatus: 'Paid' });
  });

  test('FEE-06 paying does not change the application status', async () => {
    await uploadBothValid();
    await submit();
    await pay();
    expect(await statusNow()).toBe('Submitted');
  });
});

describe('Access rules', () => {
  test('SEC-01 applicant B cannot submit, view or pay applicant A\'s application', async () => {
    await uploadBothValid();
    await submit();
    const other = await createUser('applicant');
    expect((await submit(other)).status).toBe(404);
    expect((await request(app).get('/api/fees/me').set(other.auth)).status).toBe(404);
    expect((await pay(other)).status).toBe(404);
    const fee = await FeeRecord.findOne({ application: application._id });
    expect(fee.feeStatus).toBe('Pending');
  });

  test('SEC-07 admin gets 403 on submit and fee routes', async () => {
    const admin = await createUser('admin');
    expect((await submit(admin)).status).toBe(403);
    expect((await request(app).get('/api/fees/me').set(admin.auth)).status).toBe(403);
    expect((await pay(admin)).status).toBe(403);
  });

  test('SEC-09 submit and pay require a token', async () => {
    expect((await request(app).post('/api/applications/me/submit')).status).toBe(401);
    expect((await request(app).post('/api/fees/me/pay')).status).toBe(401);
  });
});
