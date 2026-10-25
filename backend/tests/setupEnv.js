// Runs before every test file (jest "setupFiles"). Values set here win over
// .env, because dotenv never overwrites variables that already exist.
require('dotenv').config({ quiet: true });
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = process.env.MONGO_URI_TEST || 'mongodb://127.0.0.1:27017/iem_admission_test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = '1h';
