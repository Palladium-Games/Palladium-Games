#!/usr/bin/env node

const DEFAULT_GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";

function resolveWebSocketClass() {
  if (typeof WebSocket !== "undefined") return WebSocket;
  try {
    // Optional fallback for older Node versions if ws is installed.
    // eslint-disable-next-line global-require
    return require("ws");
  } catch {
    return null;
  }
}

function startDiscordPresence(options = {}) {
  const token = String(options.token || "").trim();
  const intents = Number.isFinite(options.intents) ? Number(options.intents) : 0;
  const status = String(options.status || "online");
  const logPrefix = String(options.logPrefix || "Discord");
  const gatewayUrl = String(options.gatewayUrl || DEFAULT_GATEWAY);
  const activity = options.activity && typeof options.activity === "object" ? options.activity : null;

  const WebSocketImpl = resolveWebSocketClass();
  if (!token || !WebSocketImpl) {
    if (!WebSocketImpl) {
      console.warn(`${logPrefix}: WebSocket unavailable, presence connection disabled.`);
    }
    return { stop() {} };
  }

  let ws = null;
  let heartbeatTimer = null;
  let reconnectTimer = null;
  let sequence = null;
  let stopped = false;
  let readyLogged = false;

  function clearHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function safeSend(payload) {
    if (!ws) return;
    if (ws.readyState !== WebSocketImpl.OPEN) return;
    ws.send(JSON.stringify(payload));
  }

  function heartbeat() {
    safeSend({ op: 1, d: sequence });
  }

  function scheduleReconnect(delayMs = 2500) {
    if (stopped) return;
    if (reconnectTimer) return;
    clearHeartbeat();
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delayMs);
  }

  function identify() {
    const activities = activity ? [activity] : [];
    safeSend({
      op: 2,
      d: {
        token,
        intents,
        properties: {
          os: process.platform,
          browser: "palladium-bot",
          device: "palladium-bot",
        },
        presence: {
          status,
          since: null,
          afk: false,
          activities,
        },
      },
    });
  }

  function onMessage(raw) {
    let packet = null;
    try {
      packet = JSON.parse(typeof raw === "string" ? raw : String(raw));
    } catch {
      return;
    }

    if (!packet || typeof packet !== "object") return;
    if (typeof packet.s !== "undefined" && packet.s !== null) {
      sequence = packet.s;
    }

    if (packet.op === 10 && packet.d && packet.d.heartbeat_interval) {
      clearHeartbeat();
      const interval = Math.max(1000, Number(packet.d.heartbeat_interval));
      heartbeatTimer = setInterval(heartbeat, interval);
      heartbeat();
      identify();
      return;
    }

    if (packet.op === 7) {
      scheduleReconnect(1000);
      return;
    }

    if (packet.op === 9) {
      // Invalid session.
      sequence = null;
      scheduleReconnect(1200);
      return;
    }

    if (packet.t === "READY" && !readyLogged) {
      const user = packet.d && packet.d.user ? packet.d.user : null;
      const username = user && user.username ? user.username : "bot";
      console.log(`${logPrefix}: gateway presence online as ${username}`);
      readyLogged = true;
    }
  }

  function connect() {
    if (stopped) return;
    try {
      ws = new WebSocketImpl(gatewayUrl);
    } catch (error) {
      const msg = error && error.message ? error.message : String(error);
      console.warn(`${logPrefix}: gateway connect error: ${msg}`);
      scheduleReconnect(3000);
      return;
    }

    ws.onopen = () => {
      readyLogged = false;
    };

    ws.onmessage = (event) => {
      const payload = event && typeof event.data !== "undefined" ? event.data : event;
      onMessage(payload);
    };

    ws.onerror = () => {
      // Close will trigger reconnect.
    };

    ws.onclose = () => {
      ws = null;
      scheduleReconnect(2000);
    };
  }

  connect();

  return {
    stop() {
      stopped = true;
      clearHeartbeat();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws && ws.readyState === WebSocketImpl.OPEN) {
        try {
          ws.close(1000, "Palladium shutdown");
        } catch {
          // Ignore close errors.
        }
      }
      ws = null;
    },
  };
}

module.exports = {
  startDiscordPresence,
};
