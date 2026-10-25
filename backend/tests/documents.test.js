// Phase 3 integration tests: real multipart uploads through Express + multer,
// checked against MongoDB and the upload folder on disk.
const fs = require('fs');
const http = require('http');
const path = require('path');
const request = require('supertest');
const app = require('../src/app');
const env = require('../src/config/env');
const Course = require('../src/models/Course');
const Application = require('../src/models/Application');
const Document = require('../src/models/Document');
const { connectTestDB, clearTestDB, disconnectTestDB } = require('./helpers/db');
const { createUser } = require('./helpers/users');

// Small in-memory "files" with the right (or wrong) magic bytes.
const PDF_HEADER = Buffer.from('%PDF-1.7\n');
const pdf = (size = 1024) => Buffer.concat([PDF_HEADER, Buffer.alloc(Math.max(0, size - PDF_HEADER.length), 0x20)]);
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200)]);
const jpg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200)]);
const mp3 = () => Buffer.concat([Buffer.from('ID3'), Buffer.alloc(500)]);

const filesOnDisk = () => fs.readdirSync(env.uploadDir);

let applicant;

beforeAll(connectTestDB);
beforeEach(async () => {
  const course = await Course.create({ courseName: 'B.Tech CSE', eligibility: '10+2 PCM' });
  applicant = await createUser('applicant');
  await Application.create({ applicant: applicant.user._id, course: course._id, qualifyingPercent: 80 });
});
afterEach(async () => {
  await clearTestDB();
  for (const f of filesOnDisk()) fs.rmSync(path.join(env.uploadDir, f));
});
afterAll(async () => {
  fs.rmSync(env.uploadDir, { recursive: true, force: true });
  await disconnectTestDB();
});

function upload(who, buffer, filename, documentType = 'Identity Proof') {
  const req = request(app).post('/api/applications/me/documents').set(who.auth);
  if (documentType !== undefined) req.field('documentType', documentType);
  return buffer === undefined ? req : req.attach('file', buffer, filename);
}

describe('Accepted uploads', () => {
  test('DOC-01 valid PDF is accepted, saved to disk, and only a reference is stored', async () => {
    const res = await upload(applicant, pdf(), 'aadhaar.pdf');
    expect(res.status).toBe(201);
    expect(res.body.document).toMatchObject({
      documentType: 'Identity Proof',
      originalName: 'aadhaar.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      validationStatus: 'Valid',
    });
    // Server disk layout is not exposed to the browser.
    expect(res.body.document.filePath).toBeUndefined();

    const stored = await Document.findOne().lean();
    expect(stored.filePath).toMatch(/\.pdf$/);
    expect(Object.values(stored).some((v) => Buffer.isBuffer(v))).toBe(false);
    expect(filesOnDisk()).toEqual([stored.storedFileName]);
  });

  test.each([
    ['PNG', png(), 'photo.png', 'image/png'],
    ['JPG', jpg(), 'scan.JPG', 'image/jpeg'],
  ])('DOC-02 valid %s is accepted', async (_label, buffer, name, mime) => {
    const res = await upload(applicant, buffer, name);
    expect(res.status).toBe(201);
    expect(res.body.document.mimeType).toBe(mime);
  });

  test('DOC-03 exactly 5,242,880 bytes (the limit) is accepted', async () => {
    const res = await upload(applicant, pdf(5242880), 'max.pdf');
    expect(res.status).toBe(201);
    expect(res.body.document.sizeBytes).toBe(5242880);
  });

  test('DOC-04 user file name is never used on disk (path traversal)', async () => {
    const res = await upload(applicant, pdf(), '../../../etc/evil.pdf');
    expect(res.status).toBe(201);
    const stored = await Document.findOne();
    expect(stored.storedFileName).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    expect(path.dirname(path.resolve(env.backendRoot, stored.filePath))).toBe(env.uploadDir);
  });
});

describe('Rejected uploads leave nothing on disk', () => {
  test('DOC-05 MP3 is rejected with the type message', async () => {
    const res = await upload(applicant, mp3(), 'song.mp3');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid file type: only PDF, JPG and PNG are allowed');
    expect(res.body.document.validationStatus).toBe('Invalid');
    expect(filesOnDisk()).toEqual([]);
  });

  test('DOC-06 8.4 MB PDF is rejected as too large and removed from disk', async () => {
    const res = await upload(applicant, pdf(8808038), 'big.pdf');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^File too large — maximum allowed size is 5 MB/);
    expect(filesOnDisk()).toEqual([]);
  });

  test('DOC-07 5,242,881 bytes (1 byte over) is rejected', async () => {
    const res = await upload(applicant, pdf(5242881), 'just-over.pdf');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^File too large/);
    expect(filesOnDisk()).toEqual([]);
  });

  test('DOC-08 empty file is rejected as empty', async () => {
    const res = await upload(applicant, Buffer.alloc(0), 'empty.pdf');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('File is empty');
    expect(filesOnDisk()).toEqual([]);
  });

  test.each([
    ['text renamed to .pdf', Buffer.from('this is not a pdf'), 'fake.pdf'],
    ['PNG renamed to .jpg', png(), 'photo.jpg'],
  ])('DOC-09 %s is rejected as unreadable', async (_label, buffer, name) => {
    const res = await upload(applicant, buffer, name);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('File is corrupted or unreadable');
    expect(filesOnDisk()).toEqual([]);
  });

  test('DOC-10 type is reported before size and readability (precedence)', async () => {
    const res = await upload(applicant, Buffer.alloc(100), 'clip.mp3');
    expect(res.body.error).toBe('Invalid file type: only PDF, JPG and PNG are allowed');
  });

  test('DOC-11 invalid documentType is rejected and the file deleted', async () => {
    const res = await upload(applicant, pdf(), 'a.pdf', 'Passport Photo');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/documentType must be one of/);
    expect(filesOnDisk()).toEqual([]);
    expect(await Document.countDocuments()).toBe(0);
  });

  test('DOC-12 request without a file returns 400', async () => {
    const res = await upload(applicant, undefined);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No file uploaded/);
  });

  test('DOC-13 file sent in the wrong form field returns 400 and leaves nothing', async () => {
    const res = await request(app)
      .post('/api/applications/me/documents')
      .set(applicant.auth)
      .field('documentType', 'Identity Proof')
      .attach('upload', pdf(), 'a.pdf');
    expect(res.status).toBe(400);
    expect(filesOnDisk()).toEqual([]);
  });
});

