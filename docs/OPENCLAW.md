# Using with OpenClaw

[OpenClaw](https://docs.openclaw.ai/) is an AI agent gateway. This proxy provides the Anthropic-compatible API it needs.

## Quick Integration

1.  **Add Provider** to `~/.openclaw/openclaw.json`:
    ```json
    {
      "codex-proxy": {
        "baseUrl": "http://127.0.0.1:8081",
        "apiKey": "test",
        "api": "anthropic-messages",
        "models": [
          { "id": "claude-sonnet-4-5", "name": "GPT-5.2 Codex" },
          { "id": "claude-opus-4-5", "name": "GPT-5.3 Codex" }
        ]
      }
    }
    ```
2.  **Set Primary Model**:
    ```bash
    openclaw models set codex-proxy/claude-sonnet-4-5
    ```

## Key Benefits
- **Multi-Account**: Proxy handles rate limits by switching ChatGPT accounts.
- **SSE Streaming**: Full real-time response support.
- **Tool Calling**: Native support for agentic workflows.

## Troubleshooting
- Use `127.0.0.1` instead of `localhost`.
- Verify proxy health: `curl http://127.0.0.1:8081/health`.
