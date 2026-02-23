/**
 * Thinking Block Utilities
 * Handles thinking block processing, validation, and filtering
 */

import { getCachedSignatureFamily, SIGNATURE_CONSTANTS } from './signature-cache.js';

const { MIN_SIGNATURE_LENGTH } = SIGNATURE_CONSTANTS;

// ============================================================================
// Cache Control Cleaning (Critical for Claude Code compatibility)
// ============================================================================

/**
 * Remove cache_control fields from all content blocks in messages.
 * This is critical - Claude Code CLI sends cache_control fields that the API
 * rejects with "Extra inputs are not permitted".
 *
 * @param {Array<Object>} messages - Array of messages in Anthropic format
 * @returns {Array<Object>} Messages with cache_control fields removed
 */
export function cleanCacheControl(messages) {
    if (!Array.isArray(messages)) return messages;

    let removedCount = 0;

    const cleaned = messages.map(message => {
        if (!message || typeof message !== 'object') return message;

        // Handle string content (no cache_control possible)
        if (typeof message.content === 'string') return message;

        // Handle array content
        if (!Array.isArray(message.content)) return message;

        const cleanedContent = message.content.map(block => {
            if (!block || typeof block !== 'object') return block;

            // Check if cache_control exists before destructuring
            if (block.cache_control === undefined) return block;

            // Create a shallow copy without cache_control
            const { cache_control, ...cleanBlock } = block;
            removedCount++;

            return cleanBlock;
        });

        return {
            ...message,
            content: cleanedContent
        };
    });

    if (removedCount > 0) {
        console.log(`[ThinkingUtils] Removed cache_control from ${removedCount} block(s)`);
    }

    return cleaned;
}

// ============================================================================
// Thinking Block Detection and Validation
// ============================================================================

/**
 * Check if a part is a thinking block
 * @param {Object} part - Content part to check
 * @returns {boolean} True if the part is a thinking block
 */
function isThinkingPart(part) {
    return part.type === 'thinking' ||
        part.type === 'redacted_thinking' ||
        part.thinking !== undefined ||
        part.thought === true;
}

/**
 * Check if a thinking part has a valid signature (>= MIN_SIGNATURE_LENGTH chars)
 */
function hasValidSignature(part) {
    const signature = part.thought === true ? part.thoughtSignature : part.signature;
    return typeof signature === 'string' && signature.length >= MIN_SIGNATURE_LENGTH;
}

/**
 * Check if conversation has unsigned thinking blocks that will be dropped.
 * These cause "Expected thinking but found text" errors.
 * @param {Array<Object>} messages - Array of messages
 * @returns {boolean} True if any assistant message has unsigned thinking blocks
 */
export function hasUnsignedThinkingBlocks(messages) {
    return messages.some(msg => {
        if (msg.role !== 'assistant' && msg.role !== 'model') return false;
        if (!Array.isArray(msg.content)) return false;
        return msg.content.some(block =>
            isThinkingPart(block) && !hasValidSignature(block)
        );
    });
}

// ============================================================================
// Thinking Block Sanitization
// ============================================================================

/**
 * Sanitize a thinking block by removing extra fields like cache_control.
 * Only keeps: type, thinking, signature (for thinking) or type, data (for redacted_thinking)
 */
function sanitizeAnthropicThinkingBlock(block) {
    if (!block) return block;

    if (block.type === 'thinking') {
        const sanitized = { type: 'thinking' };
        if (block.thinking !== undefined) sanitized.thinking = block.thinking;
        if (block.signature !== undefined) sanitized.signature = block.signature;
        return sanitized;
    }

    if (block.type === 'redacted_thinking') {
        const sanitized = { type: 'redacted_thinking' };
        if (block.data !== undefined) sanitized.data = block.data;
        return sanitized;
    }

    return block;
}

/**
 * Sanitize a text block by removing extra fields like cache_control.
 * Only keeps: type, text
 */
function sanitizeTextBlock(block) {
    if (!block || block.type !== 'text') return block;

    const sanitized = { type: 'text' };
    if (block.text !== undefined) sanitized.text = block.text;
    return sanitized;
}

/**
 * Sanitize a tool_use block by removing extra fields like cache_control.
 * Only keeps: type, id, name, input, thoughtSignature
 */
function sanitizeToolUseBlock(block) {
    if (!block || block.type !== 'tool_use') return block;

    const sanitized = { type: 'tool_use' };
    if (block.id !== undefined) sanitized.id = block.id;
    if (block.name !== undefined) sanitized.name = block.name;
    if (block.input !== undefined) sanitized.input = block.input;
    if (block.thoughtSignature !== undefined) sanitized.thoughtSignature = block.thoughtSignature;
    return sanitized;
}

