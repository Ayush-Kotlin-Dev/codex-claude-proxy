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
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  registerApiRoutes(app, { port });

  return app;
}

export function startServer({ port }) {
  const app = createServer({ port });
  return app.listen(port);
}

export default { createServer, startServer };
