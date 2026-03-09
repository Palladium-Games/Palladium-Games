// PalladiumAI: self-hosted Llama chat (Ollama or compatible API).
// If CHATBOT_API_URL is set, the built-in PalladiumAI chat is used.
// Leave CHATBOT_API_URL empty to show the setup message (or use CHATBOT_URL iframe).
// Default: use current host apps service as an Ollama proxy on port 1338.
var CHATBOT_API_URL = (function () {
  if (typeof window === "undefined" || !window.location) return "http://127.0.0.1:1338/ollama";
  var protocol = window.location.protocol || "http:";
  var hostname = window.location.hostname || "127.0.0.1";
  return protocol + "//" + hostname + ":1338/ollama";
})();
// Model name (Ollama model, e.g. qwen3.5:0.8b, qwen3.5, qwen3:8b, llama3.2).
var CHATBOT_MODEL = "qwen3.5:0.8b";
// Optional: internet search endpoint used by PalladiumAI for web context.
// Default points to the same host Palladium proxy on port 1337.
var CHATBOT_SEARCH_API_URL = (function () {
  if (typeof window === "undefined" || !window.location) return "http://127.0.0.1:1337/ai-search";
  var protocol = window.location.protocol || "http:";
  var hostname = window.location.hostname || "127.0.0.1";
  return protocol + "//" + hostname + ":1337/ai-search";
})();
// Set to false to disable web search augmentation.
var CHATBOT_ENABLE_INTERNET = true;
// Optional: iframe URL for an external chat UI (used only when CHATBOT_API_URL is empty).
// var CHATBOT_URL = "https://your-chat.example.com";
var CHATBOT_URL = "";
