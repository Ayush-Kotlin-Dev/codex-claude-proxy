import { BaseStrategy } from './base-strategy.js';
import { logger } from '../../utils/logger.js';

const MAX_WAIT_BEFORE_ERROR_MS = 120000;

export class StickyStrategy extends BaseStrategy {
    constructor(config) {
        super(config, 'sticky');
        this.currentIndex = 0;
    }

    selectAccount(accounts, modelId, options = {}) {
        const { currentIndex = 0, onSave } = options;

        if (!accounts || accounts.length === 0) {
            return { account: null, index: currentIndex, waitMs: 0 };
        }

        const clampedIndex = Math.max(0, Math.min(currentIndex, accounts.length - 1));
        const currentAccount = accounts[clampedIndex];

        if (this.isAccountUsable(currentAccount, modelId)) {
            currentAccount.lastUsed = Date.now();
            if (onSave) onSave();
            logger.debug(`StickyStrategy: Using sticky account at index ${clampedIndex}`);
            return { account: currentAccount, index: clampedIndex, waitMs: 0 };
        }

        // Try to find another usable account
        const usableAccounts = this.getUsableAccounts(accounts, modelId);
        
        if (usableAccounts.length > 0) {
            const nextResult = this.#pickNext(accounts, clampedIndex, modelId, onSave);
            if (nextResult) {
                this.currentIndex = nextResult.index;
                return nextResult;
            }
        }

        // Check if we should wait for the current account
        const { shouldWait, waitMs } = this.#shouldWaitForAccount(currentAccount, modelId);
        if (shouldWait && waitMs <= MAX_WAIT_BEFORE_ERROR_MS) {
            logger.debug(`StickyStrategy: Waiting ${waitMs}ms for sticky account`);
            return { account: null, index: clampedIndex, waitMs };
        }

        // No usable accounts, return null
        return { account: null, index: clampedIndex, waitMs: 0 };
    }

    #shouldWaitForAccount(account, modelId) {
        if (!account) {
            return { shouldWait: false, waitMs: 0 };
        }

        if (account.isInvalid) {
            return { shouldWait: false, waitMs: 0 };
        }

        if (account.enabled === false) {
            return { shouldWait: false, waitMs: 0 };
        }

        // Check model-specific rate limit
        if (modelId && account.modelRateLimits && account.modelRateLimits[modelId]) {
            const limit = account.modelRateLimits[modelId];
            if (limit.isRateLimited && limit.resetTime > Date.now()) {
                const waitMs = limit.resetTime - Date.now();
                if (waitMs <= MAX_WAIT_BEFORE_ERROR_MS) {
                    return { shouldWait: true, waitMs };
                }
            }
        }

        return { shouldWait: false, waitMs: 0 };
    }

    #pickNext(accounts, currentIndex, modelId, onSave) {
        const startIndex = (currentIndex + 1) % accounts.length;
        
        for (let i = 0; i < accounts.length; i++) {
            const checkIndex = (startIndex + i) % accounts.length;
            const account = accounts[checkIndex];
            
            if (checkIndex === currentIndex) continue;
            
            if (this.isAccountUsable(account, modelId)) {
                account.lastUsed = Date.now();
                if (onSave) onSave();
                logger.debug(`StickyStrategy: Switched to account at index ${checkIndex}`);
                return { account, index: checkIndex, waitMs: 0 };
            }
        }

        return null;
    }
}
