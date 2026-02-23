/**
 * Signature Cache
 * In-memory cache for thinking signatures
 *
 * Claude Code strips non-standard fields. This cache stores signatures by tool_use_id
 * so they can be restored in subsequent requests.
 *
 * Also caches thinking block signatures with model family for cross-model
 * compatibility checking.
 */

// Default cache TTL: 2 hours
const SIGNATURE_CACHE_TTL_MS = 2 * 60 * 60 * 1000;

// Minimum valid signature length
const MIN_SIGNATURE_LENGTH = 50;

const signatureCache = new Map();
const thinkingSignatureCache = new Map();

/**
 * Store a signature for a tool_use_id
 * @param {string} toolUseId - The tool use ID
 * @param {string} signature - The thoughtSignature to cache
 */
export function cacheSignature(toolUseId, signature) {
    if (!toolUseId || !signature) return;
    signatureCache.set(toolUseId, {
        signature,
        timestamp: Date.now()
    });
}

/**
 * Get a cached signature for a tool_use_id
 * @param {string} toolUseId - The tool use ID
 * @returns {string|null} The cached signature or null if not found/expired
 */
export function getCachedSignature(toolUseId) {
    if (!toolUseId) return null;
    const entry = signatureCache.get(toolUseId);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.timestamp > SIGNATURE_CACHE_TTL_MS) {
        signatureCache.delete(toolUseId);
        return null;
    }

    return entry.signature;
}

/**
 * Cache a thinking block signature with its model family
 * @param {string} signature - The thinking signature to cache
 * @param {string} modelFamily - The model family ('claude' or 'gemini' or 'openai')
 */
export function cacheThinkingSignature(signature, modelFamily) {
    if (!signature || signature.length < MIN_SIGNATURE_LENGTH) return;
    thinkingSignatureCache.set(signature, {
        modelFamily,
        timestamp: Date.now()
    });
}

/**
 * Get the cached model family for a thinking signature
 * @param {string} signature - The signature to look up
 * @returns {string|null} 'claude', 'gemini', 'openai', or null if not found/expired
 */
export function getCachedSignatureFamily(signature) {
    if (!signature) return null;
    const entry = thinkingSignatureCache.get(signature);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.timestamp > SIGNATURE_CACHE_TTL_MS) {
        thinkingSignatureCache.delete(signature);
        return null;
    }

    return entry.modelFamily;
}

/**
 * Clear all entries from the thinking signature cache.
 * Used for testing cold cache scenarios.
 */
export function clearThinkingSignatureCache() {
    thinkingSignatureCache.clear();
    signatureCache.clear();
}

export const SIGNATURE_CONSTANTS = {
    MIN_SIGNATURE_LENGTH,
    SIGNATURE_CACHE_TTL_MS
};

export default {
    cacheSignature,
    getCachedSignature,
    cacheThinkingSignature,
    getCachedSignatureFamily,
    clearThinkingSignatureCache,
    SIGNATURE_CONSTANTS
};
