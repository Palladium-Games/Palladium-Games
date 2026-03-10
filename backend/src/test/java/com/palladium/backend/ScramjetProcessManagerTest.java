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
 * Tests for {@link ScramjetProcessManager}.
 */
class ScramjetProcessManagerTest {

    @Test
    void commandForUsesNodeAndServerEntry() {
        List<String> command = ScramjetProcessManager.commandFor("node");
        assertEquals(List.of("node", "server.mjs"), command);
    }

    @Test
    void healthHostMapsWildcardToLoopback() {
        assertEquals("127.0.0.1", ScramjetProcessManager.healthHost("0.0.0.0"));
        assertEquals("127.0.0.1", ScramjetProcessManager.healthHost("::"));
        assertEquals("127.0.0.1", ScramjetProcessManager.healthHost(""));
        assertEquals("192.168.1.10", ScramjetProcessManager.healthHost("192.168.1.10"));
    }

    @Test
    void probeHealthReturnsTrueForHealthyEndpoint() throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/health", exchange -> {
            byte[] payload = "{\"ok\":true}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, payload.length);
            exchange.getResponseBody().write(payload);
            exchange.close();
        });
        server.start();

        try {
            URI healthUri = URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/health");
            HttpClient client = HttpClient.newHttpClient();
            assertTrue(ScramjetProcessManager.probeHealth(client, healthUri));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void startIfEnabledReturnsUnmanagedWhenAutostartDisabled() throws IOException {
        PalladiumBackendApplication.Config config = new PalladiumBackendApplication.Config(
                "0.0.0.0",
                8080,
                "*",
                Path.of("../frontend"),
                Path.of("../games"),
                "http://127.0.0.1:11434",
                "qwen3.5:0.8b",
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

        ScramjetProcessManager manager = ScramjetProcessManager.startIfEnabled(config);
        assertFalse(manager.isManaged());
        assertFalse(manager.isRunning());
        manager.close();
    }

    @Test
    void startIfEnabledFailsWhenServiceDirectoryDoesNotExist() {
        PalladiumBackendApplication.Config config = new PalladiumBackendApplication.Config(
                "0.0.0.0",
                8080,
                "*",
                Path.of("../frontend"),
                Path.of("../games"),
                "http://127.0.0.1:11434",
                "qwen3.5:0.8b",
                25,
                false,
                true,
                true,
                60,
                120,
                30,
                131072,
                true,
                "node",
                Path.of("./does-not-exist"),
                "0.0.0.0",
                1337,
                20,
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

        assertThrows(IOException.class, () -> ScramjetProcessManager.startIfEnabled(config));
    }

    @Test
    void startIfEnabledReusesExistingHealthyScramjet() throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/health", exchange -> {
            byte[] payload = "{\"ok\":true}".getBytes(StandardCharsets.UTF_8);
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
                    "http://127.0.0.1:11434",
                    "qwen3.5:0.8b",
                    25,
                    false,
                    true,
                    true,
                    60,
                    120,
                    30,
                    131072,
                    true,
                    "node",
                    Path.of("./does-not-exist"),
                    "127.0.0.1",
                    port,
                    20,
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

            ScramjetProcessManager manager = ScramjetProcessManager.startIfEnabled(config);
            assertFalse(manager.isManaged());
            assertTrue(manager.isExternal());
            manager.close();
        } finally {
            server.stop(0);
        }
    }
}
