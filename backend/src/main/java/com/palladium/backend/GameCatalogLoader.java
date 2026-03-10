package com.palladium.backend;

import java.io.IOException;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Loads the game catalog for backend APIs.
 *
 * <p>The loader prefers {@code frontend/games.html} because that file is the curated source
 * for title, author, image, and player links. If no usable cards are found, it falls back to
 * scanning the {@code games/} directory directly.</p>
 */
final class GameCatalogLoader {
    private static final Pattern TITLE_PATTERN = Pattern.compile("<title[^>]*>([\\s\\S]*?)</title>", Pattern.CASE_INSENSITIVE);
    private static final Pattern AUTHOR_META_PATTERN = Pattern.compile(
            "<meta[^>]+name=[\"']author[\"'][^>]+content=[\"']([^\"']+)[\"'][^>]*>",
            Pattern.CASE_INSENSITIVE
    );
    private static final Pattern A_TAG_PATTERN = Pattern.compile("<a\\s+([^>]*?)>([\\s\\S]*?)</a>", Pattern.CASE_INSENSITIVE);
    private static final Pattern CLASS_ATTR_PATTERN = Pattern.compile("\\bclass\\s*=\\s*([\"'])(.*?)\\1", Pattern.CASE_INSENSITIVE);
    private static final Pattern HREF_ATTR_PATTERN = Pattern.compile("\\bhref\\s*=\\s*([\"'])(.*?)\\1", Pattern.CASE_INSENSITIVE);
    private static final Pattern IMG_SRC_PATTERN = Pattern.compile("<img[^>]*\\bsrc\\s*=\\s*([\"'])(.*?)\\1", Pattern.CASE_INSENSITIVE);
    private static final Pattern CARD_TITLE_PATTERN = Pattern.compile(
            "<div[^>]*class=[\"'][^\"']*game-card__title[^\"']*[\"'][^>]*>([\\s\\S]*?)</div>",
            Pattern.CASE_INSENSITIVE
    );
    private static final Pattern CARD_AUTHOR_PATTERN = Pattern.compile(
            "<div[^>]*class=[\"'][^\"']*game-card__author[^\"']*[\"'][^>]*>([\\s\\S]*?)</div>",
            Pattern.CASE_INSENSITIVE
    );
    private static final Pattern TAG_PATTERN = Pattern.compile("<[^>]+>");
    private static final Pattern URL_SCHEME_PATTERN = Pattern.compile("^[a-zA-Z][a-zA-Z0-9+.-]*:");

    private GameCatalogLoader() {
    }

    /**
     * Loads games from the frontend catalog when present, otherwise from the games directory.
     *
     * @param frontendDir frontend directory that may contain {@code games.html}
     * @param gamesDir games directory containing playable HTML files
     * @return ordered game list suitable for API responses
     * @throws IOException when reading filesystem content fails
     */
    static List<GameEntry> loadGames(Path frontendDir, Path gamesDir) throws IOException {
        List<GameEntry> fromFrontend = loadFromFrontendCatalog(frontendDir, gamesDir);
        if (!fromFrontend.isEmpty()) {
            return fromFrontend;
        }
        return scanGamesDirectory(gamesDir);
    }

    /**
     * Counts games by category while preserving first-seen category ordering.
     *
     * @param games games to aggregate
     * @return map from category id to count
     */
    static Map<String, Integer> countCategories(List<GameEntry> games) {
        Map<String, Integer> categoryCounts = new LinkedHashMap<>();
        for (GameEntry game : games) {
            categoryCounts.merge(game.category(), 1, Integer::sum);
        }
        return categoryCounts;
    }

