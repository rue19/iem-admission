// Server-side rules for what an APPLICANT may send about their application.
const { z } = require('zod');
const mongoose = require('mongoose');

const objectId = z
  .string()
  .refine((v) => mongoose.isValidObjectId(v), 'Select a valid course');

const qualifyingPercent = z
  .number({ error: 'Qualifying percentage must be a number' })
  .min(0, 'Qualifying percentage must be between 0 and 100')
  .max(100, 'Qualifying percentage must be between 0 and 100');

// .strict() REJECTS unknown keys (400) instead of silently dropping them.
// So an applicant who sends `status`, `entranceScore`, `meritScore` or
// `applicant` gets a clear error: those fields are owned by the server/admin.
const createApplicationSchema = z
  .object({
    course: objectId,
    qualifyingPercent,
    sportsQuota: z.boolean().optional(),
  })
  .strict();

const updateApplicationSchema = z
  .object({
    course: objectId.optional(),
    qualifyingPercent: qualifyingPercent.optional(),
    sportsQuota: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update');

module.exports = { createApplicationSchema, updateApplicationSchema };
