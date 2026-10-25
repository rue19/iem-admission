// Uploads through Vercel Blob (STORAGE_DRIVER=blob, the Vercel deployment).
// Token generation uses the real @vercel/blob SDK (it signs tokens locally, no
// network). Calls that would reach Blob storage (head, get, delete, signed
// links) are replaced by mocks, so each test controls what "storage" returns.
process.env.STORAGE_DRIVER = 'blob';
process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_teststore_secretvalue123';

jest.mock('../src/services/storage', () => {
  const actual = jest.requireActual('../src/services/storage');
  return {
    ...actual,
    headBlob: jest.fn(),
    readBlobHeader: jest.fn(),
    removeStoredFile: jest.fn(),
    signedDownloadUrl: jest.fn(),
  };
});

const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const storage = require('../src/services/storage');
const Course = require('../src/models/Course');
const Application = require('../src/models/Application');
const Document = require('../src/models/Document');
const { connectTestDB, clearTestDB, disconnectTestDB } = require('./helpers/db');
const { createUser } = require('./helpers/users');

const PDF_HEADER = Buffer.from('%PDF-1.7');

let applicant;
let application;

beforeAll(connectTestDB);
beforeEach(async () => {
  jest.clearAllMocks();
  const course = await Course.create({ courseName: 'B.Tech CSE', eligibility: '10+2 PCM' });
  applicant = await createUser('applicant');
  application = await Application.create({ applicant: applicant.user._id, course: course._id, qualifyingPercent: 80 });
});
afterEach(clearTestDB);
afterAll(disconnectTestDB);

const pathFor = (appId, ext = 'pdf') => `applications/${appId}/${crypto.randomUUID()}.${ext}`;

function requestToken(who, pathname, payload = { documentType: 'Identity Proof', originalName: 'id.pdf' }) {
  return request(app)
    .post('/api/applications/me/documents/blob-token')
    .set(who.auth)
    .send({
      type: 'blob.generate-client-token',
      payload: { pathname, clientPayload: JSON.stringify(payload), multipart: false },
    });
}

// clientToken = "vercel_blob_client_<store>_" + base64("<signature>.<base64 JSON payload>")
function decodeClientToken(clientToken) {
  const encoded = clientToken.replace(/^vercel_blob_client_[^_]+_/, '');
  const [, payload] = Buffer.from(encoded, 'base64').toString().split('.');
  return JSON.parse(Buffer.from(payload, 'base64').toString());
}

// Pretend a file of `size` bytes starting with `header` is in Blob storage.
function storedBlob(size, header = PDF_HEADER) {
  storage.headBlob.mockResolvedValue({ size, pathname: 'x' });
  storage.readBlobHeader.mockResolvedValue(header);
}

function confirm(who, pathname, extra = {}) {
  return request(app)
    .post('/api/applications/me/documents/blob')
    .set(who.auth)
    .send({ documentType: 'Identity Proof', pathname, originalName: 'aadhaar.pdf', ...extra });
}

describe('Configuration', () => {
  test('BLOB-01 /api/config tells the browser to use Blob uploads', async () => {
    const res = await request(app).get('/api/config');
    expect(res.body).toEqual({ uploadMode: 'blob', maxUploadBytes: 5242880 });
  });

  test('BLOB-02 the multipart disk route does not exist in blob mode', async () => {
    const res = await request(app).post('/api/applications/me/documents').set(applicant.auth);
    expect(res.status).toBe(404);
  });
});

