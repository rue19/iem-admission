// `npm run seed`: creates the admin account and the course catalogue.
// Safe to run repeatedly: upserts update existing records instead of
// duplicating them.
const bcrypt = require('bcryptjs');
const env = require('../src/config/env');
const { connectDB, disconnectDB } = require('../src/config/db');
const User = require('../src/models/User');
const Course = require('../src/models/Course');
const { ROLES } = require('../src/config/constants');

const COURSES = [
  { courseName: 'B.Tech Computer Science and Engineering', eligibility: '10+2 with Physics, Mathematics and Chemistry/CS', minQualifyingPercent: 60 },
  { courseName: 'B.Tech Electronics and Communication Engineering', eligibility: '10+2 with Physics, Mathematics and Chemistry', minQualifyingPercent: 60 },
  { courseName: 'BBA', eligibility: '10+2 in any stream', minQualifyingPercent: 60 },
  { courseName: 'MCA', eligibility: 'Graduation with Mathematics at 10+2 or graduation level', minQualifyingPercent: 60 },
];

async function seed() {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword || adminPassword.length < 8) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (min 8 chars) in .env before seeding');
  }

  await connectDB(env.mongoUri);

  await User.updateOne(
    { email: adminEmail.toLowerCase() },
    {
      $set: {
        name: 'Admissions Administrator',
        role: ROLES.ADMIN,
        passwordHash: await bcrypt.hash(adminPassword, 10),
      },
    },
    { upsert: true }
  );
  console.log(`Admin ready: ${adminEmail}`);

  for (const course of COURSES) {
    await Course.updateOne({ courseName: course.courseName }, { $set: course }, { upsert: true });
  }
  console.log(`Courses ready: ${COURSES.length}`);
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(disconnectDB);
