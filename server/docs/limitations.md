# Pi-Dashboard Operational Boundaries & Limitations

To ensure system stability, speed, and privacy, Pi-Dashboard operates within the following parameters:

## 🛡️ Key Limitations

1. **Context & Token Windows:**
   * AI providers enforce hard token limits per request. Pi automatically optimizes and summarizes conversation history when sessions grow large.
2. **File Size Boundaries:**
   * Large binary files (videos, huge datasets > 10MB) are ignored by the AI context processor to prevent memory saturation.
3. **Execution Isolation:**
   * Workspace files are isolated to your selected project directory.
   * Background app state (`USER.md`, global `MEMORY.md`, settings) is stored securely in your user profile directory (`%APPDATA%/.pi` or `~/.pi`) and never pollutes your project code.
4. **Network & Offline Behavior:**
   * When using cloud model providers (Anthropic, OpenAI, OpenRouter), an active internet connection is required.
   * When using local model providers (Ollama, LM Studio), Pi operates 100% offline.
