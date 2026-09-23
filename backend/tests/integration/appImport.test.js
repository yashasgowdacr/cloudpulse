// Ensure required test environment variables are initialized before importing modules
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_min_32_characters_long_12345';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_jwt_refresh_secret_min_32_characters_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('App Import Side-Effect Isolation Test', () => {
  let app;

  beforeAll(() => {
    app = require('../../src/app');
  });

  it('should export a valid Express application function', () => {
    expect(typeof app).toBe('function');
    expect(typeof app.listen).toBe('function');
    expect(typeof app.use).toBe('function');
  });

  it('should not be actively listening on an HTTP port upon import', () => {
    // An active HTTP server instance has listening === true or an address() object.
    // Express app itself is an EventEmitter / request listener, not an active net.Server.
    expect(app._listening).toBeFalsy();
    expect(app.address ? app.address() : null).toBeNull();
  });

  it('should allow Supertest to execute requests without starting a persistent server listener', async () => {
    const request = require('supertest');
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'UP',
      message: 'CloudPulse API is running'
    });
  });
});
