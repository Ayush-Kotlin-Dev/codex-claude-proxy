/**
 * OpenAI/ChatGPT OAuth Module
 * Handles OAuth 2.0 with PKCE for ChatGPT authentication
 */

import crypto from 'crypto';
import http from 'http';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// OpenAI OAuth Configuration (from Codex app)
const OAUTH_CONFIG = {
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    authUrl: 'https://auth.openai.com/oauth/authorize',
    tokenUrl: 'https://auth.openai.com/oauth/token',
    logoutUrl: 'https://auth.openai.com/logout',
    userInfoUrl: 'https://api.openai.com/v1/me',
    scopes: ['openid', 'profile', 'email', 'offline_access'],
    callbackPort: 1455,
    callbackFallbackPorts: [1456, 1457, 1458, 1459, 1460],
    callbackPath: '/auth/callback'
};

// Store PKCE verifiers temporarily (in production, use proper session storage)
const pkceStore = new Map();

/**
 * Generate PKCE code verifier and challenge
 * @returns {{verifier: string, challenge: string}}
 */
function generatePKCE() {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto
        .createHash('sha256')
        .update(verifier)
        .digest('base64url');
    return { verifier, challenge };
}

/**
 * Generate random state for CSRF protection
 * @returns {string}
 */
function generateState() {
    return crypto.randomBytes(16).toString('hex');
}

/**
 * Decode JWT token without verification (for extracting claims)
 * @param {string} token - JWT token
 * @returns {object} Decoded payload
 */
function decodeJWT(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const payload = Buffer.from(parts[1], 'base64').toString('utf8');
        return JSON.parse(payload);
    } catch (e) {
        return null;
    }
}

/**
 * Extract account info from access token
 * @param {string} accessToken - JWT access token
 * @returns {{accountId: string, planType: string, userId: string, email: string}}
 */
function extractAccountInfo(accessToken) {
    const payload = decodeJWT(accessToken);
    if (!payload) return null;
    
    const authInfo = payload['https://api.openai.com/auth'] || {};
    const profileInfo = payload['https://api.openai.com/profile'] || {};
    
    return {
        accountId: authInfo.chatgpt_account_id || null,
        planType: authInfo.chatgpt_plan_type || 'free',
        userId: authInfo.chatgpt_user_id || payload.sub || null,
        email: profileInfo.email || payload.email || null,
        expiresAt: payload.exp ? payload.exp * 1000 : null
    };
}

/**
 * Get authorization URL for OAuth flow
 * @param {string} verifier - PKCE code verifier
 * @param {string} state - CSRF state
 * @param {number} port - Callback server port
 * @returns {string} Authorization URL
 */
function getAuthorizationUrl(verifier, state, port) {
    const { challenge } = generatePKCEFromVerifier(verifier);
    const redirectUri = `http://localhost:${port}${OAUTH_CONFIG.callbackPath}`;
    
    pkceStore.set(state, { verifier, port, createdAt: Date.now() });
    
    // Clean up old entries
    for (const [key, value] of pkceStore.entries()) {
        if (Date.now() - value.createdAt > 5 * 60 * 1000) {
            pkceStore.delete(key);
        }
    }
    
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: OAUTH_CONFIG.clientId,
        redirect_uri: redirectUri,
        scope: OAUTH_CONFIG.scopes.join(' '),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: state,
        id_token_add_organizations: 'true',
        codex_cli_simplified_flow: 'true',
        originator: 'codex_cli_rs',
        prompt: 'login', // Force login screen for multi-account support
        max_age: '0'      // Force re-authentication
    });
    
    const url = `${OAUTH_CONFIG.authUrl}?${params.toString()}`;
    console.log(`[OAuth] Generated Authorization URL: ${url}`);
    return url;
}

/**
 * Modern Success/Error templates for better UX
 */
