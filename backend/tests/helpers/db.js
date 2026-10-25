// Connects tests to the throwaway test database and wipes it between tests,
// so every test starts from an empty, known state.
const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../../src/config/db');

async function connectTestDB() {
  const uri = process.env.MONGO_URI;
  // Guard against ever wiping the real development database by mistake.
  if (!/_test(\?|$)/.test(uri)) {
    throw new Error(`Refusing to run tests against non-test database: ${uri}`);
  }
  await connectDB(uri);
  // Build unique indexes now, otherwise duplicate checks may not apply yet.
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
}

async function clearTestDB() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

module.exports = { connectTestDB, clearTestDB, disconnectTestDB: disconnectDB };
