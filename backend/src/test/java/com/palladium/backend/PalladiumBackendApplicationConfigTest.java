package com.palladium.backend;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Tests for {@link PalladiumBackendApplication.Config} loading behavior.
 */
class PalladiumBackendApplicationConfigTest {

    @TempDir
    Path tempDir;

    @Test
    void loadUsesScramjetDefaultsWhenUnset() throws IOException {
        Path configDir = tempDir.resolve("config");
        Files.createDirectories(configDir);
        Path configPath = configDir.resolve("backend.properties");
        Files.writeString(configPath, "", StandardCharsets.UTF_8);

        PalladiumBackendApplication.Config config = PalladiumBackendApplication.Config.load(configPath, Map.of());

        assertTrue(config.scramjetAutostart());
        assertEquals("node", config.scramjetNodeCommand());
        assertEquals(configDir.resolve("../scramjet-service").normalize(), config.scramjetServiceDir());
        assertEquals("0.0.0.0", config.scramjetHost());
        assertEquals(1337, config.scramjetPort());
        assertEquals(20, config.scramjetStartupTimeoutSeconds());
        assertTrue(config.blockPrivateProxyTargets());
        assertTrue(config.rateLimitEnabled());
        assertEquals(60, config.rateLimitWindowSeconds());
        assertEquals(120, config.rateLimitProxyRequests());
        assertEquals(30, config.rateLimitAiRequests());
        assertEquals(131072, config.aiMaxRequestBodyBytes());
    }

    @Test
    void loadAllowsEnvironmentToOverrideScramjetSettings() throws IOException {
        Path configDir = tempDir.resolve("config");
        Files.createDirectories(configDir);
        Path configPath = configDir.resolve("backend.properties");
        Files.writeString(configPath, """
                scramjet.autostart=true
                scramjet.node.command=node
                scramjet.service.dir=./scramjet-service
                scramjet.host=0.0.0.0
                scramjet.port=1337
                scramjet.startup.timeout.seconds=20
                """, StandardCharsets.UTF_8);

        Map<String, String> environment = Map.ofEntries(
                Map.entry("SCRAMJET_AUTOSTART", "false"),
                Map.entry("SCRAMJET_NODE_COMMAND", "/usr/local/bin/node"),
                Map.entry("SCRAMJET_SERVICE_DIR", "./proxy-service"),
                Map.entry("SCRAMJET_HOST", "127.0.0.1"),
                Map.entry("SCRAMJET_PORT", "1444"),
                Map.entry("SCRAMJET_STARTUP_TIMEOUT_SECONDS", "9"),
                Map.entry("SECURITY_TRUST_PROXY_HEADERS", "true"),
                Map.entry("PROXY_BLOCK_PRIVATE_NETWORK_TARGETS", "false"),
                Map.entry("SECURITY_RATE_LIMIT_ENABLED", "false"),
                Map.entry("SECURITY_RATE_LIMIT_WINDOW_SECONDS", "45"),
                Map.entry("SECURITY_RATE_LIMIT_PROXY_REQUESTS", "70"),
                Map.entry("SECURITY_RATE_LIMIT_AI_REQUESTS", "12"),
                Map.entry("AI_MAX_REQUEST_BODY_BYTES", "4096")
        );

        PalladiumBackendApplication.Config config = PalladiumBackendApplication.Config.load(configPath, environment);

        assertFalse(config.scramjetAutostart());
        assertEquals("/usr/local/bin/node", config.scramjetNodeCommand());
        assertEquals(configDir.resolve("proxy-service").normalize(), config.scramjetServiceDir());
        assertEquals("127.0.0.1", config.scramjetHost());
        assertEquals(1444, config.scramjetPort());
        assertEquals(9, config.scramjetStartupTimeoutSeconds());
        assertTrue(config.trustProxyHeaders());
        assertFalse(config.blockPrivateProxyTargets());
        assertFalse(config.rateLimitEnabled());
        assertEquals(45, config.rateLimitWindowSeconds());
        assertEquals(70, config.rateLimitProxyRequests());
        assertEquals(12, config.rateLimitAiRequests());
        assertEquals(4096, config.aiMaxRequestBodyBytes());
    }
}
