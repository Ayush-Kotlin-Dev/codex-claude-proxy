/**
 * Unit tests for route handlers (no server required).
 * Uses lightweight mock req/res objects to test handler logic in isolation.
 *
 * Covers:
 *  - settings-route.js  (GET/POST /settings/haiku-model)
 *  - claude-config-route.js (POST /claude/config/direct validation)
 *  - accounts-route.js  (POST /accounts/switch validation)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function mockRes() {
  const res = {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; }
  };
  return res;
}

function mockReq(body = {}, params = {}, query = {}) {
  return { body, params, query };
}

// ─── settings-route ───────────────────────────────────────────────────────────

import { handleGetHaikuModel, handleSetHaikuModel } from '../../src/routes/settings-route.js';

test('handleGetHaikuModel: returns current haikuKiloModel', () => {
  const req = mockReq();
  const res = mockRes();
  handleGetHaikuModel(req, res);
  assert.ok(res._body !== null);
  assert.ok('haikuKiloModel' in res._body);
  assert.ok(['kimi-k2.5', 'minimax-2.5'].includes(res._body.haikuKiloModel));
});

test('handleSetHaikuModel: rejects invalid model with 400', () => {
  const req = mockReq({ haikuKiloModel: 'invalid-model' });
  const res = mockRes();
  handleSetHaikuModel(req, res);
  assert.equal(res._status, 400);
  assert.equal(res._body.success, false);
  assert.ok(res._body.error.includes('Invalid haikuKiloModel'));
});

test('handleSetHaikuModel: rejects empty body with 400', () => {
  const req = mockReq({});
  const res = mockRes();
  handleSetHaikuModel(req, res);
  assert.equal(res._status, 400);
  assert.equal(res._body.success, false);
});

test('handleSetHaikuModel: accepts "kimi-k2.5" and returns updated setting', () => {
  const req = mockReq({ haikuKiloModel: 'kimi-k2.5' });
  const res = mockRes();
  handleSetHaikuModel(req, res);
  assert.equal(res._status, 200);
  assert.equal(res._body.success, true);
  assert.equal(res._body.haikuKiloModel, 'kimi-k2.5');
});

test('handleSetHaikuModel: accepts "minimax-2.5" and returns updated setting', () => {
  const req = mockReq({ haikuKiloModel: 'minimax-2.5' });
  const res = mockRes();
  handleSetHaikuModel(req, res);
  assert.equal(res._status, 200);
  assert.equal(res._body.success, true);
  assert.equal(res._body.haikuKiloModel, 'minimax-2.5');
});

test('handleSetHaikuModel: rejects null body gracefully', () => {
  const req = { body: null };
  const res = mockRes();
  handleSetHaikuModel(req, res);
  assert.equal(res._status, 400);
});

// ─── claude-config-route ──────────────────────────────────────────────────────

import { handleSetDirectMode } from '../../src/routes/claude-config-route.js';

test('handleSetDirectMode: rejects missing apiKey with 400', async () => {
  const req = mockReq({});
  const res = mockRes();
  await handleSetDirectMode(req, res);
  assert.equal(res._status, 400);
  assert.equal(res._body.success, false);
  assert.equal(res._body.error, 'API key required');
});

test('handleSetDirectMode: rejects null body with 400', async () => {
  const req = { body: null };
  const res = mockRes();
  await handleSetDirectMode(req, res);
  assert.equal(res._status, 400);
  assert.equal(res._body.error, 'API key required');
});

// ─── accounts-route ───────────────────────────────────────────────────────────

import { handleSwitchAccount } from '../../src/routes/accounts-route.js';

test('handleSwitchAccount: rejects missing email with 400', () => {
  const req = mockReq({});
  const res = mockRes();
  handleSwitchAccount(req, res);
  assert.equal(res._status, 400);
  assert.equal(res._body.success, false);
  assert.equal(res._body.message, 'Email is required');
});

test('handleSwitchAccount: rejects null body with 400', () => {
  const req = { body: null };
  const res = mockRes();
  handleSwitchAccount(req, res);
  assert.equal(res._status, 400);
  assert.equal(res._body.message, 'Email is required');
});

test('handleSwitchAccount: returns result for non-existent email (graceful)', () => {
  // The account doesn't exist, but the handler should still return a JSON response
  const req = mockReq({ email: 'nonexistent@example.com' });
  const res = mockRes();
  handleSwitchAccount(req, res);
  // Should return a response (success or failure) but not throw
  assert.ok(res._body !== null);
  assert.ok('success' in res._body);
});

import { handleAddAccountManual } from '../../src/routes/accounts-route.js';

test('handleAddAccountManual: rejects missing code with 400', async () => {
  const req = mockReq({});
  const res = mockRes();
  await handleAddAccountManual(req, res);
  assert.equal(res._status, 400);
  assert.equal(res._body.success, false);
  assert.equal(res._body.error, 'Code is required');
});