// ============================================================================
// Thinking Block Processing
// ============================================================================

/**
 * Remove trailing unsigned thinking blocks from assistant messages.
 * APIs require that assistant messages don't end with unsigned thinking blocks.
 *
 * @param {Array<Object>} content - Array of content blocks
 * @returns {Array<Object>} Content array with trailing unsigned thinking blocks removed
 */
export function removeTrailingThinkingBlocks(content) {
    if (!Array.isArray(content)) return content;
    if (content.length === 0) return content;

    // Work backwards from the end, removing thinking blocks
    let endIndex = content.length;
    for (let i = content.length - 1; i >= 0; i--) {
        const block = content[i];
        if (!block || typeof block !== 'object') break;

        const isThinking = isThinkingPart(block);

        if (isThinking) {
            if (!hasValidSignature(block)) {
                endIndex = i;
            } else {
                break; // Stop at signed thinking block
            }
        } else {
            break; // Stop at first non-thinking block
        }
    }

    if (endIndex < content.length) {
        console.log(`[ThinkingUtils] Removed ${content.length - endIndex} trailing unsigned thinking blocks`);
        return content.slice(0, endIndex);
    }

    return content;
}

/**
 * Filter thinking blocks: keep only those with valid signatures.
 * Blocks without signatures are dropped (API requires signatures).
 *
 * @param {Array<Object>} content - Array of content blocks
 * @returns {Array<Object>} Filtered content with only valid signed thinking blocks
 */
export function restoreThinkingSignatures(content) {
    if (!Array.isArray(content)) return content;

    const originalLength = content.length;
    const filtered = [];

    for (const block of content) {
        if (!block || block.type !== 'thinking') {
            filtered.push(block);
            continue;
        }

        // Keep blocks with valid signatures, sanitized
        if (block.signature && block.signature.length >= MIN_SIGNATURE_LENGTH) {
            filtered.push(sanitizeAnthropicThinkingBlock(block));
        }
        // Unsigned thinking blocks are dropped
    }

    if (filtered.length < originalLength) {
        console.log(`[ThinkingUtils] Dropped ${originalLength - filtered.length} unsigned thinking block(s)`);
    }

    return filtered;
}

/**
 * Reorder content so that:
 * 1. Thinking blocks come first (required when thinking is enabled)
 * 2. Text blocks come in the middle (filtering out empty/useless ones)
 * 3. Tool_use blocks come at the end (required before tool_result)
 *
 * @param {Array<Object>} content - Array of content blocks
 * @returns {Array<Object>} Reordered content array
 */
export function reorderAssistantContent(content) {
    if (!Array.isArray(content)) return content;

    // Even for single-element arrays, we need to sanitize thinking blocks
    if (content.length === 1) {
        const block = content[0];
        if (block && (block.type === 'thinking' || block.type === 'redacted_thinking')) {
            return [sanitizeAnthropicThinkingBlock(block)];
        }
        return content;
    }

    const thinkingBlocks = [];
    const textBlocks = [];
    const toolUseBlocks = [];
    let droppedEmptyBlocks = 0;

    for (const block of content) {
        if (!block) continue;

        if (block.type === 'thinking' || block.type === 'redacted_thinking') {
            thinkingBlocks.push(sanitizeAnthropicThinkingBlock(block));
        } else if (block.type === 'tool_use') {
            toolUseBlocks.push(sanitizeToolUseBlock(block));
        } else if (block.type === 'text') {
            // Only keep text blocks with meaningful content
            if (block.text && block.text.trim().length > 0) {
                textBlocks.push(sanitizeTextBlock(block));
            } else {
                droppedEmptyBlocks++;
            }
        } else {
            textBlocks.push(block);
        }
    }

    if (droppedEmptyBlocks > 0) {
        console.log(`[ThinkingUtils] Dropped ${droppedEmptyBlocks} empty text block(s)`);
    }

    return [...thinkingBlocks, ...textBlocks, ...toolUseBlocks];
}

/**
 * Process assistant message content:
 * 1. Restore thinking signatures from cache
 * 2. Remove trailing unsigned thinking blocks
 * 3. Reorder content (thinking first, then text, then tool_use)
 *
 * @param {Array<Object>} content - Content array from assistant message
 * @returns {Array<Object>} Processed content
 */
export function processAssistantContent(content) {
    if (!Array.isArray(content)) return content;

    let processed = restoreThinkingSignatures(content);
    processed = removeTrailingThinkingBlocks(processed);
    processed = reorderAssistantContent(processed);

    return processed;
}

export default {
    cleanCacheControl,
    hasUnsignedThinkingBlocks,
    removeTrailingThinkingBlocks,
    restoreThinkingSignatures,
    reorderAssistantContent,
    processAssistantContent
};
