# TITANIUM / Palladium setup: Ollama + Monochrome

One-place instructions to **download and hook up** Ollama (for PalladiumAI) and Monochrome (for the Music tab).

---

## 1. Ollama (PalladiumAI chatbot)

### Install

- **macOS (Homebrew):**
  ```bash
  brew install ollama
  ```
  If you see “You have not agreed to the Xcode license”, run: `sudo xcodebuild -license accept`, then retry.
- **macOS (manual):** Download from [ollama.com](https://ollama.com) and install.
- **Linux:** See [Ollama Linux](https://github.com/ollama/ollama/blob/main/docs/linux.md).

### Run and pull model

```bash
# Start Ollama (keeps running; use Ctrl+C to stop, or run as a service).
ollama serve
# In another terminal:
ollama pull llama3.2
```

Ollama serves at **http://localhost:11434**. This project is already configured in **`chatbot-config.js`**:

- `CHATBOT_API_URL = 'http://localhost:11434'`
- `CHATBOT_MODEL = 'llama3.2'`

Open the **AI Chatbot** tab to use PalladiumAI.

---

## 2. Monochrome (Music tab)

### Option A: Use the public instance (no install)

In **`music-config.js`** set:

```js
var MUSIC_URL = 'https://monochrome.tf';
```

(Already set by default.) Open the **Music** tab.

### Option B: Self-host with Docker

```bash
git clone https://github.com/monochrome-music/monochrome.git
cd monochrome
docker compose up -d
```

Then set in **`music-config.js`**:

```js
var MUSIC_URL = 'http://localhost:3000';
```

### Option C: Run with setup script

From the TITANIUM project root:

```bash
./setup.sh
```

This script will install Ollama (if missing), pull `llama3.2`, and optionally clone and start Monochrome with Docker. See script comments for details.

---

## Summary

| Component   | Install / run                          | Config file        | Hub URL / tab   |
|------------|----------------------------------------|--------------------|------------------|
| **Ollama** | `brew install ollama` then `ollama serve` + `ollama pull llama3.2` | `chatbot-config.js` | AI Chatbot tab   |
| **Monochrome** | Use `https://monochrome.tf` or clone + `docker compose up -d` | `music-config.js`   | Music tab        |

More detail: **`CHATBOT_README.md`**.
