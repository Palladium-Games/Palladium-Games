/**
 * Per-game user data stored in localStorage.
 * Keys: titanium_game_{gameId}
 * Value: JSON { lastPlayed, data: {} }
 */
(function() {
    var PREFIX = 'titanium_game_';

    function key(id) {
        return PREFIX + (id || 'default');
    }

    window.getGameUserData = function(gameId) {
        try {
            var raw = localStorage.getItem(key(gameId));
            if (!raw) return { lastPlayed: 0, data: {} };
            var parsed = JSON.parse(raw);
            return {
                lastPlayed: parsed.lastPlayed || 0,
                data: parsed.data || {}
            };
        } catch (e) {
            return { lastPlayed: 0, data: {} };
        }
    };

    window.setGameUserData = function(gameId, data) {
        try {
            var current = window.getGameUserData(gameId);
            if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
                current.data = data;
            } else {
                current.data = { value: data };
            }
            current.lastPlayed = Date.now();
            localStorage.setItem(key(gameId), JSON.stringify(current));
        } catch (e) {}
    };

    window.updateGameUserData = function(gameId, updates) {
        var current;
        try {
            current = window.getGameUserData(gameId);
            if (typeof updates === 'object' && updates !== null) {
                for (var k in updates) {
                    if (updates.hasOwnProperty(k)) current.data[k] = updates[k];
                }
            }
            current.lastPlayed = Date.now();
            localStorage.setItem(key(gameId), JSON.stringify(current));
            return current.data;
        } catch (e) {
            return (current && current.data) || {};
        }
    };
})();
