/**
 * Server bootstrap
 * Creates the Express app, middleware, and registers API routes.
 */

import express from 'express';
import cors from 'cors';

import { ensureAccountsPersist, startAutoRefresh } from './account-manager.js';
import { registerApiRoutes } from './routes/api-routes.js';

export function createServer({ port }) {
  ensureAccountsPersist();
  startAutoRefresh();

  const app = express();
  app.disable('x-powered-by');
  
  // High-level request logging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      const msg = `[${req.method}] ${req.originalUrl} ${res.statusCode} (${duration}ms)`;
      if (res.statusCode >= 400) {
        console.log(`\x1b[31m${msg}\x1b[0m`); // Red for error
      } else if (req.originalUrl !== '/health') { // Skip health check logs to reduce noise
        console.log(`\x1b[36m${msg}\x1b[0m`); // Cyan for success
      }
    });
    next();
  });

  app.use(cors({
    origin: [
      `http://localhost:${port}`,
      `http://127.0.0.1:${port}`,
      'http://localhost',
      'http://127.0.0.1'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false
  }));
  app.use(express.json({ limit: '10mb' }));

  registerApiRoutes(app, { port });

  return app;
}

export function startServer({ port }) {
  const app = createServer({ port });
  return app.listen(port);
}

export default { createServer, startServer };
