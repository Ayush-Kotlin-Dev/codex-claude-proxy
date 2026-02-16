/**
 * API Routes
 * All HTTP route wiring and handlers.
 */

import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import {
  getActiveAccount,
  setActiveAccount,
  removeAccount,
  listAccounts,
  refreshActiveAccount,
  refreshAccountToken,
  refreshAllAccounts,
  importFromCodex,
  getStatus,
  loadAccounts,
  saveAccounts,
  updateAccountAuth,
  updateAccountQuota,
  getAccountQuota,
  isTokenExpiredOrExpiringSoon,
  ACCOUNTS_FILE
} from '../account-manager.js';

import {
  getAuthorizationUrl,
  generatePKCE,
  generateState,
  startCallbackServer,
  exchangeCodeForTokens,
  OAUTH_CONFIG,
  extractCodeFromInput,
  extractAccountInfo
} from '../oauth.js';

import { sendMessageStream, sendMessage } from '../direct-api.js';
import { sendKiloMessageStream, sendKiloMessage } from '../kilo-api.js';
import { formatSSEEvent } from '../response-streamer.js';

import {
  fetchModels,
  fetchUsage,
  getAccountQuota as fetchAccountQuota,
  getModelsAndQuota
} from '../model-api.js';

import {
  readClaudeConfig,
  setProxyMode,
  setDirectMode,
  getClaudeConfigPath
} from '../claude-config.js';

import { convertAnthropicToResponsesAPI } from '../format-converter.js';
import { logger } from '../utils/logger.js';
import { getServerSettings, setServerSettings } from '../server-settings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CLAUDE_MODEL_MAP = {
  'claude-opus-4-5': 'gpt-5.3-codex',
  'claude-opus-4-5-20250514': 'gpt-5.3-codex',
  'claude-sonnet-4-5': 'gpt-5.2',
  'claude-sonnet-4-5-20250514': 'gpt-5.2',
  'claude-sonnet-4-20250514': 'gpt-5.2',
  'claude-haiku-4-20250514': 'kilo',
  'claude-haiku-3-5-20250514': 'kilo',
  'claude-3-5-sonnet-20240620': 'gpt-5.2',
  'claude-3-opus-20240229': 'gpt-5.3-codex',
  'claude-3-sonnet-20240229': 'gpt-5.2',
  'claude-3-haiku-20240307': 'kilo',
  'sonnet': 'gpt-5.2',
  'opus': 'gpt-5.3-codex',
  'haiku': 'kilo',
  'gpt-5.3-codex': 'gpt-5.3-codex',
  'gpt-5.2-codex': 'gpt-5.2-codex',
  'gpt-5.1-codex-max': 'gpt-5.1-codex-max',
  'gpt-5.1-codex': 'gpt-5.1-codex',
  'gpt-5-codex': 'gpt-5-codex',
  'gpt-5.2': 'gpt-5.2',
  'gpt-5.1': 'gpt-5.1',
  'gpt-5': 'gpt-5',
  'gpt-5.1-codex-mini': 'gpt-5.1-codex-mini',
  'gpt-5-codex-mini': 'gpt-5-codex-mini'
};

function mapClaudeModel(model) {
  const modelLower = model.toLowerCase();

  if (CLAUDE_MODEL_MAP[model]) {
    return CLAUDE_MODEL_MAP[model];
  }

  if (modelLower.startsWith('claude-')) {
    const cleanModel = modelLower.replace(/^claude-/, '');
    if (cleanModel.includes('opus')) return 'gpt-5.3-codex';
    if (cleanModel.includes('sonnet')) return 'gpt-5.2';
    if (cleanModel.includes('haiku')) return 'kilo';
  }

  for (const [key, value] of Object.entries(CLAUDE_MODEL_MAP)) {
    if (modelLower.includes(key.toLowerCase())) {
      return value;
    }
  }

  return 'gpt-5.2';
}

function isKiloModel(mappedModel) {
  return mappedModel === 'kilo';
}

function resolveKiloModel() {
  const settings = getServerSettings();
  if (settings.haikuKiloModel === 'minimax-2.5') {
    return 'minimax/minimax-m2.5:free';
  }
  return 'z-ai/glm-5:free';
}