    private static List<GameEntry> loadFromFrontendCatalog(Path frontendDir, Path gamesDir) throws IOException {
        Path gamesHtml = frontendDir.resolve("games.html");
        if (!Files.isRegularFile(gamesHtml)) {
            return List.of();
        }

        String html = Files.readString(gamesHtml, StandardCharsets.UTF_8);
        Matcher anchorMatcher = A_TAG_PATTERN.matcher(html);
        List<GameEntry> games = new ArrayList<>();

        while (anchorMatcher.find()) {
            String attributes = anchorMatcher.group(1);
            String body = anchorMatcher.group(2);

            if (!hasClassToken(attributes, "game-card")) {
                continue;
            }

            String href = extractAttribute(attributes, HREF_ATTR_PATTERN).trim();
            if (href.isEmpty()) {
                continue;
            }

            String gameValue = queryParamFromHref(href, "game");
            String relativeFile = normalizeGameFile(gameValue);
            if (relativeFile.isEmpty()) {
                continue;
            }

            String title = htmlToText(extractFirstMatch(body, CARD_TITLE_PATTERN)).trim();
            if (title.isEmpty()) {
                title = queryParamFromHref(href, "title").trim();
            }
            if (title.isEmpty()) {
                title = titleFromFilename(relativeFile);
            }

            String author = htmlToText(extractFirstMatch(body, CARD_AUTHOR_PATTERN)).trim();
            if (author.isEmpty()) {
                author = queryParamFromHref(href, "author").trim();
            }
            if (author.isEmpty()) {
                author = "Unknown";
            }

            String imageSrc = extractFirstMatch(body, IMG_SRC_PATTERN);
            String imagePath = normalizeImagePath(imageSrc);

            String category = categoryFromFile(relativeFile);
            String publicPath = toFrontendGamePath(relativeFile);
            String playerPath = buildPlayerPath(relativeFile, title, author);

            games.add(new GameEntry(relativeFile, title, author, category, publicPath, imagePath, playerPath));
        }

        if (games.isEmpty()) {
            return List.of();
        }

        // Keep frontend order, but skip entries that clearly map outside the configured games tree.
        List<GameEntry> sanitized = new ArrayList<>();
        for (GameEntry game : games) {
            Path resolved = gamesDir.resolve(game.file()).normalize();
            if (!resolved.startsWith(gamesDir.normalize())) {
                continue;
            }
            sanitized.add(game);
        }
        return sanitized;
    }

    private static List<GameEntry> scanGamesDirectory(Path gamesDir) throws IOException {
        if (!Files.isDirectory(gamesDir)) {
            return List.of();
        }

        List<GameEntry> games = new ArrayList<>();
        try (Stream<Path> stream = Files.walk(gamesDir)) {
            List<Path> htmlFiles = stream
                    .filter(Files::isRegularFile)
                    .filter(path -> {
                        String name = path.getFileName().toString().toLowerCase(Locale.ROOT);
                        return name.endsWith(".html") || name.endsWith(".htm");
                    })
                    .sorted(Comparator.comparing(path -> toUnixPath(gamesDir.relativize(path).toString()).toLowerCase(Locale.ROOT)))
                    .toList();

            for (Path file : htmlFiles) {
                String relativeFile = toUnixPath(gamesDir.relativize(file).toString());
                String html = Files.readString(file, StandardCharsets.UTF_8);
                String title = extractTitle(html);
                String author = extractAuthor(html);

                String normalizedTitle = title.isBlank() ? titleFromFilename(relativeFile) : title;
                String normalizedAuthor = author.isBlank() ? "Unknown" : author;
                String category = categoryFromFile(relativeFile);
                String publicPath = toFrontendGamePath(relativeFile);
                String playerPath = buildPlayerPath(relativeFile, normalizedTitle, normalizedAuthor);

                games.add(new GameEntry(
                        relativeFile,
                        normalizedTitle,
                        normalizedAuthor,
                        category,
                        publicPath,
                        "",
                        playerPath
                ));
            }
        }
        return games;
    }

    private static String extractTitle(String html) {
        Matcher matcher = TITLE_PATTERN.matcher(html);
        if (!matcher.find()) {
            return "";
        }
        return htmlToText(matcher.group(1));
    }

    private static String extractAuthor(String html) {
        Matcher matcher = AUTHOR_META_PATTERN.matcher(html);
        if (!matcher.find()) {
            return "";
        }
        return htmlToText(matcher.group(1));
    }

    private static String titleFromFilename(String fileName) {
        String normalized = toUnixPath(fileName);
        String lastSegment = normalized.contains("/") ? normalized.substring(normalized.lastIndexOf('/') + 1) : normalized;
        String base = lastSegment.replaceFirst("\\.html?$", "");
        String[] parts = base.split("[-_]");

        List<String> transformed = new ArrayList<>();
        for (String part : parts) {
            if (part.isBlank()) {
                continue;
            }
            transformed.add(part.substring(0, 1).toUpperCase(Locale.ROOT) + part.substring(1));
        }
        return String.join(" ", transformed);
    }

    private static String categoryFromFile(String fileName) {
        String normalized = toUnixPath(fileName);
        if (!normalized.contains("/")) {
            return "uncategorized";
        }
        String category = normalized.substring(0, normalized.indexOf('/')).trim().toLowerCase(Locale.ROOT);
        return category.isEmpty() ? "uncategorized" : category;
    }

    private static String toFrontendGamePath(String relativePath) {
        String normalized = toUnixPath(relativePath);
        return "games/" + normalized;
    }

