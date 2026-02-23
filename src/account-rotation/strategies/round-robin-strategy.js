import { BaseStrategy } from './base-strategy.js';
import { logger } from '../../utils/logger.js';

export class RoundRobinStrategy extends BaseStrategy {
    constructor(config) {
        super(config, 'round-robin');
        this.cursor = 0;
    }

    selectAccount(accounts, modelId, options = {}) {
        if (!accounts || accounts.length === 0) {
            return { account: null, index: 0, waitMs: 0 };
        }

        // Clamp cursor
        if (this.cursor >= accounts.length) {
            this.cursor = 0;
        }

        // Start from next position after cursor
        const startIndex = (this.cursor + 1) % accounts.length;

        for (let i = 0; i < accounts.length; i++) {
            const checkIndex = (startIndex + i) % accounts.length;
            const account = accounts[checkIndex];

            if (this.isAccountUsable(account, modelId)) {
                account.lastUsed = Date.now();
                this.cursor = checkIndex;
                logger.debug(`RoundRobinStrategy: Using account at index ${checkIndex}`);
                return { account, index: checkIndex, waitMs: 0 };
            }
        }

        // No usable accounts
        return { account: null, index: this.cursor, waitMs: 0 };
    }

    resetCursor() {
        this.cursor = 0;
    }
}
