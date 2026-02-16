/**
 * Response Streamer
 * Streams SSE events from OpenAI Responses API and converts to Anthropic format
 */

import { generateMessageId } from './format-converter.js';

/**
 * Stream OpenAI Responses API SSE events and yield Anthropic-format events
 * 
 * OpenAI Responses API event types:
 * - response.created
 * - response.in_progress
 * - response.output_item.added (type: message, function_call, reasoning)
 * - response.output_text.delta
 * - response.function_call_arguments.delta
 * - response.function_call_arguments.done
 * - response.output_item.done
 * - response.completed
 * 
 * Anthropic event types:
 * - message_start
 * - content_block_start
 * - content_block_delta
 * - content_block_stop
 * - message_delta
 * - message_stop
 * 
 * @param {Response} response - The HTTP response with SSE body
 * @param {string} model - The model name
 * @yields {Object} Anthropic-format SSE events
 */
export async function* streamResponsesAPI(response, model) {
    const messageId = generateMessageId();
    let hasEmittedStart = false;
    let blockIndex = 0;
    let currentBlockType = null;
    let currentBlockId = null;
    let currentToolName = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason = 'end_turn';
    let pendingArguments = '';
    let usage = { input_tokens: 0, output_tokens: 0 };

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            if (!line.startsWith('data:')) continue;

            const jsonText = line.slice(5).trim();
            if (!jsonText) continue;

            try {
                const event = JSON.parse(jsonText);
                const eventType = event.type;

                // Extract usage from completed response
                if (eventType === 'response.completed' && event.response?.usage) {
                    inputTokens = event.response.usage.input_tokens || 0;
                    outputTokens = event.response.usage.output_tokens || 0;
                    usage = {
                        input_tokens: inputTokens,
                        output_tokens: outputTokens,
                        cache_read_input_tokens: event.response.usage.cache_read_input_tokens || 0
                    };
                }

                // Handle output item added
                if (eventType === 'response.output_item.added') {
                    const item = event.item;
                    
                    if (!hasEmittedStart) {
                        hasEmittedStart = true;
                        yield {
                            event: 'message_start',
                            data: {
                                type: 'message_start',
                                message: {
                                    id: messageId,
                                    type: 'message',
                                    role: 'assistant',
                                    model: model,
                                    content: [],
                                    stop_reason: null,
                                    stop_sequence: null,
                                    usage: { input_tokens: 0, output_tokens: 0 }
                                }
                            }
                        };
                    }

                    // Close previous block if any
                    if (currentBlockType !== null) {
                        yield {
                            event: 'content_block_stop',
                            data: { type: 'content_block_stop', index: blockIndex }
                        };
                        blockIndex++;
                    }

                    // Start new block based on item type
                    if (item.type === 'message') {
                        currentBlockType = 'text';
                        currentBlockId = item.id;
                        yield {
                            event: 'content_block_start',
                            data: {
                                type: 'content_block_start',
                                index: blockIndex,
                                content_block: { type: 'text', text: '' }
                            }
                        };
                    } else if (item.type === 'function_call') {
                        currentBlockType = 'tool_use';
                        currentBlockId = item.call_id || item.id;
                        currentToolName = item.name;
                        stopReason = 'tool_use';
                        
                        yield {
                            event: 'content_block_start',
                            data: {
                                type: 'content_block_start',
                                index: blockIndex,
                                content_block: {
                                    type: 'tool_use',
                                    id: currentBlockId,
                                    name: item.name,
                                    input: {}
                                }
                            }
                        };
                    } else if (item.type === 'reasoning') {
                        currentBlockType = 'thinking';
                        currentBlockId = item.id;
                        yield {
                            event: 'content_block_start',
                            data: {
                                type: 'content_block_start',
                                index: blockIndex,
                                content_block: { type: 'thinking', thinking: '' }
                            }
                        };
                    }
                }

                // Handle text delta
                if (eventType === 'response.output_text.delta') {
                    const delta = event.delta;
                    if (delta && currentBlockType === 'text') {
                        yield {
                            event: 'content_block_delta',
                            data: {
                                type: 'content_block_delta',
                                index: blockIndex,
                                delta: { type: 'text_delta', text: delta }
                            }
                        };
                    }
                }

                // Handle function call arguments delta
                if (eventType === 'response.function_call_arguments.delta') {
                    const delta = event.delta;
                    if (delta && currentBlockType === 'tool_use') {
                        pendingArguments += delta;
                        yield {
                            event: 'content_block_delta',
                            data: {
                                type: 'content_block_delta',
                                index: blockIndex,
                                delta: { type: 'input_json_delta', partial_json: delta }
                            }
                        };
                    }
                }

                // Handle function call arguments done
                if (eventType === 'response.function_call_arguments.done') {
                    // Arguments complete - nothing special needed, already streamed
                }

                // Handle output item done
                if (eventType === 'response.output_item.done') {
                    // Block will be closed when next item starts or at the end
                }

            } catch (parseError) {
                // Ignore parse errors for individual lines
            }
        }
    }

    // Handle no content received
    if (!hasEmittedStart) {
        hasEmittedStart = true;
        yield {
            event: 'message_start',
            data: {
                type: 'message_start',
                message: {
                    id: messageId,
                    type: 'message',
                    role: 'assistant',
                    model: model,
                    content: [],
                    stop_reason: null,
                    stop_sequence: null,
                    usage: { input_tokens: 0, output_tokens: 0 }
                }
            }
        };
        
        // Emit empty text block
        yield {
            event: 'content_block_start',
            data: {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'text', text: '' }
            }
        };
        
        yield {
            event: 'content_block_delta',
            data: {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: '' }
            }
        };
        
        yield {
            event: 'content_block_stop',
            data: { type: 'content_block_stop', index: 0 }
        };
        
        blockIndex = 1;
        currentBlockType = null;
    } else if (currentBlockType !== null) {
        // Close any open block
        yield {
            event: 'content_block_stop',
            data: { type: 'content_block_stop', index: blockIndex }
        };
    }

    // Emit message_delta with final usage
    yield {
        event: 'message_delta',
        data: {
            type: 'message_delta',
            delta: { stop_reason: stopReason, stop_sequence: null },
            usage: usage
        }
    };

    // Emit message_stop
    yield {
        event: 'message_stop',
        data: { type: 'message_stop' }
    };
}

/**
 * Parse SSE events from OpenAI Responses API (non-streaming)
 * Returns the final response object
 * 
 * @param {Response} response - The HTTP response with SSE body
 * @returns {Object} The parsed response object
 */
export async function parseResponsesAPIResponse(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResponse = null;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            if (!line.startsWith('data:')) continue;

            const jsonText = line.slice(5).trim();
            if (!jsonText) continue;

            try {
                const event = JSON.parse(jsonText);
                
                // Capture the completed response
                if (event.type === 'response.completed') {
                    finalResponse = event.response;
                }
            } catch (parseError) {
                // Ignore parse errors
            }
        }
    }

    return finalResponse;
}

/**
 * Format Anthropic SSE event for HTTP response
 */
export function formatSSEEvent(event) {
    return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

export default {
    streamResponsesAPI,
    parseResponsesAPIResponse,
    formatSSEEvent
};