function getSuccessHtml(message) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Authentication Successful</title>
            <style>
                body { font-family: 'Inter', system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                .card { background: #1e293b; padding: 3rem; border-radius: 1rem; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); text-align: center; max-width: 400px; border: 1px solid #334155; }
                .icon { font-size: 4rem; margin-bottom: 1.5rem; display: block; }
                h1 { margin: 0 0 1rem; color: #10b981; font-weight: 700; }
                p { color: #94a3b8; line-height: 1.6; font-size: 1.1rem; }
                .footer { margin-top: 2rem; font-size: 0.9rem; color: #64748b; }
            </style>
        </head>
        <body>
            <div class="card">
                <span class="icon">✅</span>
                <h1>Success!</h1>
                <p>\${message}</p>
                <div class="footer">You can close this window and return to the app.</div>
            </div>
            <script>
                if (window.opener) {
                    window.opener.postMessage({ type: 'oauth-success' }, '*');
                }
                setTimeout(() => window.close(), 3000);
            </script>
        </body>
        </html>
    `;
}

function getErrorHtml(error) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Authentication Failed</title>
            <style>
                body { font-family: 'Inter', system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                .card { background: #1e293b; padding: 3rem; border-radius: 1rem; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); text-align: center; max-width: 400px; border: 1px solid #334155; }
                .icon { font-size: 4rem; margin-bottom: 1.5rem; display: block; }
                h1 { margin: 0 0 1rem; color: #ef4444; font-weight: 700; }
                p { color: #94a3b8; line-height: 1.6; font-size: 1.1rem; }
            </style>
        </head>
        <body>
            <div class="card">
                <span class="icon">❌</span>
                <h1>Failed</h1>
                <p>Authentication could not be completed.</p>
                <div style="background: rgba(239, 68, 68, 0.1); padding: 1rem; border-radius: 0.5rem; color: #fca5a5; margin-top: 1rem; font-family: monospace; font-size: 0.9rem;">
                    \${error}
                </div>
                <p style="margin-top: 1.5rem; font-size: 0.9rem;">Please close this window and try again.</p>
            </div>
        </body>
        </html>
    `;
}

function getLogoutThenAuthUrl(verifier, state, port) {
    const authUrl = getAuthorizationUrl(verifier, state, port);
    // Note: auth.openai.com/logout doesn't always support 'continue' reliably for all users
    // prompt=login in getAuthorizationUrl is the preferred way now.
    return authUrl;
}

/**
 * Generate challenge from verifier
 * @param {string} verifier - PKCE code verifier
 * @returns {{challenge: string}}
 */
function generatePKCEFromVerifier(verifier) {
    const challenge = crypto
        .createHash('sha256')
        .update(verifier)
        .digest('base64url');
    return { challenge };
}

/**
 * Get stored PKCE data for a state
 * @param {string} state - OAuth state
 * @returns {{verifier: string, port: number}|null}
 */
function getPKCEData(state) {
    return pkceStore.get(state) || null;
}

/**
 * Attempt to bind server to a specific port
 * @param {http.Server} server - HTTP server instance
 * @param {number} port - Port to bind to
 * @param {string} host - Host to bind to
 * @returns {Promise<number>} Resolves with port on success, rejects on error
 */
function tryBindPort(server, port, host = '0.0.0.0') {
    return new Promise((resolve, reject) => {
        const onError = (err) => {
            server.removeListener('listening', onSuccess);
            reject(err);
        };
        const onSuccess = () => {
            server.removeListener('error', onError);
            resolve(port);
        };
        server.once('error', onError);
        server.once('listening', onSuccess);
        server.listen(port, host);
    });
}

/**
 * Start local callback server with port fallback and abort support
 * @param {string} expectedState - Expected state for validation
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {{promise: Promise<string>, abort: Function, getPort: Function}}
 */
function startCallbackServer(expectedState, timeoutMs = 120000) {
    let server = null;
    let timeoutId = null;
    let isAborted = false;
    let actualPort = OAUTH_CONFIG.callbackPort;
    const host = process.env.HOST || '0.0.0.0';

    const promise = new Promise(async (resolve, reject) => {
        const portsToTry = [OAUTH_CONFIG.callbackPort, ...(OAUTH_CONFIG.callbackFallbackPorts || [])];
        const errors = [];

        server = http.createServer((req, res) => {
            const url = new URL(req.url, `http://${host === '0.0.0.0' ? 'localhost' : host}:${actualPort}`);
            console.log(`[OAuth] Received request: ${req.method} ${req.url}`);

            if (url.pathname !== OAUTH_CONFIG.callbackPath && url.pathname !== '/success') {
                res.writeHead(404);
                res.end('Not found');
                return;
            }

            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');
            const error = url.searchParams.get('error');
            const idToken = url.searchParams.get('id_token');

            if (error) {
                console.error(`[OAuth] Error in callback: ${error}`);
                res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(getErrorHtml(error));
                server.close();
                reject(new Error(`OAuth error: ${error}`));
                return;
            }

            if (code) {
                console.log('[OAuth] Got authorization code');
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(getSuccessHtml('Authentication Successful! You can close this window.'));
                
                setTimeout(() => {
                    server.close();
                    clearTimeout(timeoutId);
                    resolve(code);
                }, 1000);
                return;
            }

            if (url.pathname === '/success' || idToken) {
                console.log('[OAuth] At success page');
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(getSuccessHtml('Login Successful!'));
                return;
            }

            res.writeHead(400);
            res.end('Waiting for authorization code...');
        });

        // Try ports with fallback logic (Windows EACCES fix)
        let boundSuccessfully = false;
        for (const port of portsToTry) {
            try {
                await tryBindPort(server, port, host);
                actualPort = port;
                boundSuccessfully = true;

                if (port !== OAUTH_CONFIG.callbackPort) {
                    console.log(`[OAuth] Primary port ${OAUTH_CONFIG.callbackPort} unavailable, using fallback port ${port}`);
                } else {
                    console.log(`[OAuth] Callback server listening on ${host}:${port}`);
                }
                break;
            } catch (err) {
                const errMsg = err.code === 'EACCES'
                    ? `Permission denied on port ${port}`
                    : err.code === 'EADDRINUSE'
                    ? `Port ${port} already in use`
                    : `Failed to bind port ${port}: ${err.message}`;
                errors.push(errMsg);
                console.log(`[OAuth] ${errMsg}`);
            }
        }

        if (!boundSuccessfully) {
            const isWindows = process.platform === 'win32';
            let errorMsg = `Failed to start OAuth callback server.\nTried ports: ${portsToTry.join(', ')}\n\nErrors:\n${errors.join('\n')}`;

            if (isWindows) {
                errorMsg += `\n
================== WINDOWS TROUBLESHOOTING ==================
The default port range may be reserved by Hyper-V/WSL2/Docker.

Option 1: Use a custom port
  Set OAUTH_CALLBACK_PORT=3456 in your environment

Option 2: Reset Windows NAT (run as Administrator)
  net stop winnat && net start winnat

Option 3: Check reserved port ranges
  netsh interface ipv4 show excludedportrange protocol=tcp
==============================================================`;
            } else {
                errorMsg += `\n\nTry setting a custom port via environment variable.`;
            }

            reject(new Error(errorMsg));
            return;
        }

        timeoutId = setTimeout(() => {
            if (!isAborted) {
                server.close();
                reject(new Error('OAuth callback timeout - no response received'));
            }
        }, timeoutMs);
    });

    const abort = () => {
        if (isAborted) return;
        isAborted = true;
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        if (server) {
            server.close();
            console.log('[OAuth] Callback server aborted (manual completion)');
        }
    };

    const getPort = () => actualPort;

    return { promise, abort, getPort };
}

/**
 * Exchange authorization code for tokens
 * @param {string} code - Authorization code
 * @param {string} verifier - PKCE code verifier
 * @param {number} port - Callback port used
 * @returns {Promise<{accessToken: string, refreshToken: string, idToken: string, expiresIn: number}>}
 */
async function exchangeCodeForTokens(code, verifier, port) {
    const redirectUri = `http://localhost:${port}${OAUTH_CONFIG.callbackPath}`;
    
    const response = await fetch(OAUTH_CONFIG.tokenUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: redirectUri,
            client_id: OAUTH_CONFIG.clientId,
            code_verifier: verifier
        })
    });
    
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token exchange failed: ${response.status} - ${error}`);
    }
    
    const tokens = await response.json();
    
    if (!tokens.access_token) {
        throw new Error('No access token in response');
    }
    
    return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken: tokens.id_token,
        expiresIn: tokens.expires_in
    };
}

/**
 * Refresh access token using refresh token
 * @param {string} refreshToken - OAuth refresh token
 * @returns {Promise<{accessToken: string, refreshToken: string, expiresIn: number}>}
 */
async function refreshAccessToken(refreshToken) {
    const response = await fetch(OAUTH_CONFIG.tokenUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: OAUTH_CONFIG.clientId
        })
    });
    
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token refresh failed: ${response.status} - ${error}`);
    }
    
    const tokens = await response.json();
    
    return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || refreshToken,
        idToken: tokens.id_token,
        expiresIn: tokens.expires_in
    };
}

