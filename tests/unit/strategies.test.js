/**
 * Unit tests for src/account-rotation/strategies/
 * Tests account selection strategies.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createStrategy, DEFAULT_STRATEGY } from '../../src/account-rotation/strategies/index.js';

function createTestAccounts() {
    return [
        { email: 'account1@test.com', modelRateLimits: {} },
        { email: 'account2@test.com', modelRateLimits: {} },
        { email: 'account3@test.com', modelRateLimits: {} }
    ];
}

// ─── createStrategy ────────────────────────────────────────────────────────────────

test('createStrategy: creates sticky strategy by default', () => {
    const strategy = createStrategy();
    assert.ok(strategy !== null);
    assert.equal(strategy.name, 'sticky');
});

test('createStrategy: creates sticky strategy for sticky name', () => {
    const strategy = createStrategy('sticky');
    assert.ok(strategy !== null);
    assert.equal(strategy.name, 'sticky');
});

test('createStrategy: creates round-robin strategy', () => {
    const strategy = createStrategy('round-robin');
    assert.ok(strategy !== null);
    assert.equal(strategy.name, 'round-robin');
});

test('createStrategy: falls back to sticky for unknown strategy', () => {
    const strategy = createStrategy('unknown-strategy');
    assert.ok(strategy !== null);
    assert.equal(strategy.name, 'sticky');
});

// ─── Sticky Strategy ────────────────────────────────────────────────────────────────

test('Sticky Strategy: stays on same account when usable', () => {
    const strategy = createStrategy('sticky');
    const accounts = createTestAccounts();
    
    const result1 = strategy.selectAccount(accounts, 'gpt-5.2', { currentIndex: 0 });
    assert.equal(result1.account.email, 'account1@test.com');
    
    const result2 = strategy.selectAccount(accounts, 'gpt-5.2', { currentIndex: result1.index });
    assert.equal(result2.account.email, 'account1@test.com');
});

test('Sticky Strategy: switches when current account rate-limited', () => {
    const strategy = createStrategy('sticky');
    const accounts = createTestAccounts();
    accounts[0].modelRateLimits['gpt-5.2'] = { isRateLimited: true, resetTime: Date.now() + 60000 };
    
    const result = strategy.selectAccount(accounts, 'gpt-5.2', { currentIndex: 0 });
    // Since account1 is rate-limited, it should find account2
    assert.equal(result.account.email, 'account2@test.com');
});

test('Sticky Strategy: returns wait time when all other accounts unusable', () => {
    const strategy = createStrategy('sticky');
    const accounts = createTestAccounts();
    // All accounts except current are invalid
    accounts[1].isInvalid = true;
    accounts[2].isInvalid = true;
    
    const result = strategy.selectAccount(accounts, 'gpt-5.2', { currentIndex: 0 });
    // Should still use account1 since it's usable
    assert.equal(result.account.email, 'account1@test.com');
});

test('Sticky Strategy: returns null when all accounts unusable', () => {
    const strategy = createStrategy('sticky');
    const accounts = createTestAccounts();
    accounts[0].isInvalid = true;
    accounts[1].isInvalid = true;
    accounts[2].isInvalid = true;
    
    const result = strategy.selectAccount(accounts, 'gpt-5.2', { currentIndex: 0 });
    assert.equal(result.account, null);
});

// ─── Round-Robin Strategy ────────────────────────────────────────────────────────

test('Round-Robin Strategy: rotates through accounts', () => {
    const strategy = createStrategy('round-robin');
    const accounts = createTestAccounts();
    
    const result1 = strategy.selectAccount(accounts, 'gpt-5.2');
    assert.ok(['account1@test.com', 'account2@test.com', 'account3@test.com'].includes(result1.account.email));
    
    const result2 = strategy.selectAccount(accounts, 'gpt-5.2');
    // Should be different from result1 (rotates)
    assert.notEqual(result2.account.email, result1.account.email);
});

test('Round-Robin Strategy: skips rate-limited accounts', () => {
    const strategy = createStrategy('round-robin');
    const accounts = createTestAccounts();
    accounts[0].modelRateLimits['gpt-5.2'] = { isRateLimited: true, resetTime: Date.now() + 60000 };
    
    const result = strategy.selectAccount(accounts, 'gpt-5.2');
    // Should skip account1 and use account2 or account3
    assert.notEqual(result.account.email, 'account1@test.com');
});

test('Round-Robin Strategy: skips invalid accounts', () => {
    const strategy = createStrategy('round-robin');
    const accounts = createTestAccounts();
    accounts[0].isInvalid = true;
    
    const result = strategy.selectAccount(accounts, 'gpt-5.2');
    assert.notEqual(result.account.email, 'account1@test.com');
});

test('Round-Robin Strategy: handles single account', () => {
    const strategy = createStrategy('round-robin');
    const accounts = [{ email: 'only@test.com', modelRateLimits: {} }];
    
    const result = strategy.selectAccount(accounts, 'gpt-5.2');
    assert.equal(result.account.email, 'only@test.com');
});

test('Round-Robin Strategy: returns null when no accounts usable', () => {
    const strategy = createStrategy('round-robin');
    const accounts = createTestAccounts();
    accounts.forEach(a => { a.isInvalid = true; });
    
    const result = strategy.selectAccount(accounts, 'gpt-5.2');
    assert.equal(result.account, null);
});

// ─── isAccountUsable ─────────────────────────────────────────────────────────────

test('isAccountUsable: returns false for null account', () => {
    const strategy = createStrategy('sticky');
    const result = strategy.isAccountUsable(null, 'gpt-5.2');
    assert.equal(result, false);
});

test('isAccountUsable: returns false for invalid account', () => {
    const strategy = createStrategy('sticky');
    const result = strategy.isAccountUsable({ isInvalid: true }, 'gpt-5.2');
    assert.equal(result, false);
});

test('isAccountUsable: returns false for disabled account', () => {
    const strategy = createStrategy('sticky');
    const result = strategy.isAccountUsable({ enabled: false }, 'gpt-5.2');
    assert.equal(result, false);
});

test('isAccountUsable: returns false for rate-limited account', () => {
    const strategy = createStrategy('sticky');
    const account = {
        modelRateLimits: {
            'gpt-5.2': { isRateLimited: true, resetTime: Date.now() + 60000 }
        }
    };
    const result = strategy.isAccountUsable(account, 'gpt-5.2');
    assert.equal(result, false);
});

test('isAccountUsable: returns true for healthy account', () => {
    const strategy = createStrategy('sticky');
    const result = strategy.isAccountUsable({}, 'gpt-5.2');
    assert.equal(result, true);
});

test('isAccountUsable: returns true when rate limit expired', () => {
    const strategy = createStrategy('sticky');
    const account = {
        modelRateLimits: {
            'gpt-5.2': { isRateLimited: true, resetTime: Date.now() - 1000 }
        }
    };
    const result = strategy.isAccountUsable(account, 'gpt-5.2');
    assert.equal(result, true);
});
