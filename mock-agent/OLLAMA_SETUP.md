# Using Ollama with the Autonomous Agent (FREE!)

This guide shows you how to use **Ollama** - a free, local LLM solution - with your autonomous agent.

## Why Ollama?

- ✅ **100% FREE** - No API costs
- ✅ **Privacy** - Runs completely locally
- ✅ **No Rate Limits** - Use as much as you want
- ✅ **Fast** - No network latency
- ✅ **Open Source** - Full control

## Quick Start

### 1. Install Ollama

**macOS/Linux**:
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

**Windows**:
Download from [ollama.com/download](https://ollama.com/download)

### 2. Start Ollama

```bash
ollama serve
```

(This runs in the background - keep it running)

### 3. Pull a Model

Choose one based on your hardware:

**For most computers** (recommended):
```bash
ollama pull llama3.2
```

**For high-end computers** (better quality):
```bash
ollama pull qwen2.5:7b
```

**For lower-end computers** (faster):
```bash
ollama pull llama3.2:1b
```

### 4. Configure Your Agent

Edit your `.env` file:

```env
USE_LLM=true
LLM_PROVIDER=ollama

# Ollama Configuration
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:latest

# Common Settings
LLM_TEMPERATURE=0.7
LLM_MAX_TOKENS=4096
```

### 5. Run Your Agent

```bash
npm run start:autonomous
```

### 6. Test LLM Connection

Open another terminal and test:

```bash
curl http://localhost:4000/test-llm
```

You should see:
```json
{
  "success": true,
  "provider": "ollama",
  "model": "llama3.2:latest",
  "testResponse": "SUCCESS",
  "responseTime": "234ms",
  "message": "LLM is working correctly! ✅"
}
```

That's it! Your agent now uses FREE local AI.

## Available Endpoints

Once running, you can check:

| Endpoint | Description |
|----------|-------------|
| `GET /` | Agent info |
| `GET /status` | Full status including LLM info |
| `GET /health` | Health check |
| `GET /test-llm` | Test LLM connectivity |

## Available Models

Popular models you can use:

| Model | Size | Best For |
|-------|------|----------|
| `llama3.2:latest` | ~2GB | General purpose (recommended) |
| `qwen2.5:7b` | ~4.7GB | Better reasoning |
| `mistral:latest` | ~4.1GB | Code generation |
| `llama3.2:1b` | ~1.3GB | Fast, lightweight |
| `codellama:latest` | ~3.8GB | Coding tasks |

See all models: [ollama.com/library](https://ollama.com/library)

## Switching Models

To switch models:

1. Pull the new model:
```bash
ollama pull qwen2.5:7b
```

2. Update `.env`:
```env
OLLAMA_MODEL=qwen2.5:7b
```

3. Restart your agent

## Troubleshooting

### Ollama not running
```
Error: Ollama not running at http://localhost:11434
```

**Solution**: Start Ollama:
```bash
ollama serve
```

### Model not found
```
Error: model 'llama3.2' not found
```

**Solution**: Pull the model first:
```bash
ollama pull llama3.2
```

### Slow responses
**Solution**: Use a smaller model:
```bash
ollama pull llama3.2:1b
```

Or upgrade your hardware 😊

## Comparing with Cloud LLMs

| Feature | Ollama | Gemini/OpenAI/Claude |
|---------|--------|----------------------|
| Cost | FREE | $$ per request |
| Speed | Fast (local) | Network dependent |
| Privacy | 100% private | Data sent to cloud |
| Rate Limits | None | Yes |
| Model Quality | Good | Excellent |
| Setup | 5 minutes | API key needed |

## Performance Tips

1. **Use GPU if available**: Ollama automatically uses GPU acceleration
2. **Close other apps**: Give Ollama more RAM
3. **Use smaller models**: If speed is critical
4. **Adjust context**: Lower `LLM_MAX_TOKENS` for faster responses

## Advanced: Multiple Models

You can run multiple models and switch based on task type:

```bash
# Pull multiple models
ollama pull llama3.2        # General tasks
ollama pull codellama       # Coding tasks
ollama pull mistral         # Fast responses
```

Then programmatically switch models based on task requirements.

## Support

- Ollama Docs: [github.com/ollama/ollama](https://github.com/ollama/ollama)
- Model Library: [ollama.com/library](https://ollama.com/library)
- Discord: [discord.gg/ollama](https://discord.gg/ollama)

---

**Enjoy FREE, local AI for your autonomous agent! 🎉**
