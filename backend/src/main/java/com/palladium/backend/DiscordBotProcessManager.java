package com.palladium.backend;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * Manages Discord bot sidecar processes launched by the backend JAR.
 *
 * <p>When enabled, this manager starts bot scripts from {@code backend/discord-bots} using Node.js,
 * keeps their output attached to the backend process logs, and shuts them down during JVM shutdown.</p>
 */
final class DiscordBotProcessManager implements AutoCloseable {
    private static final String COMMIT_SCRIPT = "discord-commit-presence.js";
    private static final String LINK_SCRIPT = "discord-link-command-bot.js";
    private static final String COMMUNITY_SCRIPT = "discord-community-bot.js";

    private final Map<String, Process> processes;
    private final boolean managed;
    private final String message;

    private DiscordBotProcessManager(Map<String, Process> processes, boolean managed, String message) {
        this.processes = processes;
        this.managed = managed;
        this.message = message;
    }

    /**
     * Starts enabled Discord bots using configured tokens and channels.
     *
     * @param config backend runtime configuration
     * @return manager instance, unmanaged when bot autostart is disabled or no tokens are configured
     * @throws IOException when startup of a configured bot fails
     */
    static DiscordBotProcessManager startIfEnabled(PalladiumBackendApplication.Config config) throws IOException {
        if (!config.discordBotsAutostart()) {
            return disabled("Discord bot autostart is disabled.");
        }

        Path botsDir = config.discordBotsDir().toAbsolutePath().normalize();
        SidecarProvisioner.ensureDiscordBots(botsDir);
        validateBotsDirectory(botsDir);

        if (allBotTokensBlank(config)) {
            return disabled("Discord bot tokens are not configured.");
        }

        Map<String, Process> started = new LinkedHashMap<>();
        try {
            if (!config.discordCommitBotToken().isBlank()) {
                started.put("commit", startCommitBot(config, botsDir));
            }
            if (!config.discordLinkBotToken().isBlank()) {
                started.put("links", startLinkBot(config, botsDir));
            }
            if (!config.discordCommunityBotToken().isBlank()) {
                started.put("community", startCommunityBot(config, botsDir));
            }

            if (started.isEmpty()) {
                return disabled("No Discord bots were started because tokens are missing.");
            }

            return new DiscordBotProcessManager(started, true, "Discord bots started.");
        } catch (IOException startupFailure) {
            stopAll(started);
            throw startupFailure;
        }
    }

    /**
     * Indicates whether bot processes are managed by this instance.
     *
     * @return {@code true} when bot processes were launched
     */
    boolean isManaged() {
        return managed;
    }

    /**
     * Human-readable startup message.
     *
     * @return summary message
     */
    String message() {
        return message;
    }

    /**
     * Returns number of tracked bot processes.
     *
     * @return process count
     */
    int botCount() {
        return processes.size();
    }

    static List<String> commandFor(String nodeCommand, String scriptName) {
        String normalizedNode = nodeCommand == null || nodeCommand.isBlank() ? "node" : nodeCommand.trim();
        return List.of(normalizedNode, scriptName);
    }

    @Override
    public void close() {
        stopAll(processes);
    }

    private static DiscordBotProcessManager disabled(String message) {
        return new DiscordBotProcessManager(Map.of(), false, message);
    }

    private static boolean allBotTokensBlank(PalladiumBackendApplication.Config config) {
        return config.discordCommitBotToken().isBlank()
                && config.discordLinkBotToken().isBlank()
                && config.discordCommunityBotToken().isBlank();
    }

    private static void validateBotsDirectory(Path botsDir) throws IOException {
        if (!Files.isDirectory(botsDir)) {
            throw new IOException("Discord bots directory does not exist: " + botsDir);
        }
    }

    private static Process startCommitBot(PalladiumBackendApplication.Config config, Path botsDir) throws IOException {
        Map<String, String> env = commonEnvironment(config);
        env.put("DISCORD_COMMIT_BOT_TOKEN", config.discordCommitBotToken());
        env.put("DISCORD_COMMIT_CHANNEL_ID", config.discordCommitChannelId());
        return launchScript(config, botsDir, COMMIT_SCRIPT, "commit", env);
    }

