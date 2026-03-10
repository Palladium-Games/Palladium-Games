package com.palladium.backend;

/**
 * Immutable game metadata used by backend APIs.
 *
 * @param file relative file path inside the configured games directory (for example {@code l2f/learn-to-fly.html})
 * @param title display title shown to users
 * @param author display author shown to users
 * @param category logical category derived from the game path
 * @param path frontend-relative game path (for example {@code games/l2f/learn-to-fly.html})
 * @param image frontend-relative image path (for example {@code images/game-img/learn-to-fly.png})
 * @param playerPath player page link (for example {@code game-player.html?...})
 */
public record GameEntry(
        String file,
        String title,
        String author,
        String category,
        String path,
        String image,
        String playerPath
) {
}
