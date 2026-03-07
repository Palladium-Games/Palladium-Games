// PalladiumAI: self-hosted Llama chat (Ollama or compatible API).
// If CHATBOT_API_URL is set, the built-in PalladiumAI chat is used.
// Leave CHATBOT_API_URL empty to show the setup message (or use CHATBOT_URL iframe).
// Example (Ollama default): var CHATBOT_API_URL = 'http://localhost:11434';
var CHATBOT_API_URL = 'http://localhost:11434';
// Model name (Ollama model, e.g. llama3.2, mistral, phi3).
var CHATBOT_MODEL = 'llama3.2';
// Optional: iframe URL for an external chat UI (used only when CHATBOT_API_URL is empty).
// var CHATBOT_URL = 'https://your-chat.example.com';
var CHATBOT_URL = '';
