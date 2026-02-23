import { sendMessageStream, sendMessage } from '../direct-api.js';
import { sendKiloMessageStream, sendKiloMessage } from '../kilo-api.js';
import { resolveModelRouting } from '../model-mapper.js';
import { sendAuthError, getCredentialsForAccount } from '../middleware/credentials.js';
import { initSSEResponse, pipeSSEStream, handleStreamError } from '../middleware/sse.js';
import { logger } from '../utils/logger.js';
import { AccountRotator } from '../account-rotation/index.js';
import { listAccounts, getActiveAccount, save } from '../account-manager.js';
import { getServerSettings } from '../server-settings.js';

const MAX_RETRIES = 5;
const MAX_WAIT_BEFORE_ERROR_MS = 120000;
const SHORT_RATE_LIMIT_THRESHOLD_MS = 5000;

let accountRotator = null;
let currentStrategy = null;

function getAccountRotator() {
    const settings = getServerSettings();
    const strategy = settings.accountStrategy || 'sticky';
    
    if (!accountRotator || currentStrategy !== strategy) {
        accountRotator = new AccountRotator({
            listAccounts,
            save,
            getActiveAccount
        }, strategy);
        currentStrategy = strategy;
        logger.info(`[Messages] Account strategy: ${strategy}`);
    }
    return accountRotator;
}

export async function handleMessages(req, res) {
    const startTime = Date.now();
    const body = req.body;
    const requestedModel = body.model || 'gpt-5.2';
    const isStreaming = body.stream !== false;
    
    const { isKilo, kiloTarget, upstreamModel } = resolveModelRouting(requestedModel);
    
    if (isKilo) {
        return isStreaming
            ? _streamKilo(res, { ...body, model: upstreamModel }, kiloTarget, requestedModel, startTime)
            : _sendKilo(res, { ...body, model: upstreamModel }, kiloTarget, requestedModel, startTime);
    }
    
    const rotator = getAccountRotator();
    
    rotator.clearExpiredLimits();
    
    const maxAttempts = Math.max(MAX_RETRIES, listAccounts().total);
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (rotator.isAllRateLimited(upstreamModel)) {
            const minWait = rotator.getMinWaitTimeMs(upstreamModel);
            
            if (minWait > MAX_WAIT_BEFORE_ERROR_MS) {
                return handleStreamError(res, new Error(`RESOURCE_EXHAUSTED: All accounts rate-limited. Wait ${Math.round(minWait/1000)}s`), requestedModel, startTime);
            }
            
            logger.info(`[Messages] All accounts rate-limited, waiting ${Math.round(minWait/1000)}s...`);
            await sleep(minWait + 500);
            rotator.clearExpiredLimits();
            attempt--;
            continue;
        }
        
        const { account, waitMs } = rotator.selectAccount(upstreamModel);
        
        if (!account) {
            if (waitMs > 0) {
                await sleep(waitMs);
                attempt--;
                continue;
            }
            return sendAuthError(res, 'No available accounts');
        }
        
        const creds = await getCredentialsForAccount(account.email);
        if (!creds) {
            rotator.markInvalid(account.email, 'Failed to get credentials');
            continue;
        }
        
        const anthropicRequest = { ...body, model: upstreamModel };
        
        try {
            if (isStreaming) {
                await _streamDirectWithRotation(res, anthropicRequest, creds, requestedModel, startTime, rotator);
            } else {
                await _sendDirectWithRotation(res, anthropicRequest, creds, requestedModel, startTime, rotator);
            }
            rotator.notifySuccess(account, upstreamModel);
            return;
        } catch (error) {
            if (error.message.startsWith('RATE_LIMITED:')) {
                const parts = error.message.split(':');
                const resetMs = parseInt(parts[1], 10);
                const errorText = parts.slice(2).join(':');
                
                rotator.notifyRateLimit(account, upstreamModel);
                
                if (resetMs <= SHORT_RATE_LIMIT_THRESHOLD_MS) {
                    logger.info(`[Messages] Short rate limit on ${account.email}, waiting ${resetMs}ms...`);
                    await sleep(resetMs);
                    attempt--;
                    continue;
                }
                
                logger.info(`[Messages] Rate limit on ${account.email}, switching account...`);
                continue;
            }
            
            if (error.message.includes('AUTH_EXPIRED')) {
                rotator.markInvalid(account.email, 'Auth expired');
                continue;
            }
            
            return handleStreamError(res, error, requestedModel, startTime);
        }
    }
    
    return handleStreamError(res, new Error('Max retries exceeded'), requestedModel, startTime);
}

async function _streamDirectWithRotation(res, anthropicRequest, creds, responseModel, startTime, rotator) {
    initSSEResponse(res);
    const stream = sendMessageStream(anthropicRequest, creds.accessToken, creds.accountId, rotator, creds.email);
    await pipeSSEStream(res, stream);
    logger.response(200, { model: anthropicRequest.model, duration: Date.now() - startTime });
}

async function _sendDirectWithRotation(res, anthropicRequest, creds, responseModel, startTime, rotator) {
    const response = await sendMessage(anthropicRequest, creds.accessToken, creds.accountId);
    const duration = Date.now() - startTime;
    logger.response(200, { model: anthropicRequest.model, tokens: response.usage?.output_tokens || 0, duration });
    res.json({ ...response, model: responseModel });
}

async function _streamKilo(res, anthropicRequest, kiloTarget, responseModel, startTime) {
    initSSEResponse(res);
    const stream = sendKiloMessageStream(anthropicRequest, kiloTarget);
    await pipeSSEStream(res, stream);
    logger.response(200, { model: kiloTarget, duration: Date.now() - startTime });
}

async function _sendKilo(res, anthropicRequest, kiloTarget, responseModel, startTime) {
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
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export default { handleMessages };
