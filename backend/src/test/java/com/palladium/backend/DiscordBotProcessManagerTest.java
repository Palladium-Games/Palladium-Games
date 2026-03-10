package com.palladium.backend;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

/**
 * Tests for {@link DiscordBotProcessManager}.
 */
class DiscordBotProcessManagerTest {

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
}
