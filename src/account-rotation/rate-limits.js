import { logger } from '../utils/logger.js';

export const CooldownReason = {
    RATE_LIMIT: 'RATE_LIMIT',
    AUTH_FAILURE: 'AUTH_FAILURE',
    CONSECUTIVE_FAILURES: 'CONSECUTIVE_FAILURES',
    SERVER_ERROR: 'SERVER_ERROR'
};

const DEFAULT_COOLDOWN_MS = 60000;

/**
 * Check if all accounts are rate-limited for a specific model
 * @param {Array} accounts - Array of account objects
 * @param {string} modelId - Model identifier
 * @returns {boolean} True if all accounts are rate-limited
 */
export function isAllRateLimited(accounts, modelId) {
    if (!accounts || accounts.length === 0) return true;
    return accounts.every(account => {
        const rateLimit = account.modelRateLimits?.[modelId];
        return rateLimit?.isRateLimited && rateLimit.resetTime > Date.now();
    });
}

/**
 * Get list of accounts that are not rate-limited for a specific model
 * @param {Array} accounts - Array of account objects
 * @param {string} modelId - Model identifier
 * @returns {Array} Array of available account objects
 */
export function getAvailableAccounts(accounts, modelId) {
    if (!accounts || accounts.length === 0) return [];
    const now = Date.now();
    return accounts.filter(account => {
        if (account.isInvalid) return false;
        if (isAccountCoolingDown(account)) return false;
        const rateLimit = account.modelRateLimits?.[modelId];
        return !rateLimit?.isRateLimited || rateLimit.resetTime <= now;
    });
}

/**
 * Clear all expired rate limits across all accounts
 * @param {Array} accounts - Array of account objects
 * @returns {number} Count of cleared rate limits
 */
export function clearExpiredLimits(accounts) {
    if (!accounts || accounts.length === 0) return 0;
    const now = Date.now();
    let clearedCount = 0;

    for (const account of accounts) {
        if (!account.modelRateLimits) continue;
        for (const modelId of Object.keys(account.modelRateLimits)) {
            const rateLimit = account.modelRateLimits[modelId];
            if (rateLimit?.isRateLimited && rateLimit.resetTime <= now) {
                account.modelRateLimits[modelId] = {
                    isRateLimited: false,
                    resetTime: null,
                    actualResetMs: null
                };
                clearedCount++;
                logger.debug(`Cleared expired rate limit for ${account.email} model ${modelId}`);
            }
        }
    }

    return clearedCount;
}

/**
 * Reset all rate limits for all accounts (optimistic retry)
 * @param {Array} accounts - Array of account objects
 */
export function resetAllRateLimits(accounts) {
    if (!accounts || accounts.length === 0) return;
    for (const account of accounts) {
        account.modelRateLimits = {};
    }
    logger.info('Reset all rate limits for all accounts (optimistic retry)');
}

/**
 * Mark an account as rate-limited for a specific model
 * @param {Array} accounts - Array of account objects
 * @param {string} email - Account email
 * @param {number} resetMs - Reset time in milliseconds
 * @param {string} modelId - Model identifier
 */
export function markRateLimited(accounts, email, resetMs, modelId) {
    const account = accounts?.find(a => a.email === email);
    if (!account) {
        logger.warn(`Account not found: ${email}`);
        return;
    }

    if (!account.modelRateLimits) {
        account.modelRateLimits = {};
    }

    account.modelRateLimits[modelId] = {
        isRateLimited: true,
        resetTime: Date.now() + resetMs,
        actualResetMs: resetMs
    };

    logger.debug(`Rate limited ${email} for model ${modelId} for ${resetMs}ms`);
}

/**
 * Mark an account as invalid
 * @param {Array} accounts - Array of account objects
 * @param {string} email - Account email
 * @param {string} reason - Reason for invalid status
 */
export function markInvalid(accounts, email, reason) {
    const account = accounts?.find(a => a.email === email);
    if (!account) {
        logger.warn(`Account not found: ${email}`);
        return;
    }

    account.isInvalid = true;
    account.invalidReason = reason;
    account.invalidAt = Date.now();

    logger.warn(`Marked account ${email} as invalid: ${reason}`);
}

/**
 * Clear invalid status for an account
 * @param {Array} accounts - Array of account objects
 * @param {string} email - Account email
 */
export function clearInvalid(accounts, email) {
    const account = accounts?.find(a => a.email === email);
    if (!account) {
        logger.warn(`Account not found: ${email}`);
        return;
    }

    account.isInvalid = false;
    account.invalidReason = null;
    account.invalidAt = null;

    logger.info(`Cleared invalid status for account ${email}`);
}

