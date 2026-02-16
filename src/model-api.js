/**
 * Model API for ChatGPT Codex
 * Handles model listing and quota retrieval from ChatGPT backend API.
 */

const CHATGPT_API_BASE = 'https://chatgpt.com/backend-api';
const CLIENT_VERSION = '0.100.0';

const MODEL_CACHE = {
    models: null,
    lastFetched: 0,
    ttlMs: 5 * 60 * 1000
};

export async function fetchModels(accessToken, accountId) {
    const now = Date.now();
    
    if (MODEL_CACHE.models && (now - MODEL_CACHE.lastFetched) < MODEL_CACHE.ttlMs) {
        return MODEL_CACHE.models;
    }
    
    const url = `${CHATGPT_API_BASE}/codex/models?client_version=${CLIENT_VERSION}`;
    
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'ChatGPT-Account-ID': accountId,
            'Accept': 'application/json'
        }
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch models: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    
    const models = (data.models || []).map(m => ({
        id: m.slug,
        name: m.display_name || m.slug,
        description: m.description || '',
        defaultReasoningLevel: m.default_reasoning_level || 'medium',
        supportedReasoningLevels: m.supported_reasoning_levels || [],
        supportedInApi: m.supported_in_api || false,
        visibility: m.visibility || 'list'
    }));
    
    MODEL_CACHE.models = models;
    MODEL_CACHE.lastFetched = now;
    
    return models;
}

export async function fetchUsage(accessToken, accountId) {
    const url = `${CHATGPT_API_BASE}/wham/usage`;
    
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'ChatGPT-Account-ID': accountId,
            'Accept': 'application/json'
        }
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch usage: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    
    const primaryWindow = data.rate_limit?.primary_window || {};
    const usedPercentRaw = Number(primaryWindow?.used_percent);
    const usedPercent = Number.isFinite(usedPercentRaw) ? usedPercentRaw : 0;

    const limitWindowSecondsRaw = Number(primaryWindow?.limit_window_seconds);
    const limitWindowSeconds = Number.isFinite(limitWindowSecondsRaw) ? limitWindowSecondsRaw : null;

    const resetAfterSecondsRaw = Number(primaryWindow?.reset_after_seconds);
    const resetAfterSeconds = Number.isFinite(resetAfterSecondsRaw) ? resetAfterSecondsRaw : null;

    const resetAtEpoch = Number(primaryWindow?.reset_at);
    const resetAt = Number.isFinite(resetAtEpoch) ? new Date(resetAtEpoch * 1000).toISOString() : null;
    
    return {
        totalTokenUsage: usedPercent,
        limit: 100,
        remaining: 100 - usedPercent,
        percentage: usedPercent,
        resetAt: resetAt,
        resetAfterSeconds: resetAfterSeconds,
        limitWindowSeconds: limitWindowSeconds,
        planType: data.plan_type || null,
        limitReached: data.rate_limit?.limit_reached || false,
        allowed: data.rate_limit?.allowed ?? true,
        raw: data
    };
}

export async function fetchAccountCheck(accessToken, accountId) {
    const url = `${CHATGPT_API_BASE}/wham/accounts/check`;
    
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'ChatGPT-Account-ID': accountId,
            'Accept': 'application/json'
        }
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch account check: ${response.status} - ${errorText}`);
    }
    
    return await response.json();
}

export async function getAccountQuota(accessToken, accountId) {
    try {
        const [usage, accountCheck] = await Promise.allSettled([
            fetchUsage(accessToken, accountId),
            fetchAccountCheck(accessToken, accountId)
        ]);
        
        const quotaInfo = {
            usage: usage.status === 'fulfilled' ? usage.value : null,
            account: accountCheck.status === 'fulfilled' ? accountCheck.value : null,
            fetchedAt: new Date().toISOString()
        };
        
        if (usage.status === 'rejected') {
            quotaInfo.usageError = usage.reason?.message || 'Unknown error';
        }
        
        if (accountCheck.status === 'rejected') {
            quotaInfo.accountError = accountCheck.reason?.message || 'Unknown error';
        }
        
        return quotaInfo;
    } catch (error) {
        return {
            usage: null,
            account: null,
            error: error.message,
            fetchedAt: new Date().toISOString()
        };
    }
}

export async function getModelsAndQuota(accessToken, accountId) {
    try {
        const [models, quota] = await Promise.all([
            fetchModels(accessToken, accountId),
            getAccountQuota(accessToken, accountId)
        ]);
        
        return {
            models,
            quota,
            success: true
        };
    } catch (error) {
        return {
            models: null,
            quota: null,
            error: error.message,
            success: false
        };
    }
}

export function clearModelCache() {
    MODEL_CACHE.models = null;
    MODEL_CACHE.lastFetched = 0;
}

export default {
    fetchModels,
    fetchUsage,
    fetchAccountCheck,
    getAccountQuota,
    getModelsAndQuota,
    clearModelCache
};
