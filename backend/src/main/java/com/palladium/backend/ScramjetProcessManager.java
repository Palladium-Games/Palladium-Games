package com.palladium.backend;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.Socket;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * Manages the lifecycle of the Scramjet sidecar process used by Palladium Browse.
 *
 * <p>The backend JAR can optionally launch Scramjet during startup. This manager encapsulates process
 * launch, readiness checks, and shutdown behavior so the sidecar is started and stopped with the JVM.</p>
 */
final class ScramjetProcessManager implements AutoCloseable {
    private static final Duration HEALTH_REQUEST_TIMEOUT = Duration.ofSeconds(1);
    private static final Duration HEALTH_POLL_INTERVAL = Duration.ofMillis(300);
    private static final Duration EXTERNAL_HEALTH_TIMEOUT = Duration.ofSeconds(3);

    private final Process process;
    private final URI healthUri;
    private final boolean managed;
    private final boolean external;

    private ScramjetProcessManager(Process process, URI healthUri, boolean managed, boolean external) {
        this.process = process;
        this.healthUri = healthUri;
        this.managed = managed;
        this.external = external;
    }

    /**
     * Starts Scramjet when autostart is enabled in backend configuration.
     *
     * @param config backend runtime configuration
     * @return manager instance; unmanaged when autostart is disabled
     * @throws IOException when Scramjet cannot be started or does not become healthy
     */
    static ScramjetProcessManager startIfEnabled(PalladiumBackendApplication.Config config) throws IOException {
        if (!config.scramjetAutostart()) {
            return disabled();
        }

        URI healthUri = healthUri(config.scramjetHost(), config.scramjetPort());
        HttpClient preflightClient = healthClient();
        if (waitForHealthyEndpoint(preflightClient, healthUri, EXTERNAL_HEALTH_TIMEOUT)) {
            return externallyRunning(healthUri);
        }

        Path serviceDir = config.scramjetServiceDir().toAbsolutePath().normalize();
        SidecarProvisioner.ensureScramjetService(serviceDir);
        validateServiceDirectory(serviceDir, serviceDir.resolve("server.mjs"));
        ensureDependencies(config, serviceDir);

        Process process = launchProcess(config, serviceDir);

        ScramjetProcessManager manager = new ScramjetProcessManager(process, healthUri, true, false);
        try {
            manager.awaitHealthy(Duration.ofSeconds(config.scramjetStartupTimeoutSeconds()));
            return manager;
        } catch (IOException startupFailure) {
            String healthHost = healthHost(config.scramjetHost());
            if (
                    waitForHealthyEndpoint(preflightClient, healthUri, EXTERNAL_HEALTH_TIMEOUT)
                            || isPortOpen(healthHost, config.scramjetPort(), HEALTH_REQUEST_TIMEOUT)
            ) {
                manager.close();
                return externallyRunning(healthUri);
            }
            manager.close();
            throw startupFailure;
        }
    }

    /**
     * Indicates whether this manager launched Scramjet as a child process.
     *
     * @return {@code true} when Scramjet is managed by this instance
     */
    boolean isManaged() {
        return managed;
    }

    /**
     * Indicates whether Scramjet was already running and reused by the backend.
     *
     * @return {@code true} when an external Scramjet process is being used
     */
    boolean isExternal() {
        return external;
    }

    /**
     * Indicates whether the Scramjet child process is currently alive.
     *
     * @return {@code true} when process is running
     */
    boolean isRunning() {
        return process != null && process.isAlive();
    }

