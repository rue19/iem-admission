// Phase 0 smoke test: the app boots and the health route answers.
// No database is connected here, so health should report "degraded" (503).
const request = require('supertest');
const app = require('../src/app');

describe('Phase 0 - scaffolding', () => {
  test('HEALTH-01 GET /api/health responds with JSON status and db state', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'degraded', db: 'disconnected' });
  });

  test('HEALTH-02 unknown route returns 404 JSON', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Route not found/);
  });

  test('HEALTH-03 malformed JSON body returns 400, not 500', async () => {
    const res = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{bad json');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Request body is not valid JSON');
  });
});