describe('Replacing documents', () => {
  test('DOC-14 re-uploading a slot replaces the record and deletes the old file', async () => {
    await upload(applicant, pdf(), 'first.pdf');
    const [firstFile] = filesOnDisk();
    const res = await upload(applicant, png(), 'second.png');
    expect(res.status).toBe(201);
    expect(await Document.countDocuments()).toBe(1);
    expect(filesOnDisk()).toHaveLength(1);
    expect(filesOnDisk()).not.toContain(firstFile);
  });

  test('DOC-15 an invalid re-upload marks the slot Invalid and removes the old file', async () => {
    await upload(applicant, pdf(), 'good.pdf');
    const res = await upload(applicant, mp3(), 'oops.mp3');
    expect(res.status).toBe(400);
    const stored = await Document.findOne();
    expect(stored.validationStatus).toBe('Invalid');
    expect(stored.validationMessage).toBe('Invalid file type: only PDF, JPG and PNG are allowed');
    expect(filesOnDisk()).toEqual([]);
  });

  test('DOC-16 correcting an invalid upload makes the slot Valid again', async () => {
    await upload(applicant, mp3(), 'oops.mp3');
    const res = await upload(applicant, pdf(), 'fixed.pdf');
    expect(res.status).toBe(201);
    expect((await Document.findOne()).validationStatus).toBe('Valid');
  });
});

describe('Listing documents (GET /api/applications/me/documents)', () => {
  test('DOC-17 lists each slot with its validity and the required types', async () => {
    await upload(applicant, pdf(), 'id.pdf', 'Identity Proof');
    await upload(applicant, mp3(), 'marks.mp3', 'Academic Certificate');
    const res = await request(app).get('/api/applications/me/documents').set(applicant.auth);
    expect(res.status).toBe(200);
    expect(res.body.requiredTypes).toEqual(['Identity Proof', 'Academic Certificate']);
    const byType = Object.fromEntries(res.body.documents.map((d) => [d.documentType, d.validationStatus]));
    expect(byType).toEqual({ 'Identity Proof': 'Valid', 'Academic Certificate': 'Invalid' });
  });
});

describe('Who may upload', () => {
  test('DOC-18 uploading before starting an application returns 404 and stores nothing', async () => {
    const newcomer = await createUser('applicant');
    const res = await upload(newcomer, pdf(), 'id.pdf');
    expect(res.status).toBe(404);
    expect(filesOnDisk()).toEqual([]);
  });

  test('DOC-19 documents cannot change once the application is past Draft', async () => {
    await Application.updateOne({ applicant: applicant.user._id }, { status: 'Submitted' });
    const res = await upload(applicant, pdf(), 'late.pdf');
    expect(res.status).toBe(409);
    expect(filesOnDisk()).toEqual([]);
  });

  test('SEC-01 applicant B cannot see applicant A\'s documents', async () => {
    await upload(applicant, pdf(), 'id.pdf');
    const other = await createUser('applicant');
    const res = await request(app).get('/api/applications/me/documents').set(other.auth);
    expect(res.status).toBe(404);
  });

  test('SEC-08 unauthenticated upload is refused before anything is written', async () => {
    const res = await request(app)
      .post('/api/applications/me/documents')
      .field('documentType', 'Identity Proof')
      .attach('file', pdf(), 'id.pdf');
    expect(res.status).toBe(401);
    expect(filesOnDisk()).toEqual([]);
  });

  test('SEC-07 admin gets 403 on applicant document routes', async () => {
    const admin = await createUser('admin');
    const res = await upload(admin, pdf(), 'id.pdf');
    expect(res.status).toBe(403);
    expect(filesOnDisk()).toEqual([]);
  });
});

describe('Interrupted uploads', () => {
  test('DOC-20 an upload aborted midway leaves no file and no record', async () => {
    const server = app.listen(0);
    const { port } = server.address();
    const boundary = 'xBOUNDARYx';
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="documentType"\r\n\r\nIdentity Proof\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="id.pdf"\r\n` +
        'Content-Type: application/pdf\r\n\r\n'
    );

    let partialFilesSeen = 0;
    await new Promise((resolve) => {
      const req = http.request({
        port,
        method: 'POST',
        path: '/api/applications/me/documents',
        headers: {
          ...applicant.auth,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': head.length + 2 * 1024 * 1024, // promise 2 MB...
        },
      });
      req.on('error', () => {}); // the socket is destroyed on purpose
      req.write(head);
      req.write(pdf(256 * 1024)); // ...send only 256 KB, then drop the connection
      setTimeout(() => {
        partialFilesSeen = filesOnDisk().length; // proves a partial file really was being written
        req.destroy();
        resolve();
      }, 200);
    });

    // Give multer a moment to notice the abort and clean up.
    await new Promise((r) => setTimeout(r, 300));
    await new Promise((r) => server.close(r));

    expect(partialFilesSeen).toBe(1);
    expect(filesOnDisk()).toEqual([]);
    expect(await Document.countDocuments()).toBe(0);
  });
});
