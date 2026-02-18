/**
 * Messages Route
 * Handles POST /v1/messages (Anthropic Messages API)
 */

import { sendMessageStream, sendMessage } from '../direct-api.js';
import { sendKiloMessageStream, sendKiloMessage } from '../kilo-api.js';
import { resolveModelRouting } from '../model-mapper.js';
import { getCredentialsOrError, sendAuthError } from '../middleware/credentials.js';
import { initSSEResponse, pipeSSEStream, handleStreamError } from '../middleware/sse.js';
import { logger } from '../utils/logger.js';

/**
 * POST /v1/messages
 * Supports both streaming and non-streaming, routed to either Codex or Kilo.
 */
export async function handleMessages(req, res) {
  const startTime = Date.now();
  const body = req.body;
  const requestedModel = body.model || 'gpt-5.2';
  const isStreaming = body.stream !== false;

  const { isKilo, kiloTarget, upstreamModel } = resolveModelRouting(requestedModel);
  const logAccount = isKilo ? 'kilo' : null;

  let creds = null;
  if (!isKilo) {
    creds = await getCredentialsOrError();
    if (!creds) {
      logger.response(401, { error: 'No active account' });
      return sendAuthError(res);
    }
  }

  logger.request('POST', '/v1/messages', {
    model: upstreamModel,
    account: logAccount || creds.email,
    stream: isStreaming,
    messages: body.messages?.length || 0,
    tools: body.tools?.length || 0
  });

  const anthropicRequest = { ...body, model: upstreamModel };

  if (isKilo) {
    return isStreaming
      ? _streamKilo(res, anthropicRequest, kiloTarget, requestedModel, startTime)
      : _sendKilo(res, anthropicRequest, kiloTarget, requestedModel, startTime);
  }

  return isStreaming
    ? _streamDirect(res, anthropicRequest, creds, requestedModel, startTime)
    : _sendDirect(res, anthropicRequest, creds, requestedModel, startTime);
}

// ─── Direct (Codex) ──────────────────────────────────────────────────────────

async function _sendDirect(res, anthropicRequest, creds, responseModel, startTime) {
  try {
    const response = await sendMessage(anthropicRequest, creds.accessToken, creds.accountId);
    const duration = Date.now() - startTime;
    logger.response(200, { model: anthropicRequest.model, tokens: response.usage?.output_tokens || 0, duration });
    res.json({ ...response, model: responseModel });
  } catch (error) {
    handleStreamError(res, error, anthropicRequest.model, startTime);
  }
}

async function _streamDirect(res, anthropicRequest, creds, responseModel, startTime) {
  initSSEResponse(res);
  try {
    const stream = sendMessageStream(anthropicRequest, creds.accessToken, creds.accountId);
    await pipeSSEStream(res, stream);
    logger.response(200, { model: anthropicRequest.model, duration: Date.now() - startTime });
  } catch (error) {
    handleStreamError(res, error, anthropicRequest.model, startTime);
  }
}

// ─── Kilo ────────────────────────────────────────────────────────────────────

async function _sendKilo(res, anthropicRequest, kiloTarget, responseModel, startTime) {
  try {
    const response = await sendKiloMessage(anthropicRequest, kiloTarget);
    const duration = Date.now() - startTime;
    logger.response(200, { model: kiloTarget, tokens: response.usage?.output_tokens || 0, duration });
    res.json({
      id: response.id || undefined,
      type: 'message',
      role: 'assistant',
      content: response.content,
      model: responseModel,
      stop_reason: response.stopReason,
      stop_sequence: null,
      usage: response.usage
    });
  } catch (error) {
    handleStreamError(res, error, kiloTarget, startTime);
  }
}

async function _streamKilo(res, anthropicRequest, kiloTarget, responseModel, startTime) {
  initSSEResponse(res);
  try {
    const stream = sendKiloMessageStream(anthropicRequest, kiloTarget);
    await pipeSSEStream(res, stream);
    logger.response(200, { model: kiloTarget, duration: Date.now() - startTime });
  } catch (error) {
    handleStreamError(res, error, kiloTarget, startTime);
  }
}

export default { handleMessages };
