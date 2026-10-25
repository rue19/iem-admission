// D4 documents: METADATA and a reference only. The file bytes live on disk in
// the upload folder; storing them in MongoDB would bloat every query and
// backup, and MongoDB documents are capped at 16 MB anyway.
const mongoose = require('mongoose');

const DOCUMENT_TYPES = ['Identity Proof', 'Academic Certificate', 'Other'];
const REQUIRED_DOCUMENT_TYPES = ['Identity Proof', 'Academic Certificate'];

const documentSchema = new mongoose.Schema(
  {
    application: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', required: true },
    documentType: { type: String, enum: DOCUMENT_TYPES, required: true },
    originalName: { type: String, required: true }, // shown to the user only, never used in a path
    // Random name we chose on disk. Both are null for an Invalid upload,
    // because the rejected file is deleted.
    storedFileName: { type: String, default: null },
    filePath: { type: String, default: null }, // relative to backend/, e.g. "uploads/<uuid>.pdf"
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true, min: 0 }, // bytes actually received, not client-declared
    validationStatus: { type: String, enum: ['Valid', 'Invalid'], required: true },
    // Why it was rejected, so the upload page can show the server's message.
    validationMessage: { type: String, default: null },
  },
  { timestamps: true }
);

// One current document per slot: re-uploading replaces the previous one.
documentSchema.index({ application: 1, documentType: 1 }, { unique: true });

// The browser never needs to know where files sit on the server's disk.
documentSchema.set('toJSON', {
  transform(doc, ret) {
    delete ret.storedFileName;
    delete ret.filePath;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Document', documentSchema);
module.exports.DOCUMENT_TYPES = DOCUMENT_TYPES;
module.exports.REQUIRED_DOCUMENT_TYPES = REQUIRED_DOCUMENT_TYPES;
