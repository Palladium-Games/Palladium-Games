# PalladiumAI & Music

## PalladiumAI (Llama / Ollama)

The **AI Chatbot** tab uses a self-hosted Llama-style chat. The assistant is named **PalladiumAI**.

### Quick start with Ollama

1. **Install and run Ollama** (https://ollama.com). Then pull a model:

   ```bash
   ollama pull llama3.2
   ```

   Ollama runs at **http://localhost:11434** by default.

2. In this project, set **`chatbot-config.js`**:

   ```js
   var CHATBOT_API_URL = 'http://localhost:11434';
   var CHATBOT_MODEL = 'llama3.2';
   ```

3. Open the **AI Chatbot** tab and chat. The system prompt tells the model it is **PalladiumAI**, a helpful assistant for Palladium Games.

### API shape

The app calls `POST {CHATBOT_API_URL}/api/chat` with JSON:

- `model`: value of `CHATBOT_MODEL`
- `messages`: array of `{ role: "system"|"user"|"assistant", content: "..." }`
- The first message is always: `{ role: "system", content: "You are PalladiumAI, a helpful AI assistant for Palladium Games." }`

Any Ollama-compatible API (or proxy) that supports this format will work.

### If you prefer an iframe chatbot

You can point **`CHATBOT_URL`** in `chatbot-config.js` to a full-page chat app (e.g. [Vercel Chatbot](https://github.com/vercel/chatbot)); the tab will then embed it in an iframe. PalladiumAI (Ollama) is used when **`CHATBOT_API_URL`** is set; if only **`CHATBOT_URL`** is set, the iframe is shown instead.

---

## Monochrome Music Player

The **Music** tab can embed [Monochrome](https://github.com/monochrome-music/monochrome), a minimalist, self-hosted music streaming app.

### Quick start

1. **Run Monochrome** (Docker, or clone + run locally):

   ```bash
   git clone https://github.com/monochrome-music/monochrome.git
   cd monochrome
   docker compose up -d
   ```

   Then open **http://localhost:3000** (or use the [live instance](https://monochrome.tf)).

2. In this project, set **`music-config.js`**:

   ```js
   var MUSIC_URL = 'http://localhost:3000';
   // or: var MUSIC_URL = 'https://monochrome.tf';
   ```

3. Open the **Music** tab; it will load Monochrome in an iframe.

If **`MUSIC_URL`** is empty, the tab shows a short setup message and a link to the Monochrome repo.
