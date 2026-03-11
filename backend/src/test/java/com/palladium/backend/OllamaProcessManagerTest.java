package com.palladium.backend;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Tests for {@link OllamaProcessManager}.
 */
class OllamaProcessManagerTest {

    @Test
    void commandForServeUsesDefaultCommandWhenBlank() {
        assertEquals(List.of("ollama", "serve"), OllamaProcessManager.commandForServe(""));
    }

    @Test
    void commandForPullBuildsExpectedCommand() {
        assertEquals(
                List.of("ollama", "pull", "qwen3.5:0.8b"),
                OllamaProcessManager.commandForPull("ollama", "qwen3.5:0.8b")
        );
    }

    @Test
    void tagsUriBuildsFromBaseUrl() throws IOException {
        URI uri = OllamaProcessManager.tagsUri("http://127.0.0.1:11434/");
        assertEquals("http://127.0.0.1:11434/api/tags", uri.toString());
    }

    @Test
    void tagsUriRejectsBlankBaseUrl() {
        assertThrows(IOException.class, () -> OllamaProcessManager.tagsUri(" "));
    }

    @Test
    void probeHealthReturnsTrueForHealthyEndpoint() throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/tags", exchange -> {
            byte[] payload = "{\"models\":[]}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, payload.length);
            exchange.getResponseBody().write(payload);
            exchange.close();
        });
        server.start();
        try {
            URI tagsUri = URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/api/tags");
            assertTrue(OllamaProcessManager.probeHealth(HttpClient.newHttpClient(), tagsUri));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void startIfEnabledReturnsDisabledWhenAutostartOff() throws IOException {
        PalladiumBackendApplication.Config config = new PalladiumBackendApplication.Config(
                "0.0.0.0",
                8080,
                "*",
                Path.of("../frontend"),
                Path.of("../games"),
                "http://127.0.0.1:11434",
                "qwen3.5:0.8b",
                false,
                "ollama",
                45,
                false,
                600,
                25,
                false,
                true,
                true,
                60,
                120,
                30,
                131072,
                false,
                "node",
                Path.of("./scramjet-service"),
                "0.0.0.0",
                1337,
                20,
                true,
                "npm",
                300,
                false,
                "node",
                Path.of("./discord-bots"),
                5,
                "https://discord.com/api/v10",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                ""
        );

        OllamaProcessManager manager = OllamaProcessManager.startIfEnabled(config);
        assertFalse(manager.isManaged());
        assertFalse(manager.isRunning());
        assertFalse(manager.isExternal());
        manager.close();
    }

    @Test
    void startIfEnabledReusesExistingHealthyOllama() throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/tags", exchange -> {
            byte[] payload = "{\"models\":[]}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, payload.length);
            exchange.getResponseBody().write(payload);
            exchange.close();
        });
        server.start();
        try {
            int port = server.getAddress().getPort();
            PalladiumBackendApplication.Config config = new PalladiumBackendApplication.Config(
                    "0.0.0.0",
                    8080,
                    "*",
                    Path.of("../frontend"),
                    Path.of("../games"),
                    "http://127.0.0.1:" + port,
                    "qwen3.5:0.8b",
                    true,
                    "ollama",
                    45,
                    false,
                    600,
                    25,
                    false,
                    true,
                    true,
                    60,
                    120,
                    30,
                    131072,
                    false,
                    "node",
                    Path.of("./scramjet-service"),
                    "0.0.0.0",
                    1337,
                    20,
                    true,
                    "npm",
                    300,
                    false,
                    "node",
                    Path.of("./discord-bots"),
                    5,
                    "https://discord.com/api/v10",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    ""
            );

            OllamaProcessManager manager = OllamaProcessManager.startIfEnabled(config);
            assertFalse(manager.isManaged());
            assertTrue(manager.isExternal());
            manager.close();
        } finally {
            server.stop(0);
        }
    }
}
