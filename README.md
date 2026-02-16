# Codex Claude Proxy

![Architecture banner](./images/f757093f-507b-4453-994e-f8275f8b07a9.png)

A local proxy server that exposes an **Anthropic-compatible API** (Claude Messages) backed by the **ChatGPT Codex backend**.

It is designed primarily for **Claude Code CLI** (Anthropic-format client) while actually executing requests against Codex.

> This project is inspired by the structure of the Antigravity Claude Proxy README, but this proxy targets **ChatGPT Codex** and does **not** implement all Antigravity features.

---

## Disclaimer (read before use)

- **Not affiliated with OpenAI or Anthropic.** This is an independent open-source project and is not endorsed by, sponsored by, or affiliated with OpenAI or Anthropic.
- “ChatGPT”, “OpenAI”, and “Codex” are trademarks of their respective owners.
- “Claude” and “Anthropic” are trademarks of Anthropic PBC.
- Software is provided **“as is”**, without warranty. You are responsible for complying with all applicable Terms of Service and Acceptable Use Policies.

### Legal

- **Not affiliated with OpenAI or Anthropic.** This is an independent open-source project and is not endorsed by, sponsored by, or affiliated with OpenAI or Anthropic.
- “ChatGPT”, “OpenAI”, and “Codex” are trademarks of their respective owners.
- “Claude” and “Anthropic” are trademarks of Anthropic PBC.
- Software is provided "as is", without warranty. You are responsible for complying with all applicable Terms of Service and Acceptable Use Policies.

---

## How it works

```
┌──────────────────┐     ┌─────────────────────┐     ┌────────────────────────────┐
│   Claude Code    │────▶│  This Proxy Server  │────▶│  ChatGPT Codex Backend API  │
│ (Anthropic API)  │     │ (Anthropic ⇄ OpenAI)│     │ (codex/responses)           │
└──────────────────┘     └─────────────────────┘     └────────────────────────────┘
```

At a high level:

1. Claude Code calls this proxy using **Anthropic Messages API** endpoints (e.g. `/v1/messages`).
2. The proxy maps the incoming “Claude model name” into a Codex model.
3. The proxy converts formats as needed and returns responses back in Anthropic-compatible shapes, including streaming and tool calls.

Notes:
- Requests are proxied to the ChatGPT Codex backend.
- The `claude-haiku-4` (“Haiku”) lane can optionally route via **OpenRouter** to **MiniMax M2.5** / **GLM-5** (depending on server configuration).

---

## Model mapping (Claude name → Codex)

This proxy accepts Claude-style model IDs (what Claude Code expects) and maps them to Codex-backed models.

| Claude Code model (input) | Codex model used | Auth required | Notes |
|---|---|---:|---|
| `claude-sonnet-4-5` | **GPT-5.2 Codex** | Yes | Default “Sonnet” lane |
| `claude-opus-4-5` | **GPT-5.3 Codex** | Yes | Default “Opus” lane |
| `claude-haiku-4` | **GPT-5.2** (fast lane) | Yes | Lightweight / fast |

---

## Features

- **Anthropic-compatible** API surface (works with Claude Code)
- **OpenAI-compatible** endpoint (`/v1/chat/completions`) for quick testing and compatibility
- **Streaming (SSE)** for both Messages and logs
- **Native tool calling support** (proxy converts tool calls between formats)
- **Multi-account ChatGPT OAuth** (switch accounts, refresh tokens, import from Codex)
- **Web Dashboard** at `/`:
  - manage accounts
  - view quota snapshots
  - quick test prompts
  - live logs stream
  - model mapping (Claude names → Codex models)

---

## Requirements

- Node.js **18+**
- A ChatGPT account authorized via OAuth

---

## Installation

```bash
# Run once (no install)
npx codex-claude-proxy@latest start

# Or install globally
npm i -g codex-claude-proxy
codex-claude-proxy start

# Or from source
git clone <repo-url>
cd codex-claude-proxy
npm install
npm start
```

## Quick start

```bash
# WebUI
open http://localhost:8081

# Health
curl http://localhost:8081/health
```

Default ports:

| Port | Purpose |
|---:|---|
| `8081` | main server (API + WebUI) |
| `1455` | OAuth callback (temporary) |

---

## Authenticate (Codex / ChatGPT)

Codex-backed routes require at least one authenticated ChatGPT account.

### Option A: Web Dashboard (recommended)

1. Start the server
2. Open `http://localhost:8081`
3. Go to Accounts and add an account via OAuth (or use the Manual mode for headless environments)

### Option B: CLI

Add an account:

```bash
# Opens browser
codex-claude-proxy accounts add

# Headless / VM (prints URL; you paste callback URL/code)
codex-claude-proxy accounts add --no-browser
```

List accounts:

```bash
codex-claude-proxy accounts list
```

(If you’re running from source, use `npm start` in one terminal and run the CLI commands in another.)

Desktop (equivalent npm script):

```bash
npm run accounts:add
```

Headless / VM (equivalent npm script):

```bash
npm run accounts:add:headless
```

### Option C: Import from Codex app

You can import an existing Codex app session via the server (see `docs/ACCOUNTS.md` for details).

```bash
curl -X POST http://localhost:8081/accounts/import
```

Details: `docs/OAUTH.md` and `docs/ACCOUNTS.md`.

---

## Configure Claude Code to use the proxy

### Automatic (recommended)

```bash
curl -X POST http://localhost:8081/claude/config/proxy
```

This updates your local Claude Code settings to point at `http://localhost:8081`.

### Manual (env vars)

```bash
export ANTHROPIC_BASE_URL=http://localhost:8081
export ANTHROPIC_API_KEY=any-key
claude
```

More details: `docs/CLAUDE_INTEGRATION.md`.

---

## API surface (high level)

- Anthropic-compatible:
  - `POST /v1/messages`
  - `GET  /v1/models`
  - `POST /v1/messages/count_tokens`

- OpenAI-compatible:
  - `POST /v1/chat/completions`

- Accounts:
  - `GET  /accounts`
  - `POST /accounts/add`
  - `POST /accounts/add/manual`
  - `POST /accounts/switch`
  - `POST /accounts/refresh`, `POST /accounts/refresh/all`

- Logs:
  - `GET /api/logs`
  - `GET /api/logs/stream?history=true`

Full reference: `docs/API.md`.

---

## Documentation

- `docs/ARCHITECTURE.md` — system overview and data flow
- `docs/API.md` — endpoints, formats, streaming
- `docs/OAUTH.md` — OAuth PKCE implementation + headless flow
- `docs/ACCOUNTS.md` — multi-account storage, switching, refresh, quota caching
- `docs/CLAUDE_INTEGRATION.md` — how to use with Claude Code
- `docs/OPENCLAW.md` — using the proxy behind OpenClaw

---

## Notes / limitations

- This project is intended for **local** or **trusted** environments.
- Some behavior differs from Antigravity proxy; this repo focuses on ChatGPT Codex routing.

---

## License

MIT
