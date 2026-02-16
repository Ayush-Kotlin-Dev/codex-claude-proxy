/**
 * Direct API Client
 * Makes direct HTTP calls to ChatGPT's backend API
 */

import { convertAnthropicToResponsesAPI, convertOutputToAnthropic, generateMessageId } from './format-converter.js';
import { streamResponsesAPI, parseResponsesAPIResponse } from './response-streamer.js';

const API_URL = 'https://chatgpt.com/backend-api/codex/responses';

/**
 * Send a streaming request to ChatGPT API
 */
export async function* sendMessageStream(anthropicRequest, accessToken, accountId) {
    const request = convertAnthropicToResponsesAPI(anthropicRequest);
    
    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'ChatGPT-Account-ID': accountId,
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream'
        },
        body: JSON.stringify(request)
    });

    if (!response.ok) {
        const errorText = await response.text();
        
        if (response.status === 401) {
            throw new Error('AUTH_EXPIRED: Token expired or revoked. Please re-authenticate.');
        }
        
        if (response.status === 429) {
            throw new Error(`RATE_LIMITED: ${errorText}`);
        }
        
        if (response.status === 403) {
            if (errorText.includes('challenge') || errorText.includes('cloudflare')) {
                throw new Error('CLOUDFLARE_BLOCKED: Request blocked by Cloudflare.');
            }
            throw new Error(`FORBIDDEN: ${errorText}`);
        }
        
        if (response.status === 400) {
            throw new Error(`INVALID_REQUEST: ${errorText}`);
        }
        
        throw new Error(`API_ERROR: ${response.status} - ${errorText}`);
    }

    yield* streamResponsesAPI(response, anthropicRequest.model);
}

/**
 * Send a non-streaming request to ChatGPT API
 */
export async function sendMessage(anthropicRequest, accessToken, accountId) {
    const request = convertAnthropicToResponsesAPI({
        ...anthropicRequest,
        stream: false
    });
    
    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'ChatGPT-Account-ID': accountId,
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream'
        },
        body: JSON.stringify(request)
    });

    if (!response.ok) {
        const errorText = await response.text();
        
        if (response.status === 401) {
            throw new Error('AUTH_EXPIRED: Token expired or revoked. Please re-authenticate.');
        }
        
        throw new Error(`API_ERROR: ${response.status} - ${errorText}`);
    }

    const apiResponse = await parseResponsesAPIResponse(response);
    
    if (!apiResponse) {
        return {
            id: generateMessageId(),
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: '' }],
            model: anthropicRequest.model,
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 }
        };
    }

    const content = convertOutputToAnthropic(apiResponse.output);
    const stopReason = content.some(c => c.type === 'tool_use') ? 'tool_use' : 'end_turn';

    return {
        id: generateMessageId(),
        type: 'message',
        role: 'assistant',
        content: content,
        model: anthropicRequest.model,
        stop_reason: stopReason,
        stop_sequence: null,
        usage: {
            input_tokens: apiResponse.usage?.input_tokens || 0,
            output_tokens: apiResponse.usage?.output_tokens || 0,
            cache_read_input_tokens: apiResponse.usage?.cache_read_input_tokens || 0
        }
    };
}

export default {
    sendMessageStream,
    sendMessage
};