/**
 * Open URL in default browser
 * @param {string} url - URL to open
 */
async function openBrowser(url) {
    const platform = process.platform;
    
    try {
        if (platform === 'darwin') {
            await execAsync(`open "${url}"`);
        } else if (platform === 'win32') {
            await execAsync(`start "" "${url}"`);
        } else {
            await execAsync(`xdg-open "${url}"`);
        }
    } catch (e) {
        console.log(`[OAuth] Could not open browser automatically. Please visit:\n${url}`);
    }
}

/**
 * Complete OAuth flow - returns full account info
 * @param {number} [customPort] - Optional custom port for callback
 * @returns {Promise<{email: string, accountId: string, planType: string, accessToken: string, refreshToken: string}>}
 */
async function performOAuthFlow(customPort) {
    const port = customPort || OAUTH_CONFIG.callbackPort;
    const { verifier } = generatePKCE();
    const state = generateState();
    
    // Get authorization URL
    const authUrl = getAuthorizationUrl(verifier, state, port);
    
    // Start callback server
    const { promise: callbackPromise, server } = startCallbackServer(port, state);
    
    console.log(`\n[OAuth] Starting authentication flow...`);
    console.log(`[OAuth] Callback URL: http://localhost:${port}${OAUTH_CONFIG.callbackPath}`);
    
    // Open browser
    await openBrowser(authUrl);
    
    console.log(`\n[OAuth] Waiting for authentication...`);
    console.log(`[OAuth] If browser didn't open, visit:\n${authUrl}\n`);
    
    // Wait for callback
    const code = await callbackPromise;
    console.log(`[OAuth] Received authorization code`);
    
    // Exchange code for tokens
    console.log(`[OAuth] Exchanging code for tokens...`);
    const tokens = await exchangeCodeForTokens(code, verifier, port);
    console.log(`[OAuth] Token exchange successful`);
    
    // Extract account info from access token
    const accountInfo = extractAccountInfo(tokens.accessToken);
    
    return {
        email: accountInfo?.email || 'unknown',
        accountId: accountInfo?.accountId,
        planType: accountInfo?.planType || 'free',
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        idToken: tokens.idToken,
        expiresAt: accountInfo?.expiresAt || (Date.now() + tokens.expiresIn * 1000)
    };
}