/**
 * Get minimum wait time until any account is available for a model
 * @param {Array} accounts - Array of account objects
 * @param {string} modelId - Model identifier
 * @returns {number} Minimum wait time in milliseconds, 0 if any account available
 */
export function getMinWaitTimeMs(accounts, modelId) {
    if (!accounts || accounts.length === 0) return 0;

    const available = getAvailableAccounts(accounts, modelId);
    if (available.length > 0) return 0;

    const now = Date.now();
    let minWait = Infinity;

    for (const account of accounts) {
        if (account.isInvalid) continue;

        const cooldownRemaining = getCooldownRemaining(account);
        if (cooldownRemaining > 0 && cooldownRemaining < minWait) {
            minWait = cooldownRemaining;
        }

        const rateLimit = account.modelRateLimits?.[modelId];
        if (rateLimit?.isRateLimited && rateLimit.resetTime > now) {
            const waitTime = rateLimit.resetTime - now;
            if (waitTime < minWait) {
                minWait = waitTime;
            }
        }
    }

    return minWait === Infinity ? 0 : minWait;
}

/**
 * Get rate limit info for a specific account and model
 * @param {Array} accounts - Array of account objects
 * @param {string} email - Account email
 * @param {string} modelId - Model identifier
 * @returns {Object|null} Rate limit info object or null
 */
export function getRateLimitInfo(accounts, email, modelId) {
    const account = accounts?.find(a => a.email === email);
    if (!account) return null;

    return account.modelRateLimits?.[modelId] || null;
}

/**
 * Check if an account is currently cooling down
 * @param {Object} account - Account object
 * @returns {boolean} True if account is cooling down
 */
export function isAccountCoolingDown(account) {
    if (!account?.cooldownUntil) return false;
    return account.cooldownUntil > Date.now();
}

/**
 * Mark an account as cooling down
 * @param {Array} accounts - Array of account objects
 * @param {string} email - Account email
 * @param {number} cooldownMs - Cooldown duration in milliseconds
 * @param {string} reason - Reason for cooldown (from CooldownReason)
 */
export function markAccountCoolingDown(accounts, email, cooldownMs = DEFAULT_COOLDOWN_MS, reason) {
    const account = accounts?.find(a => a.email === email);
    if (!account) {
        logger.warn(`Account not found: ${email}`);
        return;
    }

    account.cooldownUntil = Date.now() + cooldownMs;
    account.cooldownReason = reason;

    logger.debug(`Account ${email} cooling down for ${cooldownMs}ms: ${reason}`);
}

/**
 * Clear cooldown status for an account
 * @param {Object} account - Account object
 */
export function clearAccountCooldown(account) {
    if (!account) return;
    account.cooldownUntil = null;
    account.cooldownReason = null;
}

/**
 * Get remaining cooldown time for an account
 * @param {Object} account - Account object
 * @returns {number} Remaining cooldown time in milliseconds, 0 if not cooling down
 */
export function getCooldownRemaining(account) {
    if (!account?.cooldownUntil) return 0;
    const remaining = account.cooldownUntil - Date.now();
    return remaining > 0 ? remaining : 0;
}

/**
 * Get consecutive failure count for an account
 * @param {Array} accounts - Array of account objects
 * @param {string} email - Account email
 * @returns {number} Consecutive failure count
 */
export function getConsecutiveFailures(accounts, email) {
    const account = accounts?.find(a => a.email === email);
    return account?.consecutiveFailures || 0;
}

/**
 * Reset consecutive failure count for an account
 * @param {Array} accounts - Array of account objects
 * @param {string} email - Account email
 */
export function resetConsecutiveFailures(accounts, email) {
    const account = accounts?.find(a => a.email === email);
    if (account) {
        account.consecutiveFailures = 0;
    }
}

/**
 * Increment consecutive failure count for an account
 * @param {Array} accounts - Array of account objects
 * @param {string} email - Account email
 * @returns {number} New failure count
 */
export function incrementConsecutiveFailures(accounts, email) {
    const account = accounts?.find(a => a.email === email);
    if (!account) {
        logger.warn(`Account not found: ${email}`);
        return 0;
    }

    if (typeof account.consecutiveFailures !== 'number') {
        account.consecutiveFailures = 0;
    }

    account.consecutiveFailures++;
    logger.debug(`Account ${email} consecutive failures: ${account.consecutiveFailures}`);
    return account.consecutiveFailures;
}
