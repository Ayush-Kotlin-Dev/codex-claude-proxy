import { isAccountCoolingDown } from '../rate-limits.js';

export class BaseStrategy {
    constructor(config, name = 'base') {
        if (this.constructor === BaseStrategy) {
            throw new Error('BaseStrategy is abstract and cannot be instantiated directly');
        }
        this.config = config;
        this.name = name;
    }

    selectAccount(accounts, modelId, options) {
        throw new Error('selectAccount must be implemented by subclass');
    }

    onSuccess(account, modelId) {}

    onRateLimit(account, modelId) {}

    onFailure(account, modelId) {}

    isAccountUsable(account, modelId) {
        if (!account) return false;
        if (account.isInvalid) return false;
        if (account.enabled === false) return false;
        if (isAccountCoolingDown(account)) return false;
        
        // Check model-specific rate limit
        if (modelId && account.modelRateLimits && account.modelRateLimits[modelId]) {
            const limit = account.modelRateLimits[modelId];
            if (limit.isRateLimited && limit.resetTime > Date.now()) {
                return false;
            }
        }
        
        return true;
    }

    getUsableAccounts(accounts, modelId) {
        const usable = [];
        for (let i = 0; i < accounts.length; i++) {
            if (this.isAccountUsable(accounts[i], modelId)) {
                usable.push({ account: accounts[i], index: i });
            }
        }
        return usable;
    }
}
