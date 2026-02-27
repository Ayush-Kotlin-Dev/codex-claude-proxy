# API Reference

## Main Endpoints

### Haiku Routing Settings

The `claude-haiku-4` (“Haiku”) lane can be configured to route via an alternate provider (e.g. **OpenRouter**) for supported models (e.g. **MiniMax M2.5** / **Kimi K2.5**).

```bash
GET /settings/haiku-model

# Response
{
  "success": true,
  "haikuKiloModel": "kimi-k2.5"
}
```

```bash
POST /settings/haiku-model
Content-Type: application/json

{
  "haikuKiloModel": "minimax-2.5"
}

# Response
{
  "success": true,
  "haikuKiloModel": "minimax-2.5"
}
```

### Chat Completions (OpenAI-compatible)

```bash
POST /v1/chat/completions
Content-Type: application/json

{
  "model": "gpt-5.2",
  "messages": [{"role": "user", "content": "Hello"}],
  "tools": [...],
  "stream": true
}
```

### Messages (Anthropic-compatible)

```bash
POST /v1/messages
Content-Type: application/json

{
  "model": "claude-sonnet-4-5",
  "max_tokens": 1024,
  "system": "You are helpful.",
  "messages": [{"role": "user", "content": "Hello"}],
  "tools": [...],
  "stream": true
}
```

### Models

```bash
GET /v1/models
```

### Token Counting

```bash
POST /v1/messages/count_tokens
Content-Type: application/json

{
  "messages": [...],
  "tools": [...]
}
```

## Account Management

Common endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/accounts` | GET | List all accounts |
| `/accounts/status` | GET | Get account status summary |
| `/accounts/add` | POST | Start OAuth flow (returns URL) |
| `/accounts/switch` | POST | Switch active account |
| `/accounts/models` | GET | Get models for account |
| `/accounts/quota` | GET | Get quota info |
| `/accounts/quota/all` | GET | Refresh all quotas |
| `/accounts/usage` | GET | Get usage stats |

(Additional maintenance endpoints exist for token refresh/import/removal; see the source if you need them.)

### Add Account

```bash
POST /accounts/add
Content-Type: application/json

# Optional: specify callback port
{"port": 1455}

# Response
{
  "status": "oauth_url",
  "oauth_url": "https://auth.openai.com/oauth/authorize?...",
  "state": "...",
  "callback_port": 1455
}
```

### Switch Account

```bash
POST /accounts/switch
Content-Type: application/json

{"email": "user@gmail.com"}

# Response
{"success": true, "message": "Switched to account: user@gmail.com"}
```

### OAuth Callback

```bash
GET /auth/callback?code=...&state=...
```

## Claude CLI Configuration

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/claude/config` | GET | View current config |
| `/claude/config/proxy` | POST | Configure for proxy |
| `/claude/config/direct` | POST | Configure for direct API |

### Configure Proxy Mode

```bash
POST /claude/config/proxy

# Response
{
  "success": true,
  "message": "Claude CLI configured to use proxy at http://localhost:8081",
  "config": {...}
}
```

## Health

```bash
GET /health

# Response
{
  "status": "ok",
  "total": 2,
  "active": "active@example.com",
  "accounts": [...]
}
```

## Error Responses

### Authentication Error

```json
{
  "type": "error",
  "error": {
    "type": "authentication_error",
    "message": "No active account with valid credentials"
  }
}
```

### Rate Limit Error

```json
{
  "type": "error",
  "error": {
    "type": "rate_limit_error",
    "message": "Rate limited: ..."
  }
}
```

## Streaming Events

Anthropic SSE format:

```
event: message_start
data: {"type":"message_start","message":{...}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{...}}

event: message_stop
data: {"type":"message_stop"}

data: [DONE]
```

## Tool Calling

### Request with Tools

```json
{
  "model": "claude-sonnet-4-5",
  "messages": [
    {"role": "user", "content": "What's the weather in Tokyo?"}
  ],
  "tools": [{
    "name": "get_weather",
    "description": "Get weather for a location",
    "input_schema": {
      "type": "object",
      "properties": {
        "location": {"type": "string"}
      },
      "required": ["location"]
    }
  }]
}
```

### Response with Tool Use

```json
{
  "id": "msg_...",
  "type": "message",
  "role": "assistant",
  "content": [{
    "type": "tool_use",
    "id": "toolu_...",
    "name": "get_weather",
    "input": {"location": "Tokyo"}
  }],
  "stop_reason": "tool_use"
}
```

### Tool Result

```json
{
  "messages": [
    {"role": "user", "content": "What's the weather?"},
    {"role": "assistant", "content": [{"type": "tool_use", "id": "toolu_123", "name": "get_weather", "input": {"location": "Tokyo"}}]},
    {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu_123", "content": "Sunny, 22°C"}]}
  ]
}
```