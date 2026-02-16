# OAuth Implementation

## Configuration

```javascript
OAUTH_CONFIG = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  authUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  scopes: ['openid', 'profile', 'email', 'offline_access'],
  callbackPort: 1455,
  callbackPath: '/auth/callback'
}
```

## Authorization Methods

### Method A: WebUI (Recommended)

1. Open `http://localhost:8081` in your browser
2. Click **Add Account** → **Connect via OAuth**
3. Complete authorization in the popup

### Method B: WebUI Manual Mode (Headless)

For servers without a browser:

1. Click **Add Account** → **Manual Authorization**
2. Copy the OAuth URL
3. Open URL on another device (your local machine)
4. Complete authorization
5. Copy the callback URL or authorization code
6. Paste back in the WebUI

### Method C: CLI (Desktop)

```bash
npm run accounts:add
# Opens browser for OAuth
```

### Method D: CLI Headless Mode

```bash
npm run accounts:add:headless
# Prints URL, you paste the callback URL/code
```

### Method E: API (Headless)

```bash
# 1. Get OAuth URL and verifier
curl -X POST http://localhost:8081/accounts/add

# Response includes oauth_url, verifier, state

# 2. Open URL on another device, complete auth

# 3. Submit authorization code
curl -X POST http://localhost:8081/accounts/add/manual \
  -H "Content-Type: application/json" \
  -d '{"code":"<code_or_callback_url>","verifier":"<verifier_from_step_1>"}'
```

## PKCE Flow

### 1. Generate PKCE Challenge

```javascript
// Verifier: 32 random bytes, base64url encoded
verifier = crypto.randomBytes(32).toString('base64url')

// Challenge: SHA256 hash of verifier
challenge = sha256(verifier).base64url
```

### 2. Authorization URL

```
https://auth.openai.com/oauth/authorize?
  response_type=code
  &client_id=app_EMoamEEZ73f0CkXaXp7hrann
  &redirect_uri=http://localhost:1455/auth/callback
  &scope=openid profile email offline_access
  &code_challenge=<challenge>
  &code_challenge_method=S256
  &state=<random_state>
  &prompt=login
  &max_age=0
```

**Key parameters for multi-account:**
- `prompt=login` - Forces login screen (ignores session cookies)
- `max_age=0` - Forces re-authentication

### 3. Token Exchange

```javascript
POST https://auth.openai.com/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=<authorization_code>
&redirect_uri=http://localhost:1455/auth/callback
&client_id=app_EMoamEEZ73f0CkXaXp7hrann
&code_verifier=<verifier>
```

### 4. Token Response

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "refresh_token": "rt_WpTMn1...",
  "id_token": "eyJhbGciOiJSUzI1NiIs...",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

## JWT Claims

Decoded `access_token` payload:

```json
{
  "https://api.openai.com/auth": {
    "chatgpt_account_id": "d41e9636-...",
    "chatgpt_plan_type": "plus",
    "chatgpt_user_id": "user-..."
  },
  "https://api.openai.com/profile": {
    "email": "user@gmail.com",
    "email_verified": true
  },
  "exp": 1770886178
}
```

## Token Refresh

```javascript
POST https://auth.openai.com/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&refresh_token=<refresh_token>
&client_id=app_EMoamEEZ73f0CkXaXp7hrann
```

## Auto-Refresh

- Tokens auto-refresh every **55 minutes**
- Proactive refresh before API calls if expiring within 5 minutes
- Startup refresh 2 seconds after server start

## Web Flow vs CLI Flow

### Web Flow (WebUI)

1. `POST /accounts/add` → returns OAuth URL
2. Frontend opens popup with URL
3. User authenticates in popup
4. Browser redirects to callback
5. Server handles callback, stores tokens
6. Popup notifies parent via `postMessage`

### CLI Flow

1. `POST /accounts/add` → starts callback server on port 1455
2. Server opens browser with OAuth URL
3. User authenticates
4. Browser redirects to callback
5. Server exchanges code for tokens

## Multi-Account Support

The key to multi-account support is forcing a fresh login each time:

1. `prompt=login` - Shows login screen even if already logged in
2. `max_age=0` - Requires re-authentication
3. Each account stored with unique email as identifier

## Troubleshooting

### OAuth returns existing account

- Browser may have aggressive cookie caching
- Try manual logout: https://auth.openai.com/logout
- Clear browser cookies for auth.openai.com

### Callback timeout

- Default timeout: 2 minutes
- Ensure port 1455 is available
- Check firewall isn't blocking localhost

### Token refresh fails

- Refresh token may have expired
- Re-add the account via WebUI