    /**
     * Stops the Scramjet child process when this manager is responsible for it.
     */
    @Override
    public void close() {
        if (!managed || process == null || !process.isAlive()) {
            return;
        }

        process.destroy();
        try {
            boolean exited = process.waitFor(3, TimeUnit.SECONDS);
            if (!exited) {
                process.destroyForcibly();
                process.waitFor(2, TimeUnit.SECONDS);
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            process.destroyForcibly();
        }
    }

    static List<String> commandFor(String nodeCommand) {
        String normalized = nodeCommand == null || nodeCommand.isBlank() ? "node" : nodeCommand.trim();
        return List.of(normalized, "server.mjs");
    }

    static String healthHost(String configuredHost) {
        String normalized = configuredHost == null ? "" : configuredHost.trim().toLowerCase(Locale.ROOT);
        if (normalized.isBlank() || "0.0.0.0".equals(normalized) || "::".equals(normalized)) {
            return "127.0.0.1";
        }
        return configuredHost.trim();
    }

    static URI healthUri(String host, int port) {
        return URI.create("http://" + healthHost(host) + ":" + port + "/health");
    }

    static boolean probeHealth(HttpClient httpClient, URI healthUri) {
        HttpRequest request = HttpRequest.newBuilder(healthUri)
                .timeout(HEALTH_REQUEST_TIMEOUT)
                .GET()
                .build();
        try {
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            return response.statusCode() == 200;
        } catch (IOException | InterruptedException ignored) {
            if (ignored instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            return false;
        }
    }

    private static ScramjetProcessManager disabled() {
        return new ScramjetProcessManager(null, null, false, false);
    }

    private static ScramjetProcessManager externallyRunning(URI healthUri) {
        return new ScramjetProcessManager(null, healthUri, false, true);
    }

    private static void validateServiceDirectory(Path serviceDir, Path entryScript) throws IOException {
        if (!Files.isDirectory(serviceDir)) {
            throw new IOException("Scramjet service directory does not exist: " + serviceDir);
        }
        if (!Files.isRegularFile(entryScript)) {
            throw new IOException("Scramjet entry script was not found: " + entryScript);
        }
    }

    private static Process launchProcess(PalladiumBackendApplication.Config config, Path serviceDir) throws IOException {
        ProcessBuilder builder = new ProcessBuilder(commandFor(config.scramjetNodeCommand()));
        builder.directory(serviceDir.toFile());
        builder.redirectErrorStream(true);
        builder.redirectOutput(ProcessBuilder.Redirect.INHERIT);

        Map<String, String> environment = builder.environment();
        environment.put("SCRAMJET_HOST", config.scramjetHost());
        environment.put("SCRAMJET_PORT", Integer.toString(config.scramjetPort()));

        try {
            return builder.start();
        } catch (IOException startupError) {
            throw new IOException(
                    "Failed to start Scramjet using command '" + config.scramjetNodeCommand() + "' in " + serviceDir,
                    startupError
            );
        }
    }

    private static void ensureDependencies(PalladiumBackendApplication.Config config, Path serviceDir) throws IOException {
        if (!config.scramjetInstallDependencies()) {
            return;
        }
        if (Files.isDirectory(serviceDir.resolve("node_modules"))) {
            return;
        }

        ProcessBuilder builder = new ProcessBuilder(npmInstallCommand(config.scramjetNpmCommand()));
        builder.directory(serviceDir.toFile());
        builder.redirectErrorStream(true);
        builder.redirectOutput(ProcessBuilder.Redirect.INHERIT);
        builder.environment().put("NPM_CONFIG_CACHE", serviceDir.resolve(".npm-cache").toString());

        Process process;
        try {
            process = builder.start();
        } catch (IOException startupError) {
            throw new IOException(
                    "Failed to start npm install using command '" + config.scramjetNpmCommand() + "' in " + serviceDir,
                    startupError
            );
        }

        try {
            boolean finished = process.waitFor(
                    Math.max(10, config.scramjetInstallTimeoutSeconds()),
                    TimeUnit.SECONDS
            );
            if (!finished) {
                process.destroyForcibly();
                throw new IOException("Scramjet dependency install timed out.");
            }
            if (process.exitValue() != 0) {
                throw new IOException("Scramjet dependency install failed with exit code " + process.exitValue() + ".");
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            process.destroyForcibly();
            throw new IOException("Interrupted while installing Scramjet dependencies.", interrupted);
        }
    }

    static List<String> npmInstallCommand(String npmCommand) {
        String normalized = npmCommand == null || npmCommand.isBlank() ? "npm" : npmCommand.trim();
        return List.of(normalized, "install", "--omit=dev", "--no-audit");
    }

    private void awaitHealthy(Duration timeout) throws IOException {
        HttpClient healthClient = healthClient();

        long deadline = System.nanoTime() + timeout.toNanos();
        while (System.nanoTime() < deadline) {
            if (!isRunning()) {
                throw new IOException("Scramjet process exited before it became healthy.");
            }
            if (probeHealth(healthClient, healthUri)) {
                return;
            }
            try {
                Thread.sleep(HEALTH_POLL_INTERVAL.toMillis());
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw new IOException("Interrupted while waiting for Scramjet startup.", interrupted);
            }
        }
        throw new IOException("Scramjet did not become healthy within " + timeout.toSeconds() + " seconds.");
    }

    private static HttpClient healthClient() {
        return HttpClient.newBuilder()
                .connectTimeout(HEALTH_REQUEST_TIMEOUT)
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
    }

    private static boolean waitForHealthyEndpoint(HttpClient client, URI uri, Duration timeout) {
        long deadline = System.nanoTime() + timeout.toNanos();
        while (System.nanoTime() < deadline) {
            if (probeHealth(client, uri)) {
                return true;
            }
            try {
                Thread.sleep(Math.min(HEALTH_POLL_INTERVAL.toMillis(), 250));
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        return false;
    }

    private static boolean isPortOpen(String host, int port, Duration timeout) {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, port), Math.toIntExact(timeout.toMillis()));
            return true;
        } catch (IOException ignored) {
            return false;
        }
    }
}
