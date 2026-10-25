import { requiredDocumentsValid } from './document.service';
import { UploadedDocument } from './models';

const doc = (documentType: UploadedDocument['documentType'], validationStatus: 'Valid' | 'Invalid') =>
  ({ documentType, validationStatus }) as UploadedDocument;

describe('requiredDocumentsValid (mirrors the server gate for button state)', () => {
  it('is true when both required documents are Valid', () => {
    expect(requiredDocumentsValid([doc('Identity Proof', 'Valid'), doc('Academic Certificate', 'Valid')])).toBe(true);
  });

  it('is false when one is missing', () => {
    expect(requiredDocumentsValid([doc('Identity Proof', 'Valid')])).toBe(false);
  });

  it('is false when a required one is Invalid', () => {
    expect(requiredDocumentsValid([doc('Identity Proof', 'Valid'), doc('Academic Certificate', 'Invalid')])).toBe(false);
  });

  it('ignores the optional Other slot', () => {
    expect(
      requiredDocumentsValid([
        doc('Identity Proof', 'Valid'),
        doc('Academic Certificate', 'Valid'),
        doc('Other', 'Invalid'),
      ])
    ).toBe(true);
  });
});
