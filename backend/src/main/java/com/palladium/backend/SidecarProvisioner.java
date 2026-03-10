package com.palladium.backend;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/**
 * Provisions sidecar runtime files from classpath templates.
 *
 * <p>The backend JAR embeds template files for Scramjet and Discord bots so first-run setup can
 * generate missing sidecar directories automatically.</p>
 */
final class SidecarProvisioner {
    private static final List<String> SCRAMJET_TEMPLATE_FILES = List.of(
            "server.mjs",
            "package.json",
            "package-lock.json",
            "client/index.html",
            "client/app.js",
            "client/sw.js",
            "client/scramjet.config.js",
            "vendor/mercuryworkshop-scramjet-2.0.0-alpha.tgz"
    );

    private static final List<String> DISCORD_BOT_TEMPLATE_FILES = List.of(
            "discord-gateway-presence.js",
            "discord-commit-presence.js",
            "discord-link-command-bot.js",
            "discord-community-bot.js"
    );

    private SidecarProvisioner() {
    }

    /**
     * Ensures Scramjet service files exist at the target directory.
     *
     * @param targetDir destination directory
     * @throws IOException when file extraction fails
     */
    static void ensureScramjetService(Path targetDir) throws IOException {
        Files.createDirectories(targetDir);
        for (String relativePath : SCRAMJET_TEMPLATE_FILES) {
            copyTemplateIfMissing(
                    "templates/scramjet-service/" + relativePath,
                    targetDir.resolve(relativePath)
            );
        }
    }

    /**
     * Ensures Discord bot scripts exist at the target directory.
     *
     * @param targetDir destination directory
     * @throws IOException when file extraction fails
     */
    static void ensureDiscordBots(Path targetDir) throws IOException {
        Files.createDirectories(targetDir);
        for (String relativePath : DISCORD_BOT_TEMPLATE_FILES) {
            Path output = targetDir.resolve(relativePath);
            copyTemplateIfMissing("templates/discord-bots/" + relativePath, output);
            makeExecutable(output);
        }
    }

    private static void copyTemplateIfMissing(String resourcePath, Path outputPath) throws IOException {
        if (Files.isRegularFile(outputPath)) {
            return;
        }
        Path parent = outputPath.getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }

        try (InputStream inputStream = SidecarProvisioner.class.getClassLoader().getResourceAsStream(resourcePath)) {
            if (inputStream == null) {
                throw new IOException("Missing embedded sidecar template resource: " + resourcePath);
            }
            try (OutputStream outputStream = Files.newOutputStream(outputPath)) {
                inputStream.transferTo(outputStream);
            }
        }
    }

    private static void makeExecutable(Path path) {
        try {
            path.toFile().setExecutable(true, false);
        } catch (SecurityException ignored) {
            // Non-fatal on filesystems that do not support executable mode updates.
        }
    }
}