describe('Upload token (POST /me/documents/blob-token)', () => {
  test('BLOB-03 a PDF in my own folder gets a token capped at exactly 5,242,880 bytes', async () => {
    const pathname = pathFor(application._id);
    const res = await requestToken(applicant, pathname);
    expect(res.status).toBe(200);
    const token = decodeClientToken(res.body.clientToken);
    expect(token).toMatchObject({ pathname, maximumSizeInBytes: 5242880, addRandomSuffix: false, allowOverwrite: false });
  });

  test('BLOB-04 a wrong type is refused before any bytes are sent, with the exact message recorded', async () => {
    const res = await requestToken(applicant, pathFor(application._id, 'mp3'), {
      documentType: 'Academic Certificate',
      originalName: 'song.mp3',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid file type: only PDF, JPG and PNG are allowed');
    const doc = await Document.findOne({ documentType: 'Academic Certificate' });
    expect(doc).toMatchObject({
      validationStatus: 'Invalid',
      validationMessage: 'Invalid file type: only PDF, JPG and PNG are allowed',
      originalName: 'song.mp3',
      sizeBytes: null,
    });
  });

  test.each([
    ['another application\'s folder', () => pathFor('507f1f77bcf86cd799439011')],
    ['a path traversal attempt', () => `applications/${application._id}/../../secret.pdf`],
    ['a user-chosen file name', () => `applications/${application._id}/my marksheet.pdf`],
  ])('BLOB-05 %s is refused', async (_label, makePath) => {
    const res = await requestToken(applicant, makePath());
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('This upload does not belong to your application');
  });

  test('BLOB-06 an invalid documentType is refused', async () => {
    const res = await requestToken(applicant, pathFor(application._id), { documentType: 'Passport', originalName: 'a.pdf' });
    expect(res.status).toBe(400);
  });

  test('BLOB-07 no token without an application (404) or after Draft (409)', async () => {
    const newcomer = await createUser('applicant');
    expect((await requestToken(newcomer, pathFor(application._id))).status).toBe(404);
    await Application.updateOne({ _id: application._id }, { status: 'Submitted' });
    expect((await requestToken(applicant, pathFor(application._id))).status).toBe(409);
  });

  test('BLOB-08 admins and anonymous users get no upload token', async () => {
    const admin = await createUser('admin');
    expect((await requestToken(admin, pathFor(application._id))).status).toBe(403);
    expect((await request(app).post('/api/applications/me/documents/blob-token').send({})).status).toBe(401);
  });
});

describe('Confirm upload (POST /me/documents/blob)', () => {
  test('BLOB-09 a valid PDF is recorded with a blob reference; size comes from storage', async () => {
    const pathname = pathFor(application._id);
    storedBlob(1024);
    const res = await confirm(applicant, pathname);
    expect(res.status).toBe(201);
    expect(res.body.document).toMatchObject({ validationStatus: 'Valid', sizeBytes: 1024, mimeType: 'application/pdf' });
    expect(res.body.document.filePath).toBeUndefined();
    expect((await Document.findOne()).filePath).toBe(`blob:${pathname}`);
    expect(storage.headBlob).toHaveBeenCalledWith(pathname);
    expect(storage.removeStoredFile).not.toHaveBeenCalled();
  });

  test('BLOB-10 exactly 5,242,880 bytes is accepted', async () => {
    storedBlob(5242880);
    expect((await confirm(applicant, pathFor(application._id))).status).toBe(201);
  });

  test.each([
    ['too large (5,242,881 bytes)', 5242881, PDF_HEADER, /^File too large — maximum allowed size is 5 MB/],
    ['empty', 0, Buffer.alloc(0), /^File is empty$/],
    ['unreadable (text renamed .pdf)', 500, Buffer.from('hello wo'), /^File is corrupted or unreadable$/],
  ])('BLOB-11 %s is rejected and the blob deleted', async (_label, size, header, message) => {
    const pathname = pathFor(application._id);
    storedBlob(size, header);
    const res = await confirm(applicant, pathname);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
    expect(storage.removeStoredFile).toHaveBeenCalledWith(`blob:${pathname}`);
    expect((await Document.findOne()).filePath).toBeNull();
  });

  test('BLOB-12 a blob that is not in storage is refused', async () => {
    storage.headBlob.mockResolvedValue(null);
    const res = await confirm(applicant, pathFor(application._id));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Upload not found/);
  });

  test('BLOB-13 confirming someone else\'s blob is refused and nothing is deleted', async () => {
    storedBlob(1024);
    const res = await confirm(applicant, pathFor('507f1f77bcf86cd799439011'));
    expect(res.status).toBe(400);
    expect(storage.removeStoredFile).not.toHaveBeenCalled();
  });

  test('BLOB-14 confirming after submission returns 409 and deletes the stray blob', async () => {
    await Application.updateOne({ _id: application._id }, { status: 'Submitted' });
    const pathname = pathFor(application._id);
    const res = await confirm(applicant, pathname);
    expect(res.status).toBe(409);
    expect(storage.removeStoredFile).toHaveBeenCalledWith(`blob:${pathname}`);
  });

  test('BLOB-15 replacing a slot deletes the previous blob; confirming the same blob twice does not', async () => {
    storedBlob(1024);
    const first = pathFor(application._id);
    await confirm(applicant, first);
    await confirm(applicant, first);
    expect(storage.removeStoredFile).not.toHaveBeenCalled();

    const second = pathFor(application._id, 'png');
    storedBlob(2048, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
    const res = await confirm(applicant, second, { originalName: 'scan.png' });
    expect(res.status).toBe(201);
    expect(storage.removeStoredFile).toHaveBeenCalledWith(`blob:${first}`);
    expect(await Document.countDocuments()).toBe(1);
  });

  test('BLOB-16 unknown fields in the confirm body are refused', async () => {
    const res = await confirm(applicant, pathFor(application._id), { sizeBytes: 10 });
    expect(res.status).toBe(400);
  });

  test('BLOB-17 Blob-stored documents count for submission', async () => {
    storedBlob(1024);
    await confirm(applicant, pathFor(application._id), { documentType: 'Identity Proof' });
    await confirm(applicant, pathFor(application._id), { documentType: 'Academic Certificate' });
    const res = await request(app).post('/api/applications/me/submit').set(applicant.auth);
    expect(res.status).toBe(200);
    expect(res.body.application.status).toBe('Submitted');
  });
});

describe('Admin access to Blob files', () => {
  async function validBlobDoc() {
    storedBlob(1024);
    const res = await confirm(applicant, pathFor(application._id));
    return res.body.document;
  }

  test('BLOB-18 /link returns a short-lived signed URL for admins', async () => {
    const doc = await validBlobDoc();
    storage.signedDownloadUrl.mockResolvedValue({ url: 'https://blob.example/signed', expiresAt: '2030-01-01T00:00:00.000Z' });
    const admin = await createUser('admin');
    const res = await request(app).get(`/api/admin/documents/${doc._id}/link`).set(admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://blob.example/signed');
    const { pathname } = /blob:(?<pathname>.+)/.exec((await Document.findById(doc._id)).filePath).groups;
    expect(storage.signedDownloadUrl).toHaveBeenCalledWith(pathname);
  });

  test('BLOB-19 /file (disk route) refuses Blob documents with 409', async () => {
    const doc = await validBlobDoc();
    const admin = await createUser('admin');
    expect((await request(app).get(`/api/admin/documents/${doc._id}/file`).set(admin.auth)).status).toBe(409);
  });

  test('BLOB-20 applicants cannot get signed links', async () => {
    const doc = await validBlobDoc();
    expect((await request(app).get(`/api/admin/documents/${doc._id}/link`).set(applicant.auth)).status).toBe(403);
  });
});
