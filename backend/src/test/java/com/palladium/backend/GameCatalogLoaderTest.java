package com.palladium.backend;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Tests for {@link GameCatalogLoader}.
 */
class GameCatalogLoaderTest {

    @TempDir
    Path tempDir;

    @Test
    void loadGamesUsesFrontendCatalogWhenAvailable() throws IOException {
        Path frontendDir = tempDir.resolve("frontend");
        Path gamesDir = tempDir.resolve("games");
        Files.createDirectories(frontendDir);
        Files.createDirectories(gamesDir.resolve("l2f"));

        Files.writeString(gamesDir.resolve("l2f/learn-to-fly.html"), "<title>Should Not Win</title>", StandardCharsets.UTF_8);

        String gamesHtml = """
                <html><body>
                  <a href="game-player.html?game=../games/l2f/learn-to-fly.html&title=Learn%20to%20Fly&author=Light%20Bringer" class="game-card">
                    <div class="game-card__thumb"><img src="../images/game-img/learn-to-fly.png" alt="Learn to Fly" /></div>
                    <div class="game-card__info">
                      <div class="game-card__title">Learn to Fly</div>
                      <div class="game-card__author">Light Bringer</div>
                    </div>
                  </a>
                </body></html>
                """;
        Files.writeString(frontendDir.resolve("games.html"), gamesHtml, StandardCharsets.UTF_8);

        List<GameEntry> games = GameCatalogLoader.loadGames(frontendDir, gamesDir);

        assertEquals(1, games.size());
        GameEntry game = games.getFirst();
        assertEquals("l2f/learn-to-fly.html", game.file());
        assertEquals("Learn to Fly", game.title());
        assertEquals("Light Bringer", game.author());
        assertEquals("l2f", game.category());
        assertEquals("games/l2f/learn-to-fly.html", game.path());
        assertEquals("images/game-img/learn-to-fly.png", game.image());
        assertEquals("game-player.html?game=games%2Fl2f%2Flearn-to-fly.html&title=Learn%20to%20Fly&author=Light%20Bringer", game.playerPath());
    }

    @Test
    void loadGamesFallsBackToGamesDirectoryWhenFrontendCatalogMissing() throws IOException {
        Path frontendDir = tempDir.resolve("frontend");
        Path gamesDir = tempDir.resolve("games");
        Files.createDirectories(frontendDir);
        Files.createDirectories(gamesDir.resolve("fnaf"));

        String gameHtml = """
                <html>
                <head>
                  <title>Five Nights at Freddy's 1</title>
                  <meta name="author" content="Scott Cawthon" />
                </head>
                </html>
                """;
        Files.writeString(gamesDir.resolve("fnaf/fnaf-1.html"), gameHtml, StandardCharsets.UTF_8);

        List<GameEntry> games = GameCatalogLoader.loadGames(frontendDir, gamesDir);

        assertEquals(1, games.size());
        GameEntry game = games.getFirst();
        assertEquals("fnaf/fnaf-1.html", game.file());
        assertEquals("Five Nights at Freddy's 1", game.title());
        assertEquals("Scott Cawthon", game.author());
        assertEquals("fnaf", game.category());
        assertEquals("games/fnaf/fnaf-1.html", game.path());
        assertTrue(game.playerPath().contains("game-player.html?game=games%2Ffnaf%2Ffnaf-1.html"));
    }

    @Test
    void loadGamesSkipsInvalidExternalGameTargets() throws IOException {
        Path frontendDir = tempDir.resolve("frontend");
        Path gamesDir = tempDir.resolve("games");
        Files.createDirectories(frontendDir);
        Files.createDirectories(gamesDir.resolve("others"));

        String gamesHtml = """
                <html><body>
                  <a href="game-player.html?game=https://example.com/malicious.html&title=Bad&author=Bad" class="game-card">
                    <div class="game-card__title">Bad</div>
                    <div class="game-card__author">Bad</div>
                  </a>
                  <a href="game-player.html?game=../games/others/fnae.html&title=FNAE&author=EvanProductions" class="game-card">
                    <div class="game-card__title">FNAE</div>
                    <div class="game-card__author">EvanProductions</div>
                  </a>
                </body></html>
                """;
        Files.writeString(frontendDir.resolve("games.html"), gamesHtml, StandardCharsets.UTF_8);

        List<GameEntry> games = GameCatalogLoader.loadGames(frontendDir, gamesDir);

        assertEquals(1, games.size());
        assertEquals("others/fnae.html", games.getFirst().file());
    }

    @Test
    void countCategoriesAggregatesByCategory() {
        List<GameEntry> games = List.of(
                new GameEntry("a/x.html", "X", "A", "arcade", "/games/a/x.html", "", ""),
                new GameEntry("a/y.html", "Y", "A", "arcade", "/games/a/y.html", "", ""),
                new GameEntry("b/z.html", "Z", "B", "strategy", "/games/b/z.html", "", "")
        );

        Map<String, Integer> counts = GameCatalogLoader.countCategories(games);

        assertEquals(2, counts.size());
        assertEquals(2, counts.get("arcade"));
        assertEquals(1, counts.get("strategy"));
    }
}
