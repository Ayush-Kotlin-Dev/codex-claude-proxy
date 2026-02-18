/**
 * Logs Route
 * Handles log retrieval and live streaming:
 *   GET /api/logs
 *   GET /api/logs/stream
 */

import { logger } from '../utils/logger.js';

/**
 * GET /api/logs
 * Returns the in-memory log history as JSON.
 */
export function handleGetLogs(req, res) {
  res.json({ status: 'ok', logs: logger.getHistory() });
}

/**
 * GET /api/logs/stream
 * Streams live log events as Server-Sent Events.
 * Pass ?history=true to replay existing log history before streaming live events.
 */
export function handleStreamLogs(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendLog = (log) => {
    res.write(`data: ${JSON.stringify(log)}\n\n`);
  };

  if (req.query.history === 'true') {
    logger.getHistory().forEach(sendLog);
  }

  logger.on('log', sendLog);

  req.on('close', () => {
    logger.off('log', sendLog);
  });
}

export default { handleGetLogs, handleStreamLogs };
