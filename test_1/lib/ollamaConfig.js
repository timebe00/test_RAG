function getOllamaBaseUrl() {
  return process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || "http://localhost:11434";
}

module.exports = {
  getOllamaBaseUrl,
};
