// Phase 3 unit tests for Rule DU (services/documentValidation.js).
// No database or HTTP: just values in, decisions out.
const {
  MAX_BYTES,
  MESSAGES,
  SIZE,
  checkFileSize,
  validateDocument,
  hasValidSignature,
  tooLargeMessage,
} = require('../src/services/documentValidation');

describe('checkFileSize — boundary values (raw bytes)', () => {
  test('DU-BV-00 MAX_BYTES is exactly 5 x 1,048,576 = 5,242,880', () => {
    expect(MAX_BYTES).toBe(5242880);
  });

  test.each([
    ['DU-BV-02', 0, SIZE.EMPTY],
    ['DU-BV-03', 1, SIZE.OK],
    ['DU-BV-04', 5242879, SIZE.OK],
    ['DU-BV-05', 5242880, SIZE.OK],
    ['DU-BV-06', 5242881, SIZE.TOO_LARGE],
    ['DU-BV-07', 8808038, SIZE.TOO_LARGE],
    ['DU-BV-08', 2147483648, SIZE.TOO_LARGE],
    ['DU-BV-09', 4294967296, SIZE.TOO_LARGE],
  ])('%s %d bytes -> %s', (_id, bytes, expected) => {
    expect(checkFileSize(bytes)).toBe(expected);
  });

  test.each([
    ['DU-BV-01', -1],
    ['DU-BV-10', NaN],
    ['DU-BV-11', Infinity],
    ['DU-BV-12', -Infinity],
    ['DU-BV-13', '5MB'],
    ['DU-BV-14', 1.5],
    ['DU-BV-15', undefined],
    ['DU-BV-16', null],
  ])('%s %p is an invalid size (400), never "Valid"', (_id, bytes) => {
    expect(() => checkFileSize(bytes)).toThrow(MESSAGES.INVALID_SIZE);
    try {
      checkFileSize(bytes);
    } catch (err) {
      expect(err.status).toBe(400);
    }
  });

  test('DU-BV-17 sizes in the billions are TOO_LARGE, not wrapped round to EMPTY', () => {
    // A 32-bit overflow bug would turn 4,294,967,296 into 0.
    expect(checkFileSize(4294967296)).not.toBe(SIZE.EMPTY);
  });
});

describe('validateDocument — paths', () => {
  const ok = { extension: 'pdf', sizeBytes: 1024, isReadable: true };

  test('DU-P-01 invalid type is rejected with the type message', () => {
    expect(validateDocument({ ...ok, extension: 'mp3' })).toEqual({
      valid: false,
      code: 'INVALID_TYPE',
      message: 'Invalid file type: only PDF, JPG and PNG are allowed',
    });
  });

  test('DU-P-02 valid type + oversized is rejected with the too-large message', () => {
    const result = validateDocument({ ...ok, sizeBytes: 8808038 });
    expect(result.valid).toBe(false);
    expect(result.code).toBe('TOO_LARGE');
    expect(result.message).toMatch(/^File too large — maximum allowed size is 5 MB/);
  });

  test('DU-P-03 valid type + readable size + unreadable content is rejected', () => {
    expect(validateDocument({ ...ok, isReadable: false })).toEqual({
      valid: false,
      code: 'UNREADABLE',
      message: 'File is corrupted or unreadable',
    });
  });

  test('DU-P-04 fully valid document is accepted', () => {
    expect(validateDocument(ok)).toMatchObject({ valid: true, code: 'VALID' });
  });

  test('DU-P-05 empty file of a valid type is rejected as empty', () => {
    expect(validateDocument({ ...ok, sizeBytes: 0 })).toMatchObject({ code: 'EMPTY', message: 'File is empty' });
  });

  test.each(['pdf', 'PDF', '.pdf', 'jpg', 'JPEG', 'png'])('DU-P-06 extension %p is an allowed type', (ext) => {
    expect(validateDocument({ ...ok, extension: ext }).valid).toBe(true);
  });

  test.each(['mp3', 'docx', 'exe', 'gif', '', undefined])('DU-P-07 extension %p is rejected', (ext) => {
    expect(validateDocument({ ...ok, extension: ext }).code).toBe('INVALID_TYPE');
  });
});

describe('validateDocument — precedence (type, then size, then readability)', () => {
  test('DU-PR-01 MP3 + 8 MB + unreadable reports "Invalid file type"', () => {
    const result = validateDocument({ extension: 'mp3', sizeBytes: 8 * 1048576, isReadable: false });
    expect(result.message).toBe(MESSAGES.INVALID_TYPE);
  });

  test('DU-PR-02 PDF + 8 MB + unreadable reports size before readability', () => {
    const result = validateDocument({ extension: 'pdf', sizeBytes: 8 * 1048576, isReadable: false });
    expect(result.code).toBe('TOO_LARGE');
  });

  test('DU-PR-03 PDF + empty + unreadable reports empty before readability', () => {
    const result = validateDocument({ extension: 'pdf', sizeBytes: 0, isReadable: false });
    expect(result.code).toBe('EMPTY');
  });

  test('DU-PR-04 invalid type wins even when the size is nonsense', () => {
    expect(validateDocument({ extension: 'mp3', sizeBytes: NaN, isReadable: true }).code).toBe('INVALID_TYPE');
  });

  test('DU-PR-05 valid type with a nonsense size throws Invalid file size', () => {
    expect(() => validateDocument({ extension: 'pdf', sizeBytes: -1, isReadable: true })).toThrow(
      MESSAGES.INVALID_SIZE
    );
  });
});

describe('too-large message shows the exact size', () => {
  test('DU-MSG-01 one byte over the limit is not shown as "5.00 MB"', () => {
    const message = tooLargeMessage(5242881);
    expect(message).toContain('5,242,881 bytes');
    expect(message).toContain('5.000001 MB');
    expect(message).not.toContain('5.00 MB');
  });

  test('DU-MSG-02 8,808,038 bytes is described precisely', () => {
    expect(tooLargeMessage(8808038)).toContain('8,808,038 bytes (8.4 MB)');
  });

  test('DU-MSG-03 unknown size (upload stopped at the limit) says "more than"', () => {
    expect(tooLargeMessage(undefined)).toContain('more than 5,242,880 bytes');
  });
});

describe('hasValidSignature — magic bytes', () => {
  const bytes = (...b) => Buffer.from(b);

  test.each([
    ['DU-R-01 PDF', bytes(0x25, 0x50, 0x44, 0x46, 0x2d), 'pdf', true],
    ['DU-R-02 JPG', bytes(0xff, 0xd8, 0xff, 0xe0), 'jpg', true],
    ['DU-R-03 JPEG', bytes(0xff, 0xd8, 0xff, 0xdb), 'jpeg', true],
    ['DU-R-04 PNG', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d), 'png', true],
    ['DU-R-05 text renamed to .pdf', Buffer.from('hello world'), 'pdf', false],
    ['DU-R-06 PNG renamed to .jpg', bytes(0x89, 0x50, 0x4e, 0x47), 'jpg', false],
    ['DU-R-07 truncated header', bytes(0x25, 0x50), 'pdf', false],
    ['DU-R-08 empty buffer', Buffer.alloc(0), 'png', false],
    ['DU-R-09 unknown extension', bytes(0x25, 0x50, 0x44, 0x46), 'mp3', false],
  ])('%s -> %p', (_label, header, ext, expected) => {
    expect(hasValidSignature(header, ext)).toBe(expected);
  });
});