async function getCredentialsOrError() {
  const account = getActiveAccount();
  if (!account) {
    logger.info('No active account found');
    return null;
  }
  if (!account.accessToken || !account.accountId) {
    logger.info(`Account ${account.email} missing token or accountId`);
    return null;
  }

  if (isTokenExpiredOrExpiringSoon(account)) {
    logger.info(`Token expired/expiring soon for ${account.email}, refreshing...`);
    const result = await refreshAccountToken(account.email);
    if (!result.success) {
      logger.error(`Failed to refresh token: ${result.message}`);
      return null;
    }
    const refreshedAccount = getActiveAccount();
    if (!refreshedAccount) {
      logger.error('Failed to get refreshed account');
      return null;
    }
    logger.info(`Using refreshed token for ${refreshedAccount.email}`);
    return {
      accessToken: refreshedAccount.accessToken,
      accountId: refreshedAccount.accountId,
      email: refreshedAccount.email
    };
  }

  return {
    accessToken: account.accessToken,
    accountId: account.accountId,
    email: account.email
  };
}

async function handleMessages(req, res) {
  const startTime = Date.now();
  const body = req.body;
  const requestedModel = body.model || 'gpt-5.2';

  const mappedModel = mapClaudeModel(requestedModel);
  const isStreaming = body.stream !== false;

  const isKilo = isKiloModel(mappedModel);
  const kiloTarget = isKilo ? resolveKiloModel() : null;
  const upstreamModel = isKilo ? kiloTarget : mappedModel;
  const responseModelForMessages = requestedModel;

  let model = upstreamModel;

  if (!isKilo) {
    const creds = await getCredentialsOrError();
    if (!creds) {
      logger.response(401, { error: 'No active account' });
      return res.status(401).json({
        type: 'error',
        error: {
          type: 'authentication_error',
          message: 'No active account with valid credentials. Add an account via /accounts/add'
        }
      });
    }

    logger.request('POST', '/v1/messages', {
      model: upstreamModel,
      account: creds.email,
      stream: isStreaming,
      messages: body.messages?.length || 0,
      tools: body.tools?.length || 0
    });

    const anthropicRequest = {
      ...body,
      model: upstreamModel
    };

    if (!isStreaming) {
      try {
        const response = await sendMessage(anthropicRequest, creds.accessToken, creds.accountId);
        const duration = Date.now() - startTime;
        const tokens = response.usage?.output_tokens || 0;
        logger.response(200, { model: upstreamModel, tokens, duration });
        res.json({
          ...response,
          model: responseModelForMessages
        });
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.response(500, { model, error: error.message, duration });

        if (error.message.includes('AUTH_EXPIRED')) {
          return res.status(401).json({
            type: 'error',
            error: {
              type: 'authentication_error',
              message: 'Token expired. Please refresh or re-authenticate.'
            }
          });
        }

        if (error.message.includes('RATE_LIMITED')) {
          return res.status(429).json({
            type: 'error',
            error: {
              type: 'rate_limit_error',
              message: error.message
            }
          });
        }

        res.status(500).json({
          type: 'error',
          error: { type: 'api_error', message: error.message }
        });
      }
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      const eventStream = sendMessageStream(anthropicRequest, creds.accessToken, creds.accountId);

      for await (const event of eventStream) {
        res.write(formatSSEEvent(event));
      }

      res.write('data: [DONE]\n\n');
      res.end();

      const duration = Date.now() - startTime;
      logger.response(200, { model, duration });

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.response(500, { model, error: error.message, duration });

      if (!res.headersSent) {
        if (error.message.includes('AUTH_EXPIRED')) {
          return res.status(401).json({
            type: 'error',
            error: { type: 'authentication_error', message: 'Token expired' }
          });
        }
        res.status(500).json({
          type: 'error',
          error: { type: 'api_error', message: error.message }
        });
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'api_error', message: error.message } })}\n\n`);
        res.end();
      }
    }
    return;
  }

  logger.request('POST', '/v1/messages', {
    model: kiloTarget,
    account: 'kilo',
    stream: isStreaming,
    messages: body.messages?.length || 0,
    tools: body.tools?.length || 0
  });

  const anthropicRequest = {
    ...body,
    model: upstreamModel
  };

  if (!isStreaming) {
    try {
      const response = await sendKiloMessage(anthropicRequest, kiloTarget);
      const duration = Date.now() - startTime;
      const tokens = response.usage?.output_tokens || 0;
      logger.response(200, { model: kiloTarget, tokens, duration });
      res.json({
        id: response.id || anthropicRequest.id || undefined,
        type: 'message',
        role: 'assistant',
        content: response.content,
        model: responseModelForMessages,
        stop_reason: response.stopReason,
        stop_sequence: null,
        usage: response.usage
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.response(500, { model: kiloTarget, error: error.message, duration });

      res.status(500).json({
        type: 'error',
        error: { type: 'api_error', message: error.message }
      });
    }
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    const eventStream = sendKiloMessageStream(anthropicRequest, kiloTarget);

    for await (const event of eventStream) {
      res.write(formatSSEEvent(event));
    }

    res.write('data: [DONE]\n\n');
    res.end();

    const duration = Date.now() - startTime;
    logger.response(200, { model: kiloTarget, duration });

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.response(500, { model: kiloTarget, error: error.message, duration });

    if (!res.headersSent) {
      res.status(500).json({
        type: 'error',
        error: { type: 'api_error', message: error.message }
      });
    } else {
      res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'api_error', message: error.message } })}\n\n`);
      res.end();
    }
  }
}

