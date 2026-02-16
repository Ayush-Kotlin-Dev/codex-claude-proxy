/**
 * Kilo Streamer
 * Streams OpenAI Chat Completions SSE and converts to Anthropic SSE events
 */

import { generateMessageId } from './format-converter.js';

export async function* streamOpenAIChat(response, model) {
    const messageId = generateMessageId();
    let hasEmittedStart = false;
    let blockIndex = 0;
    let currentBlockType = null;
    let currentToolCallId = null;
    let currentToolName = null;
    let pendingToolArgs = new Map();
    let stopReason = 'end_turn';
    let usage = { input_tokens: 0, output_tokens: 0 };

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const emitMessageStart = () => ({
        event: 'message_start',
        data: {
            type: 'message_start',
            message: {
                id: messageId,
                type: 'message',
                role: 'assistant',
                model,
                content: [],
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 0, output_tokens: 0 }
            }
        }
    });

    const emitContentBlockStart = (contentBlock) => ({
        event: 'content_block_start',
        data: {
            type: 'content_block_start',
            index: blockIndex,
            content_block: contentBlock
        }
    });

    const emitContentBlockDelta = (delta) => ({
        event: 'content_block_delta',
        data: {
            type: 'content_block_delta',
            index: blockIndex,
            delta
        }
    });

    const emitContentBlockStop = () => ({
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: blockIndex }
    });

    const startTextBlock = () => {
        currentBlockType = 'text';
        currentToolCallId = null;
        currentToolName = null;
        return emitContentBlockStart({ type: 'text', text: '' });
    };

    const startToolBlock = (toolCall) => {
        currentBlockType = 'tool_use';
        currentToolCallId = toolCall.id;
        currentToolName = toolCall.function?.name || 'tool';
        stopReason = 'tool_use';
        return emitContentBlockStart({
            type: 'tool_use',
            id: currentToolCallId,
            name: currentToolName,
            input: {}
        });
    };

    const handleDelta = (delta) => {
        const events = [];

        if (delta.content) {
            if (!hasEmittedStart) {
                hasEmittedStart = true;
                events.push(emitMessageStart());
                events.push(startTextBlock());
            } else if (currentBlockType !== 'text') {
                events.push(emitContentBlockStop());
                blockIndex++;
                events.push(startTextBlock());
            }

            events.push(emitContentBlockDelta({ type: 'text_delta', text: delta.content }));
        }

        if (Array.isArray(delta.tool_calls)) {
            for (const toolCall of delta.tool_calls) {
                if (!hasEmittedStart) {
                    hasEmittedStart = true;
                    events.push(emitMessageStart());
                }

                if (currentBlockType !== 'tool_use' || currentToolCallId !== toolCall.id) {
                    if (currentBlockType) {
                        events.push(emitContentBlockStop());
                        blockIndex++;
                    }
                    events.push(startToolBlock(toolCall));
                }

                const argsDelta = toolCall.function?.arguments || '';
                if (argsDelta) {
                    const prev = pendingToolArgs.get(toolCall.id) || '';
                    pendingToolArgs.set(toolCall.id, prev + argsDelta);
                    events.push(emitContentBlockDelta({
                        type: 'input_json_delta',
                        partial_json: argsDelta
                    }));
                }
            }
        }

        return events;
    };

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
            if (jsonText === '[DONE]') continue;

            try {
                const chunk = JSON.parse(jsonText);

                if (chunk.usage) {
                    usage = {
                        input_tokens: chunk.usage.prompt_tokens || 0,
                        output_tokens: chunk.usage.completion_tokens || 0
                    };
                }

                const choice = chunk.choices?.[0];
                if (!choice) continue;

                const events = handleDelta(choice.delta || {});
                for (const evt of events) {
                    yield evt;
                }

                if (choice.finish_reason) {
                    stopReason = choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn';
                }
            } catch (err) {
                // ignore malformed chunks
            }
        }
    }

    if (!hasEmittedStart) {
        hasEmittedStart = true;
        yield emitMessageStart();
        yield emitContentBlockStart({ type: 'text', text: '' });
        yield emitContentBlockDelta({ type: 'text_delta', text: '' });
        yield emitContentBlockStop();
    } else if (currentBlockType) {
        yield emitContentBlockStop();
    }

    yield {
        event: 'message_delta',
        data: {
            type: 'message_delta',
            delta: { stop_reason: stopReason, stop_sequence: null },
            usage
        }
    };

    yield {
        event: 'message_stop',
        data: { type: 'message_stop' }
    };
}

export default {
    streamOpenAIChat
};
