# Using with OpenClaw

[OpenClaw](https://docs.openclaw.ai/) (formerly ClawdBot/Moltbot) is an AI agent gateway that connects to messaging apps like Telegram, WhatsApp, Discord, Slack, and iMessage. You can configure it to use this proxy for GPT-5 Codex models.

## What is OpenClaw?

OpenClaw acts as a bridge between messaging platforms and AI models:

```
┌──────────────┐     ┌─────────────┐     ┌─────────────────────┐     ┌──────────────┐
│  Telegram    │────▶│             │     │  Codex-Claude-Proxy │     │  ChatGPT     │
│  WhatsApp    │     │  OpenClaw   │────▶│  (Anthropic API)    │────▶│  Codex API   │
│  Discord     │     │  Gateway    │     │                     │     │              │
│  Slack       │     │             │     │                     │     │              │
│  iMessage    │     │             │     │                     │     │              │
└──────────────┘     └─────────────┘     └─────────────────────┘     └──────────────┘
```

OpenClaw expects providers to expose an Anthropic-compatible or OpenAI-compatible API, which this proxy provides.

## Prerequisites

- OpenClaw installed:
  ```bash
  npm install -g openclaw@latest
  ```
- Codex-Claude-Proxy running on port 8081 (or your configured port)
- At least one ChatGPT account linked to the proxy

## Configure OpenClaw

Edit your OpenClaw config file:
- **macOS/Linux**: `~/.openclaw/openclaw.json`
- **Windows**: `%USERPROFILE%\.openclaw\openclaw.json`

### Basic Configuration

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "codex-proxy": {
        "baseUrl": "http://127.0.0.1:8081",
        "apiKey": "test",
        "api": "anthropic-messages",
        "models": [
          {
            "id": "gpt-5.3-codex",
            "name": "GPT-5.3 Codex",
            "reasoning": true,
            "input": ["text", "image"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 200000,
            "maxTokens": 128000
          },
          {
            "id": "gpt-5.2-codex",
            "name": "GPT-5.2 Codex",
            "reasoning": true,
            "input": ["text", "image"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 200000,
            "maxTokens": 128000
          },
          {
            "id": "gpt-5.2",
            "name": "GPT-5.2",
            "reasoning": false,
            "input": ["text", "image"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 128000,
            "maxTokens": 16384
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "codex-proxy/gpt-5.2-codex",
        "fallbacks": ["codex-proxy/gpt-5.2"]
      },
      "models": {
        "codex-proxy/gpt-5.2-codex": {}
      }
    }
  }
}
```

### Using Claude Model Names (Auto-Mapped)

The proxy automatically maps Claude model names to Codex equivalents. You can use familiar names:

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "codex-proxy": {
        "baseUrl": "http://127.0.0.1:8081",
        "apiKey": "test",
        "api": "anthropic-messages",
        "models": [
          {
            "id": "claude-opus-4-5",
            "name": "Claude Opus 4.5 (GPT-5.3 Codex)",
            "reasoning": true,
            "input": ["text", "image"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 200000,
            "maxTokens": 128000
          },
          {
            "id": "claude-sonnet-4-5",
            "name": "Claude Sonnet 4.5 (GPT-5.2 Codex)",
            "reasoning": true,
            "input": ["text", "image"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 200000,
            "maxTokens": 128000
          },
          {
            "id": "claude-haiku-4",
            "name": "Claude Haiku 4 (GPT-5.2)",
            "reasoning": false,
            "input": ["text", "image"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 128000,
            "maxTokens": 16384
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "codex-proxy/claude-sonnet-4-5",
        "fallbacks": ["codex-proxy/claude-haiku-4"]
      }
    }
  }
}
```

> **Note**: The `reasoning` field indicates whether the model supports extended thinking/reasoning. Set to `true` for Codex models which excel at complex reasoning tasks.

## Model Reference

| Proxy Model | Mapped From | Best For |
|-------------|-------------|----------|
| `gpt-5.3-codex` | `claude-opus-4-5` | Most capable, complex coding tasks |
| `gpt-5.2-codex` | `claude-sonnet-4-5` | Balanced performance, recommended default |
| `gpt-5.2` | `claude-haiku-4` | Fast responses, simpler tasks |

## Start Both Services

```bash
# Terminal 1: Start the proxy
cd codex-claude-proxy
npm start

# Terminal 2: Start OpenClaw gateway
openclaw gateway
```

## Verify Configuration

```bash
# Check available models
openclaw models list

# Check gateway status
openclaw status
```

You should see models prefixed with `codex-proxy/` in the list.

## Switch Models

To change the default model:

```bash
openclaw models set codex-proxy/gpt-5.3-codex
```

Or edit the `model.primary` field in your config file.

## API Compatibility

The proxy exposes an **Anthropic Messages API** compatible interface:

| Endpoint | Description |
|----------|-------------|
| `POST /v1/messages` | Main chat endpoint |
| `GET /v1/models` | List available models |
| `POST /v1/messages/count_tokens` | Token counting |

OpenClaw's `api: "anthropic-messages"` setting tells it to use the Anthropic format, which this proxy fully supports including:
- Streaming responses (SSE)
- Tool/function calling
- Multi-turn conversations
- Image inputs
- System prompts

## Multi-Account Support

The proxy supports multiple ChatGPT accounts with automatic switching:

```bash
# Add accounts via Web UI at http://localhost:8081
# Or via CLI:
npm run accounts:add

# List accounts
curl http://localhost:8081/accounts
```

When one account hits rate limits, the proxy can automatically switch to another. This provides seamless continuity for OpenClaw users.

## Advanced Configuration

### Custom Port

If running the proxy on a different port:

```json
{
  "models": {
    "providers": {
      "codex-proxy": {
        "baseUrl": "http://127.0.0.1:3000",
        ...
      }
    }
  }
}
```

### VPS/Remote Server

When running on a VPS, bind the proxy to localhost only:

```bash
HOST=127.0.0.1 PORT=8081 npm start
```

Then use SSH port forwarding on your local machine:

```bash
ssh -L 8081:127.0.0.1:8081 user@your-vps
```

Configure OpenClaw to use the local tunnel:

```json
{
  "baseUrl": "http://127.0.0.1:8081"
}
```

### Authentication

To protect the proxy with an API key:

```bash
API_KEY=your-secret-key npm start
```

Update OpenClaw config:

```json
{
  "providers": {
    "codex-proxy": {
      "baseUrl": "http://127.0.0.1:8081",
      "apiKey": "your-secret-key",
      ...
    }
  }
}
```

## Troubleshooting

### Connection Refused

Ensure the proxy is running:
```bash
curl http://127.0.0.1:8081/health
```

### Models Not Showing

1. Verify config file is valid JSON
2. Check `mode` is set to `"merge"`
3. Restart OpenClaw after config changes:
   ```bash
   openclaw gateway restart
   ```

### Rate Limiting

If you see rate limit errors:
1. Add more ChatGPT accounts to the proxy
2. The proxy will auto-switch between accounts
3. Check `/accounts` endpoint for account status

### Use 127.0.0.1 Not localhost

Always use `127.0.0.1` instead of `localhost` in `baseUrl`:
- Avoids DNS resolution issues
- Explicitly stays on loopback interface
- Prevents accidental exposure on VPS

## Comparison: Codex Proxy vs Antigravity Proxy

| Feature | Codex-Claude-Proxy | Antigravity Proxy |
|---------|-------------------|-------------------|
| Backend API | ChatGPT Codex API | Google Cloud Code API |
| Models | GPT-5.2/5.3 Codex | Gemini 3, Claude (via Google) |
| Auth | ChatGPT OAuth | Google OAuth |
| Account Source | ChatGPT accounts | Google accounts |
| Rate Limits | ChatGPT limits | Google Cloud quotas |
| Best For | Codex-native access | Google Cloud users |

Both proxies expose the same Anthropic-compatible API, so OpenClaw configuration is nearly identical.

## Further Reading

- [OpenClaw Documentation](https://docs.openclaw.ai/)
- [OpenClaw Configuration Reference](https://docs.openclaw.ai/gateway/configuration)
- [Proxy API Reference](./API.md)
- [Account Management](./ACCOUNTS.md)
- [OAuth Setup](./OAUTH.md)
