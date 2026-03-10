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

        Map<String, String> environment = Map.of(
                "SCRAMJET_AUTOSTART", "false",
                "SCRAMJET_NODE_COMMAND", "/usr/local/bin/node",
                "SCRAMJET_SERVICE_DIR", "./proxy-service",
                "SCRAMJET_HOST", "127.0.0.1",
                "SCRAMJET_PORT", "1444",
                "SCRAMJET_STARTUP_TIMEOUT_SECONDS", "9"
        );

        PalladiumBackendApplication.Config config = PalladiumBackendApplication.Config.load(configPath, environment);

        assertFalse(config.scramjetAutostart());
        assertEquals("/usr/local/bin/node", config.scramjetNodeCommand());
        assertEquals(configDir.resolve("proxy-service").normalize(), config.scramjetServiceDir());
        assertEquals("127.0.0.1", config.scramjetHost());
        assertEquals(1444, config.scramjetPort());
        assertEquals(9, config.scramjetStartupTimeoutSeconds());
    }
}
