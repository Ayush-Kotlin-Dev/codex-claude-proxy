/**
 * Claude Config Route
 * Handles Claude CLI configuration endpoints:
 *   GET  /claude/config
 *   POST /claude/config/proxy
 *   POST /claude/config/direct
 */

import {
  readClaudeConfig,
  setProxyMode,
  setDirectMode,
  getClaudeConfigPath
} from '../claude-config.js';

/**
 * GET /claude/config
 * Returns the current Claude CLI configuration.
 */
export async function handleGetClaudeConfig(req, res) {
  try {
    const config = await readClaudeConfig();
    const configPath = getClaudeConfigPath();
    res.json({ success: true, configPath, config });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * POST /claude/config/proxy
 * Configures Claude CLI to use this proxy server.
 */
export async function handleSetProxyMode(req, res, { port }) {
  try {
    const proxyUrl = `http://localhost:${port}`;
    const models = {
      default: 'claude-sonnet-4-5',
      opus: 'claude-opus-4-5',
      sonnet: 'claude-sonnet-4-5',
      haiku: 'claude-haiku-4'
    };
    const config = await setProxyMode(proxyUrl, models);
    res.json({
      success: true,
      message: `Claude CLI configured to use proxy at ${proxyUrl}`,
      config
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * POST /claude/config/direct
 * Configures Claude CLI to use the Anthropic API directly.
 */
export async function handleSetDirectMode(req, res) {
  const { apiKey } = req.body || {};
  if (!apiKey) {
    return res.status(400).json({ success: false, error: 'API key required' });
  }
  try {
    const config = await setDirectMode(apiKey);
    res.json({
      success: true,
      message: 'Claude CLI configured to use direct Anthropic API',
      config
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export default { handleGetClaudeConfig, handleSetProxyMode, handleSetDirectMode };