/**
 * Handle OAuth callback from web flow
 * @param {string} code - Authorization code
 * @param {string} state - OAuth state
 * @returns {Promise<{email: string, accountId: string, planType: string, accessToken: string, refreshToken: string}>}
 */
async function handleOAuthCallback(code, state) {
    const pkceData = getPKCEData(state);
    if (!pkceData) {
        throw new Error('Invalid or expired OAuth state');
    }
    
    const tokens = await exchangeCodeForTokens(code, pkceData.verifier, pkceData.port);
    const accountInfo = extractAccountInfo(tokens.accessToken);
    
    // Clean up
    pkceStore.delete(state);
    
    return {
        email: accountInfo?.email || 'unknown',
        accountId: accountInfo?.accountId,
        planType: accountInfo?.planType || 'free',
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        idToken: tokens.idToken,
        expiresAt: accountInfo?.expiresAt || (Date.now() + tokens.expiresIn * 1000)
    };
}

export function extractCodeFromInput(input) {
    if (!input || typeof input !== 'string') {
        throw new Error('No input provided');
    }

    const trimmed = input.trim();

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        try {
            const url = new URL(trimmed);
            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');
            const error = url.searchParams.get('error');

            if (error) {
                throw new Error(`OAuth error: ${error}`);
            }

            if (!code) {
                throw new Error('No authorization code found in URL');
            }

            return { code, state };
        } catch (e) {
            if (e.message.includes('OAuth error') || e.message.includes('No authorization code')) {
                throw e;
            }
            throw new Error('Invalid URL format');
        }
    }

    if (trimmed.length < 10) {
        throw new Error('Input is too short to be a valid authorization code');
    }

    return { code: trimmed, state: null };
}

export {
    OAUTH_CONFIG,
    generatePKCE,
    generateState,
    decodeJWT,
    extractAccountInfo,
    getAuthorizationUrl,
    getLogoutThenAuthUrl,
    startCallbackServer,
    exchangeCodeForTokens,
    refreshAccessToken,
    openBrowser,
    performOAuthFlow,
    handleOAuthCallback,
    getPKCEData
};

export default {
    performOAuthFlow,
    handleOAuthCallback,
    refreshAccessToken,
    extractAccountInfo,
    extractCodeFromInput
};
