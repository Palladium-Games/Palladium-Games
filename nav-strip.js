(function () {
  function getSignalEndpoint() {
    if (typeof window.PALLADIUM_LINK_SIGNAL_URL === "string" && window.PALLADIUM_LINK_SIGNAL_URL.trim()) {
      return window.PALLADIUM_LINK_SIGNAL_URL.trim();
    }
    var protocol = (window.location && window.location.protocol) ? window.location.protocol : "http:";
    var hostname = (window.location && window.location.hostname) ? window.location.hostname : "localhost";
    return protocol + "//" + hostname + ":1338/link-signal";
  }

  function emitFirstLinkSignal() {
    if (!window || !window.location || !window.location.origin) return;
    var storageKey = "palladiumLinkSignalOrigins";
    var origin = window.location.origin;
    var seen = [];

    try {
      var raw = localStorage.getItem(storageKey);
      seen = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(seen)) seen = [];
    } catch (_err) {
      seen = [];
    }

    if (seen.indexOf(origin) !== -1) return;

    var payload = {
      origin: origin,
      href: window.location.href,
      referrer: document.referrer || "",
      emittedAt: new Date().toISOString(),
    };

    fetch(getSignalEndpoint(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-palladium-link-signal": "1",
      },
      body: JSON.stringify(payload),
      keepalive: true,
      mode: "cors",
    })
      .then(function (response) {
        if (!response || !response.ok) return;
        seen.push(origin);
        try {
          localStorage.setItem(storageKey, JSON.stringify(seen.slice(-80)));
        } catch (_err) {}
      })
      .catch(function () {
        // Silent failure: we'll retry on next load.
      });
  }

  function init() {
    var strip = document.querySelector('.nav-strip');
    var toggle = document.querySelector('.nav-strip-toggle');

    emitFirstLinkSignal();

    if (!strip || !toggle) return;

    var stored = localStorage.getItem('navStripExpanded');
    if (stored === 'true') {
      strip.classList.add('expanded');
      document.body.classList.add('nav-expanded');
      document.documentElement.classList.add('nav-strip-expanded');
      toggle.setAttribute('aria-expanded', 'true');
    }

    toggle.addEventListener('click', function () {
      var expanded = strip.classList.toggle('expanded');
      document.body.classList.toggle('nav-expanded', expanded);
      document.documentElement.classList.toggle('nav-strip-expanded', expanded);
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      localStorage.setItem('navStripExpanded', expanded);
    });

    // Enable transitions after first paint so page load/navigation doesn't animate
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        setTimeout(function () {
          document.documentElement.classList.add('nav-strip-ready');
        }, 80);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
