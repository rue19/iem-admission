// Server-side rules for auth input. Angular checks the same things for a nicer
// UX, but only these checks count: anyone can call the API without the UI.
const { z } = require('zod');

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')),
  // bcrypt only uses the first 72 bytes, so longer passwords would be silently truncated.
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be at most 72 characters'),
  contactNumber: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{10,13}$/, 'Contact number must be 10-13 digits')
    .optional(),
});
// No `role` field: z.object drops unknown keys, so a forged role in the body
// never even reaches the controller.

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')),
  password: z.string().min(1, 'Password is required'),
});

module.exports = { registerSchema, loginSchema };
