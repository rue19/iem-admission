// Server-side rules for the Blob upload confirmation (blob storage driver).
const { z } = require('zod');
const { DOCUMENT_TYPES } = require('../models/Document');

const blobConfirmSchema = z
  .object({
    documentType: z.enum(DOCUMENT_TYPES, { error: `documentType must be one of: ${DOCUMENT_TYPES.join(', ')}` }),
    // Shape and ownership are checked in the controller (parseBlobPathname).
    pathname: z.string().max(200),
    originalName: z.string().trim().min(1).max(255),
  })
  .strict();

module.exports = { blobConfirmSchema };
