package com.palladium.backend;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Tests for {@link SidecarProvisioner} template extraction behavior.
 */
class SidecarProvisionerTest {

    @TempDir
    Path tempDir;

    @Test
    void ensureScramjetServiceCreatesExpectedTemplateFiles() throws IOException {
        Path targetDir = tempDir.resolve("scramjet-service");
        SidecarProvisioner.ensureScramjetService(targetDir);

        assertTrue(Files.isDirectory(targetDir));
        assertTrue(Files.isRegularFile(targetDir.resolve("server.mjs")));
        assertTrue(Files.isRegularFile(targetDir.resolve("package.json")));
        assertTrue(Files.isRegularFile(targetDir.resolve("package-lock.json")));
        assertTrue(Files.isRegularFile(targetDir.resolve("client/index.html")));
        assertTrue(Files.isRegularFile(targetDir.resolve("client/app.js")));
        assertTrue(Files.isRegularFile(targetDir.resolve("vendor/mercuryworkshop-scramjet-2.0.0-alpha.tgz")));
    }

    @Test
    void ensureDiscordBotsCreatesExpectedTemplateFiles() throws IOException {
        Path targetDir = tempDir.resolve("discord-bots");
        SidecarProvisioner.ensureDiscordBots(targetDir);

        assertTrue(Files.isDirectory(targetDir));
        assertTrue(Files.isRegularFile(targetDir.resolve("discord-gateway-presence.js")));
        assertTrue(Files.isRegularFile(targetDir.resolve("discord-commit-presence.js")));
        assertTrue(Files.isRegularFile(targetDir.resolve("discord-link-command-bot.js")));
        assertTrue(Files.isRegularFile(targetDir.resolve("discord-community-bot.js")));
    }
}
