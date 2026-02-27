/**
 * Settings Route
 * Handles server settings endpoints:
 *   GET  /settings/haiku-model
 *   POST /settings/haiku-model
 *   GET  /settings/account-strategy
 *   POST /settings/account-strategy
 */

import { getServerSettings, setServerSettings } from '../server-settings.js';

const VALID_HAIKU_MODELS = ['kimi-k2.5', 'minimax-2.5'];
const VALID_STRATEGIES = ['sticky', 'round-robin'];

/**
 * GET /settings/haiku-model
 * Returns the current Haiku/Kilo model selection.
 */
export function handleGetHaikuModel(req, res) {
  const settings = getServerSettings();
  res.json({ success: true, haikuKiloModel: settings.haikuKiloModel });
}

/**
 * POST /settings/haiku-model
 * Updates the Haiku/Kilo model selection.
 */
export function handleSetHaikuModel(req, res) {
  const { haikuKiloModel } = req.body || {};

  if (!VALID_HAIKU_MODELS.includes(haikuKiloModel)) {
    return res.status(400).json({
      success: false,
      error: `Invalid haikuKiloModel. Use one of: ${VALID_HAIKU_MODELS.join(', ')}`
    });
  }

  const settings = setServerSettings({ haikuKiloModel });
  res.json({ success: true, haikuKiloModel: settings.haikuKiloModel });
}

/**
 * GET /settings/account-strategy
 * Returns the current account selection strategy.
 */
export function handleGetAccountStrategy(req, res) {
  const settings = getServerSettings();
  res.json({ success: true, accountStrategy: settings.accountStrategy });
}

/**
 * POST /settings/account-strategy
 * Updates the account selection strategy.
 */
export function handleSetAccountStrategy(req, res) {
  const { accountStrategy } = req.body || {};

  if (!VALID_STRATEGIES.includes(accountStrategy)) {
    return res.status(400).json({
      success: false,
      error: `Invalid accountStrategy. Use one of: ${VALID_STRATEGIES.join(', ')}`
    });
  }

  const settings = setServerSettings({ accountStrategy });
  res.json({ success: true, accountStrategy: settings.accountStrategy });
}

export default { 
  handleGetHaikuModel, 
  handleSetHaikuModel,
  handleGetAccountStrategy,
  handleSetAccountStrategy
};