async function handleChatCompletion(req, res) {
  const startTime = Date.now();
  const body = req.body;
  const requestedModel = body.model || 'gpt-5.2';

  const mappedModel = mapClaudeModel(requestedModel);

  const isKilo = isKiloModel(mappedModel);
  const kiloTarget = isKilo ? resolveKiloModel() : null;
  const upstreamModel = isKilo ? kiloTarget : mappedModel;
  let creds = null;

  const responseModel = requestedModel;

  if (!isKilo) {
    creds = await getCredentialsOrError();
    if (!creds) {
      logger.response(401, { error: 'No active account' });
      return res.status(401).json({
        type: 'error',
        error: {
          type: 'authentication_error',
          message: 'No active account. Add an account via /accounts/add'
        }
      });
    }
  }

  const anthropicRequest = {
    model: upstreamModel,
    messages: [],
    system: null,
    stream: false
  };

  if (body.messages) {
    const systemMsg = body.messages.find(m => m.role === 'system');
    if (systemMsg) {
      anthropicRequest.system = systemMsg.content;
    }
    anthropicRequest.messages = body.messages
      .filter(m => m.role !== 'system')
      .map(m => {
        if (m.role === 'tool') {
          return {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: m.tool_call_id,
              content: m.content
            }]
          };
        }

        if (m.role === 'assistant' && m.tool_calls) {
          const content = [{ type: 'text', text: m.content || '' }];
          for (const call of m.tool_calls) {
            content.push({
              type: 'tool_use',
              id: call.id,
              name: call.function.name,
              input: JSON.parse(call.function.arguments)
            });
          }
          return { role: 'assistant', content };
        }

        return m;
      });
  }

  if (body.tools) {
    anthropicRequest.tools = body.tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters
    }));
  }

  logger.request('POST', '/v1/chat/completions', {
    model: upstreamModel,
    account: isKilo ? 'kilo' : creds.email,
    messages: body.messages?.length || 0,
    tools: body.tools?.length || 0
  });

  try {
    const response = isKilo
      ? await sendKiloMessage(anthropicRequest, kiloTarget)
      : await sendMessage(anthropicRequest, creds.accessToken, creds.accountId);

    const content = response.content || [];
    const textContent = content.find(c => c.type === 'text');
    const toolUses = content.filter(c => c.type === 'tool_use');

    const message = {
      role: 'assistant',
      content: textContent?.text || ''
    };

    if (toolUses.length > 0) {
      message.tool_calls = toolUses.map(t => ({
        id: t.id,
        type: 'function',
        function: {
          name: t.name,
          arguments: JSON.stringify(t.input)
        }
      }));
    }

    const duration = Date.now() - startTime;
    const tokens = response.usage?.output_tokens || 0;
    logger.response(200, { model: upstreamModel, tokens, duration });

    res.json({
      id: response.id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: responseModel,
      choices: [{
        index: 0,
        message: message,
        finish_reason: toolUses.length > 0 ? 'tool_calls' : 'stop'
      }],
      usage: {
        prompt_tokens: response.usage?.input_tokens || 0,
        completion_tokens: response.usage?.output_tokens || 0,
        total_tokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
      }
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.response(500, { model: upstreamModel, error: error.message, duration });
    res.status(500).json({
      type: 'error',
      error: { type: 'api_error', message: error.message }
    });
  }

  return;
}

export function registerApiRoutes(app, { port }) {
  app.use(express.static(join(__dirname, '..', '..', 'public')));

  app.get('/health', (req, res) => {
    const status = getStatus();
    res.json({
      status: 'ok',
      ...status,
      configPath: ACCOUNTS_FILE
    });
  });

  app.post('/v1/chat/completions', handleChatCompletion);
  app.post('/v1/messages', handleMessages);

  app.post('/v1/messages/count_tokens', (req, res) => {
    const body = req.body;
    let text = '';

    if (body.system) {
      if (typeof body.system === 'string') {
        text += body.system + ' ';
      } else if (Array.isArray(body.system)) {
        for (const block of body.system) {
          if (block.type === 'text') {
            text += block.text + ' ';
          }
        }
      }
    }

    if (body.tools) {
      for (const tool of body.tools) {
        text += JSON.stringify(tool) + ' ';
      }
    }

    if (body.messages && body.messages.length > 0) {
      for (const msg of body.messages) {
        if (typeof msg.content === 'string') {
          text += msg.content + ' ';
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'text') {
              text += block.text + ' ';
            } else if (block.type === 'tool_use' || block.type === 'tool_result') {
              text += JSON.stringify(block) + ' ';
            }
          }
        }
      }
    }

    const approxTokens = Math.ceil(text.length / 4);
    res.json({ input_tokens: approxTokens });
  });

  // Settings
  app.get('/settings/haiku-model', (req, res) => {
    const settings = getServerSettings();
    res.json({
      success: true,
      haikuKiloModel: settings.haikuKiloModel
    });
  });

  app.post('/settings/haiku-model', (req, res) => {
    const { haikuKiloModel } = req.body || {};
    if (!['glm-5', 'minimax-2.5'].includes(haikuKiloModel)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid haikuKiloModel. Use glm-5 or minimax-2.5.'
      });
    }
    const settings = setServerSettings({ haikuKiloModel });
    res.json({ success: true, haikuKiloModel: settings.haikuKiloModel });
  });

  // Account Management API
  app.get('/accounts', (req, res) => {
    res.json(listAccounts());
  });

  app.get('/accounts/status', (req, res) => {
    res.json(getStatus());
  });

  const activeCallbackServers = new Map();

  app.post('/accounts/oauth/cleanup', (req, res) => {
    for (const [port, server] of activeCallbackServers) {
      try { server.close(); } catch (e) {}
    }
    activeCallbackServers.clear();
    res.json({ success: true, message: 'OAuth servers cleaned up' });
  });

  app.post('/accounts/add', async (req, res) => {
    const { port } = req.body || {};
    const callbackPort = port || OAUTH_CONFIG.callbackPort;

    const { verifier } = generatePKCE();
    const state = generateState();

    const oauthUrl = getAuthorizationUrl(verifier, state, callbackPort);

    let serverResult;
    try {
      for (const [p, s] of activeCallbackServers) {
        if (p === callbackPort) {
          try { s.close(); } catch (e) {}
          activeCallbackServers.delete(p);
        }
      }

      serverResult = startCallbackServer(callbackPort, state, 120000);
    } catch (err) {
      return res.status(500).json({
        error: 'Failed to start OAuth callback server',
        message: err.message,
        status: 'error'
      });
    }

    activeCallbackServers.set(callbackPort, serverResult.server);

    serverResult.promise.then((result) => {
      activeCallbackServers.delete(callbackPort);

      if (result && result.code) {
        exchangeCodeForTokens(result.code, verifier)
          .then(tokens => {
            const accountInfo = extractAccountInfo(tokens);

            const currentData = loadAccounts();

            const existingIndex = currentData.accounts.findIndex(a => a.email === accountInfo.email);
            if (existingIndex >= 0) {
              currentData.accounts[existingIndex] = {
                ...currentData.accounts[existingIndex],
                ...accountInfo
              };
            } else {
              currentData.accounts.push(accountInfo);
            }

            currentData.activeAccount = accountInfo.email;

            saveAccounts(currentData);
            updateAccountAuth(accountInfo);

            logger.info(`Added account: ${accountInfo.email}`);
          })
          .catch(err => {
            logger.error(`OAuth token exchange failed: ${err.message}`);
          });
      }
    }).catch(() => {
      activeCallbackServers.delete(callbackPort);
    });

    res.json({
      status: 'oauth_url',
      oauth_url: oauthUrl,
      state,
      callback_port: callbackPort
    });
  });

  app.post('/accounts/switch', (req, res) => {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }
    const result = setActiveAccount(email);
    if (result.success) {
      logger.info(`Switched to account: ${email}`);
    }
    res.json(result);
  });

  app.post('/accounts/:email/refresh', async (req, res) => {
    const email = decodeURIComponent(req.params.email);
    const result = await refreshAccountToken(email);
    if (result.success) {
      logger.info(`Refreshed token for: ${email}`);
    }
    res.json(result);
  });

  app.post('/accounts/refresh/all', async (req, res) => {
    const result = await refreshAllAccounts();
    res.json(result);
  });

  app.delete('/accounts/:email', (req, res) => {
    const email = decodeURIComponent(req.params.email);
    const result = removeAccount(email);
    if (result.success) {
      logger.info(`Removed account: ${email}`);
    }
    res.json(result);
  });

  app.post('/accounts/import', (req, res) => {
    const result = importFromCodex();
    res.json(result);
  });

  app.post('/accounts/refresh', async (req, res) => {
    const result = await refreshActiveAccount();
    res.json(result);
  });

  app.post('/accounts/add/manual', async (req, res) => {
    const { code, verifier } = req.body || {};
    if (!code) {
      return res.status(400).json({ success: false, error: 'Code is required' });
    }

    try {
      const extractedCode = extractCodeFromInput(code);
      const tokens = await exchangeCodeForTokens(extractedCode, verifier);
      const accountInfo = extractAccountInfo(tokens);

      const currentData = loadAccounts();
      const existingIndex = currentData.accounts.findIndex(a => a.email === accountInfo.email);

      if (existingIndex >= 0) {
        currentData.accounts[existingIndex] = {
          ...currentData.accounts[existingIndex],
          ...accountInfo
        };
      } else {
        currentData.accounts.push(accountInfo);
      }

      currentData.activeAccount = accountInfo.email;
      saveAccounts(currentData);
      updateAccountAuth(accountInfo);

      logger.info(`Added account via manual OAuth: ${accountInfo.email}`);
      res.json({ success: true, message: `Account ${accountInfo.email} added successfully` });
    } catch (err) {
      logger.error(`Manual OAuth failed: ${err.message}`);
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.get('/accounts/quota/all', async (req, res) => {
    const accounts = listAccounts();
    const results = { accounts: [] };

    for (const account of accounts.accounts || []) {
      try {
        const quota = await getAccountQuota(account.email);
        results.accounts.push({
          email: account.email,
          quota: quota || null
        });
      } catch (err) {
        results.accounts.push({
          email: account.email,
          quota: null
        });
      }
    }

    res.json(results);
  });

  app.get('/accounts/quota', async (req, res) => {
    const { email, refresh } = req.query;
    const data = loadAccounts();

    let account;
    if (email) {
      account = data.accounts.find(a => a.email === email);
    } else {
      account = getActiveAccount();
    }

    if (!account) {
      return res.status(404).json({
        success: false,
        error: email ? `Account not found: ${email}` : 'No active account'
      });
    }

    const cachedQuota = getAccountQuota(account.email);
    const isStale = !cachedQuota ||
      (Date.now() - new Date(cachedQuota.lastChecked).getTime() > 5 * 60 * 1000);

    if (refresh === 'true' || isStale) {
      try {
        const quotaData = await fetchAccountQuota(account.accessToken, account.accountId);
        updateAccountQuota(account.email, quotaData);

        res.json({
          success: true,
          email: account.email,
          quota: quotaData,
          cached: false
        });
      } catch (error) {
        logger.error(`Failed to fetch quota: ${error.message}`);

        if (cachedQuota) {
          res.json({
            success: true,
            email: account.email,
            quota: cachedQuota,
            cached: true,
            warning: 'Using cached data due to fetch error'
          });
        } else {
          res.status(500).json({
            success: false,
            error: error.message
          });
        }
      }
    } else {
      res.json({
        success: true,
        email: account.email,
        quota: cachedQuota,
        cached: true
      });
    }
  });

  app.get('/accounts/models', async (req, res) => {
    const { email } = req.query;
    const data = loadAccounts();

    let account;
    if (email) {
      account = data.accounts.find(a => a.email === email);
    } else {
      account = getActiveAccount();
    }

    if (!account) {
      return res.status(404).json({
        success: false,
        error: email ? `Account not found: ${email}` : 'No active account'
      });
    }

    try {
      const models = await fetchModels(account.accessToken, account.accountId);
      res.json({
        success: true,
        email: account.email,
        models
      });
    } catch (error) {
      logger.error(`Failed to fetch models: ${error.message}`);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  app.get('/accounts/usage', async (req, res) => {
    const { email } = req.query;
    const data = loadAccounts();

    let account;
    if (email) {
      account = data.accounts.find(a => a.email === email);
    } else {
      account = getActiveAccount();
    }

    if (!account) {
      return res.status(404).json({
        success: false,
        error: email ? `Account not found: ${email}` : 'No active account'
      });
    }

    try {
      const usage = await fetchUsage(account.accessToken, account.accountId);
      res.json({
        success: true,
        email: account.email,
        usage
      });
    } catch (error) {
      logger.error(`Failed to fetch usage: ${error.message}`);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  app.get('/v1/models', async (req, res) => {
    const creds = await getCredentialsOrError();
    if (!creds) {
      return res.json({
        object: 'list',
        data: [
          { id: 'gpt-5.3-codex', object: 'model', owned_by: 'openai' },
          { id: 'gpt-5.2-codex', object: 'model', owned_by: 'openai' },
          { id: 'gpt-5.1-codex', object: 'model', owned_by: 'openai' },
          { id: 'gpt-5.2', object: 'model', owned_by: 'openai' },
          { id: 'claude-opus-4-5-20250514', object: 'model', owned_by: 'anthropic' },
          { id: 'claude-sonnet-4-5-20250514', object: 'model', owned_by: 'anthropic' },
          { id: 'claude-haiku-4-20250514', object: 'model', owned_by: 'anthropic' }
        ]
      });
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
      res.json({
        object: 'list',
        data: [
          { id: 'gpt-5.3-codex', object: 'model', owned_by: 'openai' },
          { id: 'gpt-5.2-codex', object: 'model', owned_by: 'openai' },
          { id: 'gpt-5.1-codex', object: 'model', owned_by: 'openai' },
          { id: 'gpt-5.2', object: 'model', owned_by: 'openai' }
        ]
      });
    }
  });

  // Claude CLI Configuration

  app.get('/claude/config', async (req, res) => {
    try {
      const config = await readClaudeConfig();
      const configPath = getClaudeConfigPath();
      res.json({
        success: true,
        configPath,
        config
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/claude/config/proxy', async (req, res) => {
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
  });

  app.post('/claude/config/direct', async (req, res) => {
    try {
      const { apiKey } = req.body;
      if (!apiKey) {
        return res.status(400).json({ success: false, error: 'API key required' });
      }

      const config = await setDirectMode(apiKey);
      res.json({
        success: true,
        message: 'Claude CLI configured to use direct Anthropic API',
        config
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Logs API
  app.get('/api/logs', (req, res) => {
    res.json({
      status: 'ok',
      logs: logger.getHistory()
    });
  });

  app.get('/api/logs/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendLog = (log) => {
      res.write(`data: ${JSON.stringify(log)}\n\n`);
    };

    if (req.query.history === 'true') {
      const history = logger.getHistory();
      history.forEach(log => sendLog(log));
    }

    logger.on('log', sendLog);

    req.on('close', () => {
      logger.off('log', sendLog);
    });
  });
}

export default { registerApiRoutes };
