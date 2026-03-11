package com.palladium.backend;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Tests for {@link DiscordBotProcessManager}.
 */
class DiscordBotProcessManagerTest {
    @TempDir
    Path tempDir;

    @Test
    void commandForUsesNodeAndScript() {
        assertEquals(
                List.of("node", "discord-link-command-bot.js"),
                DiscordBotProcessManager.commandFor("node", "discord-link-command-bot.js")
        );
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

        DiscordBotProcessManager manager = DiscordBotProcessManager.startIfEnabled(config);
        assertFalse(manager.isManaged());
        assertEquals(0, manager.botCount());
        manager.close();
    }

    @Test
    void startIfEnabledCreatesBotsDirectoryEvenWhenTokensMissing() throws IOException {
        Path botsDir = tempDir.resolve("discord-bots-no-token");
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
                true,
                "npm",
                300,
                true,
                "node",
                botsDir,
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

        assertFalse(Files.exists(botsDir));
        DiscordBotProcessManager manager = DiscordBotProcessManager.startIfEnabled(config);
        assertFalse(manager.isManaged());
        assertEquals(0, manager.botCount());
        assertTrue(Files.isDirectory(botsDir));
        assertTrue(Files.isRegularFile(botsDir.resolve("discord-link-command-bot.js")));
        manager.close();
    }

    @Test
    void startIfEnabledProvisionsBotScriptsBeforeLaunchingProcess() {
        Path botsDir = tempDir.resolve("discord-bots");
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
                true,
                "npm",
                300,
                true,
                "missing-node-binary",
                botsDir,
                1,
                "https://discord.com/api/v10",
                "",
                "",
                "",
                "fake-link-token",
                "",
                "1480022214303682700",
                "1480327216826155059",
                "1480334877961355304",
                "1480324913561862184"
        );

        assertFalse(Files.exists(botsDir));
        assertThrows(IOException.class, () -> DiscordBotProcessManager.startIfEnabled(config));
        assertTrue(Files.isRegularFile(botsDir.resolve("discord-link-command-bot.js")));
        assertTrue(Files.isRegularFile(botsDir.resolve("discord-community-bot.js")));
    }
}
