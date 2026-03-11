package com.palladium.backend;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Manages the lifecycle of an Ollama sidecar process for AI chat requests.
 *
 * <p>When enabled, this manager starts {@code ollama serve}, waits until the API responds,
 * and optionally ensures the configured model is available via {@code ollama pull}.</p>
 */
final class OllamaProcessManager implements AutoCloseable {
    private static final Duration HEALTH_REQUEST_TIMEOUT = Duration.ofSeconds(2);
    private static final Duration HEALTH_POLL_INTERVAL = Duration.ofMillis(350);
    private static final Duration EXTERNAL_HEALTH_TIMEOUT = Duration.ofSeconds(3);

    private final Process process;
    private final URI tagsUri;
    private final boolean managed;
    private final boolean external;

    private OllamaProcessManager(Process process, URI tagsUri, boolean managed, boolean external) {
        this.process = process;
        this.tagsUri = tagsUri;
        this.managed = managed;
        this.external = external;
    }

    /**
     * Starts Ollama when autostart is enabled in backend configuration.
     *
     * @param config backend runtime configuration
     * @return manager instance; unmanaged when autostart is disabled
     * @throws IOException when Ollama cannot be started or does not become healthy
     */
    static OllamaProcessManager startIfEnabled(PalladiumBackendApplication.Config config) throws IOException {
        if (!config.ollamaAutostart()) {
            return disabled();
        }

        URI tagsUri = tagsUri(config.ollamaBaseUrl());
        HttpClient healthClient = healthClient();
        if (waitForHealthyEndpoint(healthClient, tagsUri, EXTERNAL_HEALTH_TIMEOUT)) {
            return externallyRunning(tagsUri);
        }

        Process process = launchServeProcess(config);
        OllamaProcessManager manager = new OllamaProcessManager(process, tagsUri, true, false);
        try {
            manager.awaitHealthy(Duration.ofSeconds(config.ollamaStartupTimeoutSeconds()));
            if (config.ollamaPullModelOnStart()) {
                ensureModelAvailable(config, healthClient, tagsUri);
            }
            return manager;
        } catch (IOException startupFailure) {
            manager.close();
            throw startupFailure;
        }
    }

    /**
     * Indicates whether this manager launched Ollama as a child process.
     *
     * @return {@code true} when Ollama is managed by this instance
     */
    boolean isManaged() {
        return managed;
    }

    /**
     * Indicates whether Ollama was already running and reused by the backend.
     *
     * @return {@code true} when an external Ollama process is being used
     */
    boolean isExternal() {
        return external;
    }

    /**
     * Indicates whether the managed Ollama process is currently alive.
     *
     * @return {@code true} when process is running
     */
    boolean isRunning() {
        return process != null && process.isAlive();
    }

    /**
     * Stops the managed Ollama child process when this manager owns it.
     */
    @Override
    public void close() {
        if (!managed || process == null || !process.isAlive()) {
            return;
        }
        process.destroy();
        try {
            boolean exited = process.waitFor(4, TimeUnit.SECONDS);
            if (!exited) {
                process.destroyForcibly();
                process.waitFor(2, TimeUnit.SECONDS);
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            process.destroyForcibly();
        }
    }

    static List<String> commandForServe(String ollamaCommand) {
        String normalized = ollamaCommand == null || ollamaCommand.isBlank() ? "ollama" : ollamaCommand.trim();
        return List.of(normalized, "serve");
    }

    static List<String> commandForPull(String ollamaCommand, String model) {
        String normalized = ollamaCommand == null || ollamaCommand.isBlank() ? "ollama" : ollamaCommand.trim();
        return List.of(normalized, "pull", model);
    }

    static URI tagsUri(String baseUrl) throws IOException {
        String normalized = baseUrl == null ? "" : baseUrl.trim();
        if (normalized.isBlank()) {
            throw new IOException("ollama.base.url is blank.");
        }
        try {
            URI base = URI.create(normalized.replaceAll("/+$", ""));
            return URI.create(base.toString() + "/api/tags");
        } catch (IllegalArgumentException invalid) {
            throw new IOException("Invalid ollama.base.url: " + normalized, invalid);
        }
    }

    static boolean probeHealth(HttpClient httpClient, URI tagsUri) {
        HttpRequest request = HttpRequest.newBuilder(tagsUri)
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

    private static OllamaProcessManager disabled() {
        return new OllamaProcessManager(null, null, false, false);
    }

    private static OllamaProcessManager externallyRunning(URI tagsUri) {
        return new OllamaProcessManager(null, tagsUri, false, true);
    }

    private static Process launchServeProcess(PalladiumBackendApplication.Config config) throws IOException {
        ProcessBuilder processBuilder = new ProcessBuilder(commandForServe(config.ollamaCommand()));
        processBuilder.redirectErrorStream(true);
        processBuilder.redirectOutput(ProcessBuilder.Redirect.INHERIT);
        try {
            return processBuilder.start();
        } catch (IOException startupError) {
            throw new IOException(
                    "Failed to start Ollama using command '" + config.ollamaCommand() + "'.",
                    startupError
            );
        }
    }

    private void awaitHealthy(Duration timeout) throws IOException {
        HttpClient healthClient = healthClient();
        long deadline = System.nanoTime() + timeout.toNanos();
        while (System.nanoTime() < deadline) {
            if (!isRunning()) {
                throw new IOException("Ollama process exited before it became healthy.");
            }
            if (probeHealth(healthClient, tagsUri)) {
                return;
            }
            try {
                Thread.sleep(HEALTH_POLL_INTERVAL.toMillis());
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw new IOException("Interrupted while waiting for Ollama startup.", interrupted);
            }
        }
        throw new IOException("Ollama did not become healthy within " + timeout.toSeconds() + " seconds.");
    }

    private static void ensureModelAvailable(
            PalladiumBackendApplication.Config config,
            HttpClient httpClient,
            URI tagsUri
    ) throws IOException {
        String model = config.ollamaModel() == null ? "" : config.ollamaModel().trim();
        if (model.isBlank() || isModelPresent(httpClient, tagsUri, model)) {
            return;
        }

        ProcessBuilder processBuilder = new ProcessBuilder(commandForPull(config.ollamaCommand(), model));
        processBuilder.redirectErrorStream(true);
        processBuilder.redirectOutput(ProcessBuilder.Redirect.INHERIT);

        Process pullProcess;
        try {
            pullProcess = processBuilder.start();
        } catch (IOException startupError) {
            throw new IOException("Failed to start Ollama model pull for '" + model + "'.", startupError);
        }

        try {
            boolean finished = pullProcess.waitFor(Math.max(30, config.ollamaPullTimeoutSeconds()), TimeUnit.SECONDS);
            if (!finished) {
                pullProcess.destroyForcibly();
                throw new IOException("Ollama model pull timed out for '" + model + "'.");
            }
            if (pullProcess.exitValue() != 0) {
                throw new IOException(
                        "Ollama model pull failed for '" + model + "' with exit code " + pullProcess.exitValue() + "."
                );
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            pullProcess.destroyForcibly();
            throw new IOException("Interrupted while pulling Ollama model '" + model + "'.", interrupted);
        }
    }

    private static boolean isModelPresent(HttpClient httpClient, URI tagsUri, String model) {
        HttpRequest request = HttpRequest.newBuilder(tagsUri)
                .timeout(HEALTH_REQUEST_TIMEOUT)
                .GET()
                .build();
        try {
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                return false;
            }
            String body = response.body();
            return body.contains("\"name\":\"" + model + "\"");
        } catch (IOException | InterruptedException ignored) {
            if (ignored instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            return false;
        }
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
}
