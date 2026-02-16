# OAuth Implementation

This proxy uses **OAuth 2.0 with PKCE** for secure authentication with ChatGPT.

## Quick Start
- **WebUI (Recommended)**: Open `http://localhost:8081` → **Add Account** → **Connect**.
- **Headless**: Use `codex-claude-proxy accounts add --no-browser`.

## OAuth Config
- **Client ID**: `app_EMoamEEZ73f0CkXaXp7hrann`
- **Auth URL**: `https://auth.openai.com/oauth/authorize`
- **Redirect**: `http://localhost:1455/auth/callback`

## Features
- **Auto-Refresh**: Tokens refresh every 55 minutes.
- **Multi-Account**: Uses `prompt=login` to force account switching.
- **Headless Support**: Manual code entry for servers without browsers.

## Troubleshooting
- **Existing Account**: If it keeps picking the same account, logout at `auth.openai.com` or clear cookies.
- **Port 1455**: Must be available for the CLI callback.
