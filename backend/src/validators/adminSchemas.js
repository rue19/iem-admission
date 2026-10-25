// Server-side rules for what an ADMIN may send.
const { z } = require('zod');
const mongoose = require('mongoose');
const { APPLICATION_STATUS } = require('../config/constants');

const STATUSES = Object.values(APPLICATION_STATUS);
const statusEnum = z.enum(STATUSES, { error: `Status must be one of: ${STATUSES.join(', ')}` });

// GET /api/admin/applications?status=&course=&q=
// Empty strings (e.g. "All statuses" in a dropdown) mean "no filter".
const emptyToUndefined = (v) => (v === '' ? undefined : v);
const listQuerySchema = z.object({
  status: z.preprocess(emptyToUndefined, statusEnum.optional()),
  course: z.preprocess(
    emptyToUndefined,
    z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid course id').optional()
  ),
  // Search by Application ID, applicant name or email.
  q: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
});

const statusBodySchema = z.object({ status: statusEnum }).strict();

const entranceScoreBodySchema = z
  .object({
    entranceScore: z
      .number({ error: 'Entrance score must be a number' })
      .min(0, 'Entrance score must be between 0 and 100')
      .max(100, 'Entrance score must be between 0 and 100'),
  })
  .strict();

module.exports = { listQuerySchema, statusBodySchema, entranceScoreBodySchema };