    private static Process startLinkBot(PalladiumBackendApplication.Config config, Path botsDir) throws IOException {
        Map<String, String> env = commonEnvironment(config);
        env.put("DISCORD_LINK_BOT_TOKEN", config.discordLinkBotToken());
        env.put("DISCORD_LINK_COMMAND_CHANNEL_IDS", config.discordLinkCommandChannelIds());
        return launchScript(config, botsDir, LINK_SCRIPT, "links", env);
    }

    private static Process startCommunityBot(PalladiumBackendApplication.Config config, Path botsDir) throws IOException {
        Map<String, String> env = commonEnvironment(config);
        env.put("DISCORD_COMMUNITY_BOT_TOKEN", config.discordCommunityBotToken());
        env.put("DISCORD_WELCOME_CHANNEL_ID", config.discordWelcomeChannelId());
        env.put("DISCORD_RULES_CHANNEL_ID", config.discordRulesChannelId());
        if (!config.discordRulesText().isBlank()) {
            env.put("DISCORD_RULES_TEXT", config.discordRulesText());
        }
        return launchScript(config, botsDir, COMMUNITY_SCRIPT, "community", env);
    }

    private static Map<String, String> commonEnvironment(PalladiumBackendApplication.Config config) {
        Map<String, String> values = new LinkedHashMap<>();
        if (!config.discordApiBaseUrl().isBlank()) {
            values.put("DISCORD_API_BASE", config.discordApiBaseUrl());
        }
        if (!config.discordGuildId().isBlank()) {
            values.put("DISCORD_GUILD_ID", config.discordGuildId());
        }
        return values;
    }

    private static Process launchScript(
            PalladiumBackendApplication.Config config,
            Path botsDir,
            String scriptName,
            String botName,
            Map<String, String> environment
    ) throws IOException {
        Path scriptPath = botsDir.resolve(scriptName);
        if (!Files.isRegularFile(scriptPath)) {
            throw new IOException("Bot script not found for " + botName + ": " + scriptPath);
        }

        ProcessBuilder processBuilder = new ProcessBuilder(commandFor(config.discordBotsNodeCommand(), scriptName));
        processBuilder.directory(botsDir.toFile());
        processBuilder.redirectErrorStream(true);
        processBuilder.redirectOutput(ProcessBuilder.Redirect.INHERIT);
        processBuilder.environment().putAll(environment);

        Process process = processBuilder.start();
        waitForStableStartup(process, botName, Duration.ofSeconds(Math.max(1, config.discordBotsStartupGraceSeconds())));
        return process;
    }

    private static void waitForStableStartup(Process process, String botName, Duration gracePeriod) throws IOException {
        try {
            boolean exited = process.waitFor(gracePeriod.toMillis(), TimeUnit.MILLISECONDS);
            if (exited) {
                int exitCode = process.exitValue();
                throw new IOException(
                        "Discord bot '" + botName + "' exited during startup (exit code " + exitCode + ")."
                );
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IOException("Interrupted while starting Discord bot '" + botName + "'.", interrupted);
        }
    }

    private static void stopAll(Map<String, Process> processMap) {
        List<Map.Entry<String, Process>> entries = new ArrayList<>(processMap.entrySet());
        for (Map.Entry<String, Process> entry : entries) {
            Process process = entry.getValue();
            if (process == null || !process.isAlive()) {
                continue;
            }
            process.destroy();
        }

        for (Map.Entry<String, Process> entry : entries) {
            Process process = entry.getValue();
            if (process == null || !process.isAlive()) {
                continue;
            }
            try {
                boolean exited = process.waitFor(2, TimeUnit.SECONDS);
                if (!exited) {
                    process.destroyForcibly();
                }
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                process.destroyForcibly();
            }
        }
    }
}
