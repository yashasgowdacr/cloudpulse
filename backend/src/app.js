const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
require('dotenv').config();
const authRouter = require('./routes/auth');
const azureConnectionsRouter = require('./routes/azureConnections');
const optimizationPoliciesRouter = require('./routes/optimizationPolicies');
const healthRouter = require('./routes/health');
const azureRouter = require('./routes/azure');
const costsRouter = require('./routes/costs');
const actionsRouter = require('./routes/actions');
const optimizationRouter = require('./routes/optimization');
const settingsRouter = require('./routes/settings');
const exportRouter = require('./routes/export');
const dashboardRouter = require('./routes/dashboard');
const budgetsRouter = require('./routes/budgets');
const anomaliesRouter = require('./routes/anomalies');
const adminRouter = require('./routes/admin');
const cloudRouter = require('./routes/cloud');
const { requestLoggerMiddleware } = require('./utils/logger');
const { getEncryptionKey } = require('./utils/crypto');
const { runMigrations } = require('./db/migrate');

// Validate critical production encryption key on application startup
try {
  getEncryptionKey();
} catch (configErr) {
  console.error('[FATAL-STARTUP-ERROR]', configErr.message);
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

// Auto-run database schema migrations idempotently on startup. Test imports must
// stay side-effect free; migrations are exercised explicitly in deployment jobs.
if (process.env.RUN_MIGRATIONS !== 'false') {
  runMigrations().catch((migErr) => {
    console.error('[STARTUP-MIGRATION-ERROR] Failed to run schema migrations:', migErr.message);
  });
}

const app = express();

// Do not trust client-provided forwarding headers unless the deployment's proxy
// range is explicitly configured. A numeric value here lets direct callers spoof
// their address and bypass IP based controls.
const trustedProxy = process.env.TRUST_PROXY && process.env.TRUST_PROXY.trim();
app.set('trust proxy', trustedProxy || false);

app.use(helmet());
app.use(cookieParser());
app.use(requestLoggerMiddleware);

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'TOO_MANY_REQUESTS',
    message: 'Too many authentication attempts. Please try again after 15 minutes.'
  }
});

const defaultOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://cloudpulse-ochre.vercel.app'
];
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : defaultOrigins;

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS policy: Not allowed by origin'));
    }
  },
  credentials: true
}));

app.use(express.json({ limit: '100kb' }));

app.use('/api/auth', authRateLimiter, authRouter);
app.use('/api/azure-connections', azureConnectionsRouter);
app.use('/api/optimization-policy', optimizationPoliciesRouter);

app.use('/health', healthRouter);
app.use('/azure', azureRouter);
app.use('/api/cost', costsRouter);
app.use('/api/actions', actionsRouter);
app.use('/api', optimizationRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/export', exportRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/budgets', budgetsRouter);
app.use('/api/anomalies', anomaliesRouter);
app.use('/api/admin', adminRouter);
app.use('/api/cloud', cloudRouter);



// Centralized Express Error Handler (Production Hardened)
app.use((err, req, res, next) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const sanitizedMsg = err.message ? err.message.replace(/clientSecret=[^&\s]+/gi, 'clientSecret=***') : 'Internal Server Error';
  console.error('[EXPRESS-ERROR]', sanitizedMsg);

  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'PAYLOAD_TOO_LARGE',
      message: 'Request payload size exceeds maximum limit of 100kb.'
    });
  }

  const status = err.status || err.statusCode || 500;
  return res.status(status).json({
    error: err.code || 'SERVER_ERROR',
    message: isProduction ? 'An unexpected server error occurred.' : sanitizedMsg
  });
});



module.exports = app;
