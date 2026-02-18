/**
 * Settings Route
 * Handles server settings endpoints:
 *   GET  /settings/haiku-model
 *   POST /settings/haiku-model
 */

import { getServerSettings, setServerSettings } from '../server-settings.js';

const VALID_HAIKU_MODELS = ['glm-5', 'minimax-2.5'];

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

export default { handleGetHaikuModel, handleSetHaikuModel };
