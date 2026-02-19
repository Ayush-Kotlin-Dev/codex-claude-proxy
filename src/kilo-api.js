/**
 * Kilo API client
 */

import { convertAnthropicToOpenAIChat, convertOpenAIChatToAnthropic } from './kilo-format-converter.js';
import { streamOpenAIChat } from './kilo-streamer.js';

import fs from 'fs';
import path from 'path';

const KILO_API_URL = 'https://api.kilo.ai/api/openrouter/chat/completions';

// Read telemetry ID for machine identification
let telemetryId = 'anonymous';
try {
    const telemetryPath = path.resolve('telemetry-id');
    if (fs.existsSync(telemetryPath)) {
        telemetryId = fs.readFileSync(telemetryPath, 'utf8').trim();
    }
} catch (e) {
    console.warn('Failed to read telemetry-id:', e.message);
}

const KILO_HEADERS = {
    Authorization: 'Bearer anonymous',
    'User-Agent': 'opencode-kilo-provider',
    'HTTP-Referer': 'https://kilo.ai',
    'X-KiloCode-MachineId': telemetryId // used for telemetry , rate limiting 
};

function buildError(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
}

export async function* sendKiloMessageStream(anthropicRequest, targetModel) {
    const requestBody = convertAnthropicToOpenAIChat(anthropicRequest, targetModel);

    const response = await fetch(KILO_API_URL, {
        method: 'POST',
        headers: {
            ...KILO_HEADERS,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream'
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw buildError(response.status, `KILO_API_ERROR: ${response.status} - ${errorText}`);
    }

    yield* streamOpenAIChat(response, anthropicRequest.model);
}

export async function sendKiloMessage(anthropicRequest, targetModel) {
    const requestBody = convertAnthropicToOpenAIChat({ ...anthropicRequest, stream: false }, targetModel);

    const response = await fetch(KILO_API_URL, {
        method: 'POST',
        headers: {
            ...KILO_HEADERS,
            'Content-Type': 'application/json',
            Accept: 'application/json'
        },
        body: JSON.stringify({ ...requestBody, stream: false })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw buildError(response.status, `KILO_API_ERROR: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return convertOpenAIChatToAnthropic(data);
}

export default {
    sendKiloMessageStream,
    sendKiloMessage
};
