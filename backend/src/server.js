const app = require('./app');
const { verifyGmailConfiguration } = require('./services/notificationService');
const { initScheduler } = require('./services/schedulerService');

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  initScheduler();
  verifyGmailConfiguration();
});

server.on('error', (err) => {
  console.error('[SERVER-FATAL]', err.message);
  process.exit(1);
});

module.exports = server;
