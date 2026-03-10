package com.palladium.backend;

import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.stream.Collectors;

/**
 * Palladium backend entrypoint.
 *
 * <p>This service is intentionally backend-only. Static frontend assets (HTML/CSS/images) are expected
 * to be hosted separately (for example Netlify), while this server handles dynamic concerns such as AI,
 * proxying, and bot-related configuration APIs.</p>
 */
public final class PalladiumBackendApplication {
    private PalladiumBackendApplication() {
    }

    /**
     * Starts the backend HTTP server using the configured host and port.
     *
     * @param args unused command-line arguments
     * @throws IOException when the server cannot be started
     */
    public static void main(String[] args) throws IOException {
        Config config = Config.load();
        HttpServer server = createServer(config);
        server.start();

        System.out.println("Palladium backend JAR running on http://" + config.host() + ":" + config.port());
        System.out.println("Frontend catalog directory: " + config.frontendDir().toAbsolutePath());
        System.out.println("Games directory fallback: " + config.gamesDir().toAbsolutePath());
        System.out.println("Ollama base URL: " + config.ollamaBaseUrl());
    }

    static HttpServer createServer(Config config) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress(config.host(), config.port()), 0);
        HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(config.requestTimeoutSeconds()))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();

        server.createContext("/health", new JsonHandler(config) {
            @Override
            protected String json(HttpExchange exchange) {
                return "{"
                        + "\"ok\":true,"
                        + "\"service\":\"palladium-backend\","
                        + "\"time\":\"" + escapeJson(Instant.now().toString()) + "\","
                        + "\"features\":[\"api/games\",\"api/proxy/fetch\",\"api/ai/chat\",\"discord-config\"]"
                        + "}";
            }
        });

        server.createContext("/api/games", new JsonHandler(config) {
            @Override
            protected String json(HttpExchange exchange) throws IOException {
                List<GameEntry> allGames = GameCatalogLoader.loadGames(config.frontendDir(), config.gamesDir());
                String query = queryParam(exchange.getRequestURI(), "q").trim().toLowerCase(Locale.ROOT);
                String category = queryParam(exchange.getRequestURI(), "category").trim().toLowerCase(Locale.ROOT);

                List<GameEntry> filteredGames = allGames.stream()
                        .filter(game -> matchesCategory(game, category))
                        .filter(game -> matchesQuery(game, query))
                        .toList();

                String payload = filteredGames.stream()
                        .map(PalladiumBackendApplication::gameJson)
                        .collect(Collectors.joining(","));

                String categoriesPayload = categoryCountJson(allGames);
                return "{"
                        + "\"ok\":true,"
                        + "\"count\":" + filteredGames.size() + ","
                        + "\"total\":" + allGames.size() + ","
                        + "\"categories\":[" + categoriesPayload + "],"
                        + "\"games\":[" + payload + "]"
                        + "}";
            }
        });

        server.createContext("/api/categories", new JsonHandler(config) {
            @Override
            protected String json(HttpExchange exchange) throws IOException {
                List<GameEntry> games = GameCatalogLoader.loadGames(config.frontendDir(), config.gamesDir());
                String categoriesPayload = categoryCountJson(games);
                return "{"
                        + "\"ok\":true,"
                        + "\"count\":" + GameCatalogLoader.countCategories(games).size() + ","
                        + "\"categories\":[" + categoriesPayload + "]"
                        + "}";
            }
        });

        server.createContext("/api/proxy/health", new JsonHandler(config) {
            @Override
            protected String json(HttpExchange exchange) {
                return "{\"ok\":true,\"service\":\"proxy\"}";
            }
        });

        server.createContext("/api/proxy/fetch", new ProxyFetchHandler(config, httpClient));
        server.createContext("/api/ai/chat", new AiChatProxyHandler(config, httpClient));

        server.createContext("/api/config/public", new JsonHandler(config) {
            @Override
            protected String json(HttpExchange exchange) {
                return "{"
                        + "\"ok\":true,"
                        + "\"services\":{"
                        + "\"proxy\":\"/api/proxy/fetch\","
                        + "\"aiChat\":\"/api/ai/chat\","
                        + "\"defaultAiModel\":\"" + escapeJson(config.ollamaModel()) + "\""
                        + "},"
                        + "\"discord\":{"
                        + "\"commitBotConfigured\":" + !config.discordCommitBotToken().isBlank() + ","
                        + "\"linkBotConfigured\":" + !config.discordLinkBotToken().isBlank() + ","
                        + "\"communityBotConfigured\":" + !config.discordCommunityBotToken().isBlank() + ","
                        + "\"commitChannelId\":\"" + escapeJson(config.discordCommitChannelId()) + "\","
                        + "\"linkCommandChannelIds\":\"" + escapeJson(config.discordLinkCommandChannelIds()) + "\","
                        + "\"welcomeChannelId\":\"" + escapeJson(config.discordWelcomeChannelId()) + "\","
                        + "\"rulesChannelId\":\"" + escapeJson(config.discordRulesChannelId()) + "\""
                        + "}"
                        + "}";
            }
        });

        server.createContext("/", new JsonHandler(config) {
            @Override
            protected String json(HttpExchange exchange) {
                if ("/".equals(exchange.getRequestURI().getPath())) {
                    return "{"
                            + "\"ok\":true,"
                            + "\"message\":\"Palladium backend is running\","
                            + "\"endpoints\":["
                            + "\"/health\","
                            + "\"/api/games\","
                            + "\"/api/categories\","
                            + "\"/api/proxy/health\","
                            + "\"/api/proxy/fetch?url=https%3A%2F%2Fexample.com\","
                            + "\"/api/ai/chat\","
                            + "\"/api/config/public\""
                            + "]"
                            + "}";
                }
                return "{\"ok\":false,\"error\":\"Not found\"}";
            }

            @Override
            protected int statusCode(HttpExchange exchange) {
                return "/".equals(exchange.getRequestURI().getPath()) ? 200 : 404;
            }
        });

        return server;
    }

    private static String gameJson(GameEntry game) {
        return "{"
                + "\"file\":\"" + escapeJson(game.file()) + "\","
                + "\"title\":\"" + escapeJson(game.title()) + "\","
                + "\"author\":\"" + escapeJson(game.author()) + "\","
                + "\"category\":\"" + escapeJson(game.category()) + "\","
                + "\"path\":\"" + escapeJson(game.path()) + "\","
                + "\"image\":\"" + escapeJson(game.image()) + "\","
                + "\"playerPath\":\"" + escapeJson(game.playerPath()) + "\""
                + "}";
    }

    private static boolean matchesCategory(GameEntry game, String categoryFilter) {
        if (categoryFilter.isBlank() || "all".equals(categoryFilter)) {
            return true;
        }
        return game.category().equalsIgnoreCase(categoryFilter);
    }

    private static boolean matchesQuery(GameEntry game, String query) {
        if (query.isBlank()) {
            return true;
        }
        return game.title().toLowerCase(Locale.ROOT).contains(query)
                || game.author().toLowerCase(Locale.ROOT).contains(query)
                || game.file().toLowerCase(Locale.ROOT).contains(query)
                || game.category().toLowerCase(Locale.ROOT).contains(query);
    }

    private static String categoryCountJson(List<GameEntry> games) {
        Map<String, Integer> categoryCounts = GameCatalogLoader.countCategories(games);
        return categoryCounts.entrySet().stream()
                .map(entry -> "{"
                        + "\"id\":\"" + escapeJson(entry.getKey()) + "\","
                        + "\"count\":" + entry.getValue()
                        + "}")
                .collect(Collectors.joining(","));
    }

    private static String queryParam(URI uri, String key) {
        String query = uri.getRawQuery();
        if (query == null || query.isBlank()) {
            return "";
        }

        String[] pairs = query.split("&");
        for (String pair : pairs) {
            String[] parts = pair.split("=", 2);
            String rawKey = parts.length > 0 ? URLDecoder.decode(parts[0], StandardCharsets.UTF_8) : "";
            if (!key.equals(rawKey)) {
                continue;
            }
            String rawValue = parts.length > 1 ? URLDecoder.decode(parts[1], StandardCharsets.UTF_8) : "";
            return rawValue;
        }
        return "";
    }

    private static String escapeJson(String value) {
        return value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }

    /**
     * Runtime configuration loaded from properties and environment variables.
     */
    record Config(
            String host,
            int port,
            String corsOrigin,
            Path frontendDir,
            Path gamesDir,
            String ollamaBaseUrl,
            String ollamaModel,
            int requestTimeoutSeconds,
            String discordCommitBotToken,
            String discordLinkBotToken,
            String discordCommunityBotToken,
            String discordCommitChannelId,
            String discordLinkCommandChannelIds,
            String discordWelcomeChannelId,
            String discordRulesChannelId
    ) {
        static Config load() throws IOException {
            Properties properties = new Properties();
            String configPathValue = System.getenv().getOrDefault("BACKEND_CONFIG", "config/backend.properties");
            Path configPath = Paths.get(configPathValue);
            Path configDir = configPath.toAbsolutePath().getParent();
            if (configDir == null) {
                configDir = Paths.get(".").toAbsolutePath().normalize();
            }

            if (Files.exists(configPath)) {
                try (InputStream in = Files.newInputStream(configPath)) {
                    properties.load(in);
                }
            }

            String host = readValue(properties, "server.host", "0.0.0.0");
            int port = parseInt(readValue(properties, "server.port", "8080"), 8080);
            String corsOrigin = readValue(properties, "cors.origin", "*");

            Path frontendDir = resolvePath(readValue(properties, "frontend.dir", "../frontend"), configDir);
            Path gamesDir = resolvePath(readValue(properties, "games.dir", "../games"), configDir);

            String ollamaBaseUrl = readValue(properties, "ollama.base.url", "http://127.0.0.1:11434");
            String ollamaModel = readValue(properties, "ollama.model", "qwen3.5:0.8b");
            int requestTimeoutSeconds = parseInt(readValue(properties, "request.timeout.seconds", "25"), 25);

            String commitBotToken = readValue(properties, "discord.commit.bot.token", "");
            String linkBotToken = readValue(properties, "discord.link.bot.token", "");
            String communityBotToken = readValue(properties, "discord.community.bot.token", "");
            String commitChannelId = readValue(properties, "discord.commit.channel.id", "");
            String linkCommandChannelIds = readValue(properties, "discord.link.command.channel.ids", "");
            String welcomeChannelId = readValue(properties, "discord.welcome.channel.id", "");
            String rulesChannelId = readValue(properties, "discord.rules.channel.id", "");

            return new Config(
                    host,
                    port,
                    corsOrigin,
                    frontendDir,
                    gamesDir,
                    ollamaBaseUrl,
                    ollamaModel,
                    requestTimeoutSeconds,
                    commitBotToken,
                    linkBotToken,
                    communityBotToken,
                    commitChannelId,
                    linkCommandChannelIds,
                    welcomeChannelId,
                    rulesChannelId
            );
        }

        private static String readValue(Properties properties, String key, String fallback) {
            String envKey = key.toUpperCase(Locale.ROOT).replace('.', '_');
            String fromEnv = System.getenv(envKey);
            if (fromEnv != null && !fromEnv.isBlank()) {
                return fromEnv.trim();
            }
            return properties.getProperty(key, fallback).trim();
        }

        private static int parseInt(String value, int fallback) {
            try {
                return Integer.parseInt(value);
            } catch (NumberFormatException ignored) {
                return fallback;
            }
        }

        private static Path resolvePath(String value, Path baseDir) {
            Path rawPath = Paths.get(value);
            if (rawPath.isAbsolute()) {
                return rawPath.normalize();
            }
            return baseDir.resolve(rawPath).normalize();
        }
    }

    /**
     * Base class for JSON endpoints that support GET/HEAD and preflight OPTIONS.
     */
    private abstract static class JsonHandler implements HttpHandler {
        private final Config config;

        JsonHandler(Config config) {
            this.config = config;
        }

        @Override
        public final void handle(HttpExchange exchange) throws IOException {
            String method = exchange.getRequestMethod().toUpperCase(Locale.ROOT);
            if ("OPTIONS".equals(method)) {
                sendOptions(exchange, config.corsOrigin(), "GET,HEAD,OPTIONS");
                return;
            }
            if (!"GET".equals(method) && !"HEAD".equals(method)) {
                sendPlain(exchange, 405, "Method not allowed", config.corsOrigin());
                return;
            }

            String payload = json(exchange);
            sendJson(exchange, statusCode(exchange), payload, config.corsOrigin());
        }

        protected int statusCode(HttpExchange exchange) {
            return 200;
        }

        protected abstract String json(HttpExchange exchange) throws IOException;
    }

    /**
     * HTTP proxy endpoint used by frontend code to fetch third-party content through backend.
     */
    private static final class ProxyFetchHandler implements HttpHandler {
        private final Config config;
        private final HttpClient httpClient;

        ProxyFetchHandler(Config config, HttpClient httpClient) {
            this.config = config;
            this.httpClient = httpClient;
        }

        @Override
        public void handle(HttpExchange exchange) throws IOException {
            String method = exchange.getRequestMethod().toUpperCase(Locale.ROOT);
            if ("OPTIONS".equals(method)) {
                sendOptions(exchange, config.corsOrigin(), "GET,HEAD,OPTIONS");
                return;
            }
            if (!"GET".equals(method) && !"HEAD".equals(method)) {
                sendPlain(exchange, 405, "Method not allowed", config.corsOrigin());
                return;
            }

            String url = queryParam(exchange.getRequestURI(), "url").trim();
            if (url.isBlank()) {
                sendPlain(exchange, 400, "Missing query parameter: url", config.corsOrigin());
                return;
            }

            URI target;
            try {
                target = new URI(url);
            } catch (URISyntaxException e) {
                sendPlain(exchange, 400, "Invalid url", config.corsOrigin());
                return;
            }

            String scheme = target.getScheme();
            if (scheme == null || (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme))) {
                sendPlain(exchange, 400, "Only http/https URLs are allowed", config.corsOrigin());
                return;
            }

            HttpRequest request = HttpRequest.newBuilder(target)
                    .timeout(Duration.ofSeconds(config.requestTimeoutSeconds()))
                    .header("User-Agent", "PalladiumBackend/1.0")
                    .GET()
                    .build();

            try {
                HttpResponse<byte[]> upstream = httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
                Headers headers = exchange.getResponseHeaders();
                headers.set(
                        "content-type",
                        upstream.headers().firstValue("content-type").orElse("application/octet-stream")
                );
                addCors(headers, config.corsOrigin(), "GET,HEAD,OPTIONS");

                if ("HEAD".equals(method)) {
                    exchange.sendResponseHeaders(upstream.statusCode(), -1);
                    exchange.close();
                    return;
                }

                byte[] body = upstream.body();
                exchange.sendResponseHeaders(upstream.statusCode(), body.length);
                try (OutputStream out = exchange.getResponseBody()) {
                    out.write(body);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                sendPlain(exchange, 502, "Proxy interrupted", config.corsOrigin());
            }
        }
    }

    /**
     * Pass-through AI chat handler that proxies frontend chat requests to Ollama.
     */
    private static final class AiChatProxyHandler implements HttpHandler {
        private final Config config;
        private final HttpClient httpClient;

        AiChatProxyHandler(Config config, HttpClient httpClient) {
            this.config = config;
            this.httpClient = httpClient;
        }

        @Override
        public void handle(HttpExchange exchange) throws IOException {
            String method = exchange.getRequestMethod().toUpperCase(Locale.ROOT);
            if ("OPTIONS".equals(method)) {
                sendOptions(exchange, config.corsOrigin(), "POST,OPTIONS");
                return;
            }
            if (!"POST".equals(method)) {
                sendPlain(exchange, 405, "Method not allowed", config.corsOrigin());
                return;
            }

            String rawBody = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8).trim();
            if (rawBody.isBlank()) {
                sendPlain(exchange, 400, "Request body is required", config.corsOrigin());
                return;
            }

            String payload = withDefaultModel(rawBody, config.ollamaModel());
            URI target;
            try {
                target = URI.create(config.ollamaBaseUrl().replaceAll("/+$", "") + "/api/chat");
            } catch (IllegalArgumentException ex) {
                sendPlain(exchange, 500, "Invalid ollama.base.url configuration", config.corsOrigin());
                return;
            }

            HttpRequest request = HttpRequest.newBuilder(target)
                    .timeout(Duration.ofSeconds(config.requestTimeoutSeconds()))
                    .header("content-type", "application/json")
                    .header("accept", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(payload, StandardCharsets.UTF_8))
                    .build();

            try {
                HttpResponse<byte[]> upstream = httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
                Headers headers = exchange.getResponseHeaders();
                headers.set(
                        "content-type",
                        upstream.headers().firstValue("content-type").orElse("application/json; charset=utf-8")
                );
                addCors(headers, config.corsOrigin(), "POST,OPTIONS");

                byte[] body = upstream.body();
                exchange.sendResponseHeaders(upstream.statusCode(), body.length);
                try (OutputStream out = exchange.getResponseBody()) {
                    out.write(body);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                sendPlain(exchange, 502, "AI request interrupted", config.corsOrigin());
            }
        }

        private static String withDefaultModel(String body, String defaultModel) {
            if (body.contains("\"model\"")) {
                return body;
            }
            String trimmed = body.trim();
            if (!trimmed.startsWith("{")) {
                return body;
            }
            return "{\"model\":\"" + escapeJson(defaultModel) + "\"," + trimmed.substring(1);
        }
    }

    private static void sendOptions(HttpExchange exchange, String corsOrigin, String allowMethods) throws IOException {
        Headers headers = exchange.getResponseHeaders();
        addCors(headers, corsOrigin, allowMethods);
        exchange.sendResponseHeaders(204, -1);
        exchange.close();
    }

    private static void sendJson(HttpExchange exchange, int statusCode, String payload, String corsOrigin) throws IOException {
        Headers headers = exchange.getResponseHeaders();
        headers.set("content-type", "application/json; charset=utf-8");
        addCors(headers, corsOrigin, "GET,HEAD,OPTIONS");
        if ("HEAD".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(statusCode, -1);
            exchange.close();
            return;
        }
        byte[] data = payload.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(statusCode, data.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(data);
        }
    }

    private static void sendPlain(HttpExchange exchange, int statusCode, String payload, String corsOrigin) throws IOException {
        Headers headers = exchange.getResponseHeaders();
        headers.set("content-type", "text/plain; charset=utf-8");
        addCors(headers, corsOrigin, "GET,HEAD,OPTIONS,POST");
        if ("HEAD".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(statusCode, -1);
            exchange.close();
            return;
        }
        byte[] data = payload.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(statusCode, data.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(data);
        }
    }

    private static void addCors(Headers headers, String corsOrigin, String allowMethods) {
        headers.set("access-control-allow-origin", corsOrigin);
        headers.set("access-control-allow-methods", allowMethods);
        headers.set("access-control-allow-headers", "content-type, authorization");
    }
}
