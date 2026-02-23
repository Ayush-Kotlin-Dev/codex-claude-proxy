/**
 * Models Route
 * Handles:
 *   GET /v1/models            — OpenAI-compatible model list
 *   GET /accounts/models      — Raw model list for the active/specified account
 *   GET /accounts/usage       — Usage stats for the active/specified account
 */

import { fetchModels, fetchUsage } from '../model-api.js';
import { getActiveAccount, loadAccounts } from '../account-manager.js';
import { logger } from '../utils/logger.js';
import { getCredentialsOrError } from '../middleware/credentials.js';

const FALLBACK_MODELS = [
  // OpenAI upstream models
  { id: 'gpt-5.3-codex', object: 'model', owned_by: 'openai' },
  { id: 'gpt-5.2-codex', object: 'model', owned_by: 'openai' },
  { id: 'gpt-5.1-codex', object: 'model', owned_by: 'openai' },
  { id: 'gpt-5.2', object: 'model', owned_by: 'openai' },
  // Current Claude 4.6 models
  { id: 'claude-opus-4-6', object: 'model', owned_by: 'anthropic' },
  { id: 'claude-sonnet-4-6', object: 'model', owned_by: 'anthropic' },
  { id: 'claude-haiku-4-5', object: 'model', owned_by: 'anthropic' },
  // 1M context variants
  { id: 'claude-opus-4-6-1m', object: 'model', owned_by: 'anthropic' },
  { id: 'claude-sonnet-4-6-1m', object: 'model', owned_by: 'anthropic' },
  // Legacy models (still supported)
  { id: 'claude-opus-4-5', object: 'model', owned_by: 'anthropic' },
  { id: 'claude-sonnet-4-5', object: 'model', owned_by: 'anthropic' }
];

/**
 * GET /v1/models
 * Returns an OpenAI-compatible model list. Falls back to a static list on error.
 */
export async function handleListModels(req, res) {
  const creds = await getCredentialsOrError();

  if (!creds) {
    return res.json({ object: 'list', data: FALLBACK_MODELS });
  }

  try {
    const models = await fetchModels(creds.accessToken, creds.accountId);
    const modelList = models.map(m => ({
      id: m.id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'openai',
      description: m.description
    }));
    res.json({ object: 'list', data: modelList });
  } catch (error) {
    logger.error(`Failed to fetch models: ${error.message}`);
    res.json({ object: 'list', data: FALLBACK_MODELS });
  }
}

/**
 * GET /accounts/models
 * Returns the raw model list for the active or specified account.
 */
export async function handleAccountModels(req, res) {
  const account = _resolveAccount(req.query.email);

  if (!account) {
    return res.status(404).json({
      success: false,
      error: req.query.email ? `Account not found: ${req.query.email}` : 'No active account'
    });
  }

  try {
    const models = await fetchModels(account.accessToken, account.accountId);
    res.json({ success: true, email: account.email, models });
  } catch (error) {
    logger.error(`Failed to fetch models: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * GET /accounts/usage
 * Returns usage stats for the active or specified account.
 */
export async function handleAccountUsage(req, res) {
  const account = _resolveAccount(req.query.email);

  if (!account) {
    return res.status(404).json({
      success: false,
      error: req.query.email ? `Account not found: ${req.query.email}` : 'No active account'
    });
  }

  try {
    const usage = await fetchUsage(account.accessToken, account.accountId);
    res.json({ success: true, email: account.email, usage });
  } catch (error) {
    logger.error(`Failed to fetch usage: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _resolveAccount(email) {
  if (email) {
    const data = loadAccounts();
    return data.accounts.find(a => a.email === email) || null;
  }
  return getActiveAccount();
}

export default { handleListModels, handleAccountModels, handleAccountUsage };
