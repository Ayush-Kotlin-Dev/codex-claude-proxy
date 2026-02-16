# Claude Code Integration

## Setup

### Automatic Configuration

```bash
curl -X POST http://localhost:8081/claude/config/proxy
```

Updates `~/.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:8081",
    "ANTHROPIC_API_KEY": "any-key",
    "ANTHROPIC_MODEL": "claude-sonnet-4-5",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-5",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-4-5",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-haiku-4"
  }
}
```

### Manual Configuration

```bash
export ANTHROPIC_BASE_URL=http://localhost:8081
export ANTHROPIC_API_KEY=any-key
claude
```

## Using Claude Code

When prompted about API key:

```
Detected a custom API key in your environment
ANTHROPIC_API_KEY: any-key
Do you want to use this API key?
❯ 1. Yes          <-- Choose this
   2. No (recommended)
```

## How It Works

### Request Flow

```
Claude Code (Anthropic format)
         ↓
    Proxy Server
         ↓
  Format Conversion
         ↓
ChatGPT Backend API
         ↓
   Response Stream
         ↓
  Format Conversion
         ↓
Claude Code (Anthropic format)
```

### Format Conversion

**Anthropic → OpenAI Responses API:**

```javascript
// Anthropic request
{
  "model": "claude-sonnet-4-5",
  "system": "You are helpful.",
  "messages": [
    {"role": "user", "content": "Hello"},
    {"role": "assistant", "content": [{"type": "tool_use", "id": "t1", "name": "fn", "input": {}}]},
    {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "result"}]}
  ],
  "tools": [...]
}

// Converted to OpenAI Responses API
{
  "model": "gpt-5.2-codex",
  "instructions": "You are helpful.",
  "input": [
    {"type": "message", "role": "user", "content": "Hello"},
    {"type": "function_call", "id": "fc_t1", "call_id": "fc_t1", "name": "fn", "arguments": "{}"},
    {"type": "function_call_output", "call_id": "fc_t1", "output": "result"}
  ],
  "tools": [...],
  "store": false,
  "stream": true
}
```

**Key Conversions:**
- `system` → `instructions`
- `messages` → `input` array
- `tool_use` → `function_call` + `function_call_output` items
- Tool IDs prefixed with `fc_` for API compatibility

### Streaming Events

OpenAI Responses API → Anthropic SSE:

| OpenAI Event | Anthropic Event |
|--------------|-----------------|
| `response.output_item.added` | `message_start`, `content_block_start` |
| `response.output_text.delta` | `content_block_delta` (text_delta) |
| `response.function_call_arguments.delta` | `content_block_delta` (input_json_delta) |
| `response.completed` | `message_delta`, `message_stop` |

## Tool Calling

Works natively via OpenAI Responses API:

1. Claude Code sends tools in Anthropic format
2. Proxy converts to OpenAI function format
3. ChatGPT executes and returns function calls
4. Proxy converts back to Anthropic `tool_use` blocks
5. Claude Code processes and returns tool results

## View Configuration

```bash
curl http://localhost:8081/claude/config
```

## Revert to Direct API

```bash
curl -X POST http://localhost:8081/claude/config/direct \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"sk-ant-..."}'
```

## Troubleshooting

### Claude Code hangs

1. Check proxy health: `curl http://localhost:8081/health`
2. Verify config: `cat ~/.claude/settings.json`
3. Re-configure: `curl -X POST http://localhost:8081/claude/config/proxy`

### "No active account" error

Add an account first:

```bash
curl -X POST http://localhost:8081/accounts/import
# or use WebUI
```

### Tool calls not working

Ensure you're using the direct API mode (not CLI subprocess). Check:

```bash
curl http://localhost:8081/health
# Should show accounts with valid tokens
```