    private static String normalizeImagePath(String src) {
        if (src == null || src.isBlank()) {
            return "";
        }

        String decoded = urlDecode(src).trim().replace('\\', '/');
        if (decoded.isEmpty()) {
            return "";
        }
        if (decoded.startsWith("http://") || decoded.startsWith("https://") || decoded.startsWith("data:")) {
            return decoded;
        }

        while (decoded.startsWith("./")) {
            decoded = decoded.substring(2);
        }

        if (decoded.startsWith("../images/")) {
            return "images/" + decoded.substring("../images/".length());
        }
        if (decoded.startsWith("/images/")) {
            return "images/" + decoded.substring("/images/".length());
        }
        if (decoded.startsWith("images/")) {
            return decoded;
        }

        while (decoded.startsWith("../")) {
            decoded = decoded.substring(3);
        }
        if (decoded.startsWith("/")) {
            decoded = decoded.substring(1);
        }
        return decoded;
    }

    private static String normalizeGameFile(String gameValue) {
        if (gameValue == null || gameValue.isBlank()) {
            return "";
        }

        String decoded = urlDecode(gameValue).trim().replace('\\', '/');
        if (decoded.isEmpty() || decoded.startsWith("//") || URL_SCHEME_PATTERN.matcher(decoded).find()) {
            return "";
        }

        while (decoded.startsWith("./")) {
            decoded = decoded.substring(2);
        }

        if (decoded.startsWith("../games/")) {
            decoded = decoded.substring("../games/".length());
        } else if (decoded.startsWith("/games/")) {
            decoded = decoded.substring("/games/".length());
        } else if (decoded.startsWith("games/")) {
            decoded = decoded.substring("games/".length());
        }

        Path normalized = Paths.get(decoded).normalize();
        if (normalized.isAbsolute()) {
            return "";
        }

        String unix = toUnixPath(normalized.toString());
        if (unix.isBlank() || unix.startsWith("..")) {
            return "";
        }

        String lowered = unix.toLowerCase(Locale.ROOT);
        if (!lowered.endsWith(".html") && !lowered.endsWith(".htm")) {
            return "";
        }

        return unix;
    }

    private static String buildPlayerPath(String relativeFile, String title, String author) {
        return "game-player.html?game=" + urlEncode("games/" + relativeFile)
                + "&title=" + urlEncode(title)
                + "&author=" + urlEncode(author);
    }

    private static boolean hasClassToken(String attributes, String token) {
        String classValue = extractAttribute(attributes, CLASS_ATTR_PATTERN);
        if (classValue.isBlank()) {
            return false;
        }
        String[] tokens = classValue.split("\\s+");
        for (String part : tokens) {
            if (token.equals(part)) {
                return true;
            }
        }
        return false;
    }

    private static String extractAttribute(String source, Pattern attributePattern) {
        Matcher matcher = attributePattern.matcher(source);
        if (!matcher.find()) {
            return "";
        }
        return htmlEntityDecode(matcher.group(2).trim());
    }

    private static String extractFirstMatch(String source, Pattern pattern) {
        Matcher matcher = pattern.matcher(source);
        if (!matcher.find()) {
            return "";
        }
        int group = matcher.groupCount() >= 2 ? 2 : 1;
        return htmlEntityDecode(matcher.group(group));
    }

    private static String queryParamFromHref(String href, String key) {
        int queryIndex = href.indexOf('?');
        if (queryIndex < 0 || queryIndex + 1 >= href.length()) {
            return "";
        }

        String query = href.substring(queryIndex + 1);
        String[] pairs = query.split("&");
        for (String pair : pairs) {
            String[] parts = pair.split("=", 2);
            String candidateKey = urlDecode(parts.length > 0 ? parts[0] : "");
            if (!key.equals(candidateKey)) {
                continue;
            }
            String value = parts.length > 1 ? parts[1] : "";
            return urlDecode(value);
        }
        return "";
    }

    private static String htmlToText(String value) {
        String withoutTags = TAG_PATTERN.matcher(value).replaceAll(" ");
        return htmlEntityDecode(withoutTags).replaceAll("\\s+", " ").trim();
    }

    private static String htmlEntityDecode(String value) {
        return value
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&#39;", "'")
                .replace("&apos;", "'");
    }

    private static String urlDecode(String value) {
        return URLDecoder.decode(value, StandardCharsets.UTF_8);
    }

    private static String urlEncode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
    }

    private static String toUnixPath(String path) {
        return path.replace('\\', '/');
    }
}
