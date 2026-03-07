/** config: set PROXY_BASE to your endpoint (base64). default = atob('aHR0cDovL2xvY2FsaG9zdDo4MDgwLw==') */
(function () {
  var PROXY_BASE = atob('aHR0cDovL2xvY2FsaG9zdDo4MDgwLw==');
  var SEARCH_BASE = atob('aHR0cHM6Ly93d3cuZ29vZ2xlLmNvbS9zZWFyY2g/cT0');

  function getSearchUrl(q) {
    return SEARCH_BASE + encodeURIComponent(q);
  }

  function isUrl(input) {
    if (input.startsWith('http://') || input.startsWith('https://')) return true;
    var cleaned = input.replace(/^(www\.|http:\/\/|https:\/\/)/i, '');
    var tld = /\.(com|org|net|edu|gov|io|co|uk|de|fr|jp|cn|au|ca|us|tv|me|info|xyz|site|online|tech|dev|app|blog|store|shop|club|space|website|news|email|cloud|design|art|music|video|game|games|fun|play|live|world|global|international|biz|name|pro|mobi|asia|jobs|travel|win|work|zone)$/i;
    if (tld.test(cleaned) && !cleaned.includes(' ')) return true;
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(cleaned)) return true;
    return false;
  }

  function buildProxyUrl(targetUrl) {
    var base = (PROXY_BASE || '').trim();
    if (!base) return null;
    if (base.indexOf('url=') >= 0) return base + encodeURIComponent(targetUrl);
    return base + (base.indexOf('?') >= 0 ? '&' : '?') + 'url=' + encodeURIComponent(targetUrl);
  }

  function loadBlockedRedirect(url) {
    function esc(s) {
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
    var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Redirecting</title>' +
      '<meta http-equiv="refresh" content="0;url=' + esc(url) + '"></head>' +
      '<body><p>Redirecting...</p><a href="' + esc(url) + '">Click here if not redirected</a></body></html>';
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  }

  function loadUrl(input) {
    if (!input || !(input = input.trim())) return;
    var raw = input;
    var displayUrl = raw;
    var loadUrlResult = raw;

    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      loadUrlResult = raw;
    } else if (isUrl(raw)) {
      var cleaned = raw.replace(/^(www\.|http:\/\/|https:\/\/)/i, '');
      loadUrlResult = raw.indexOf('http') === 0 ? raw : 'https://' + cleaned;
    } else {
      loadUrlResult = getSearchUrl(raw);
    }

    displayUrl = loadUrlResult;
    var finalLoad = loadUrlResult;
    var base = (PROXY_BASE || '').trim();

    if (base) {
      var built = buildProxyUrl(loadUrlResult);
      if (built) finalLoad = built;
    } else {
      try {
        var u = new URL(loadUrlResult);
        var host = u.hostname.toLowerCase();
        var blocked = ['poki.com', 'www.poki.com', 'duckduckgo.com', 'www.duckduckgo.com', 'bing.com', 'www.bing.com'];
        for (var i = 0; i < blocked.length; i++) {
          if (host.indexOf(blocked[i]) >= 0) {
            finalLoad = loadBlockedRedirect(loadUrlResult);
            break;
          }
        }
      } catch (e) {}
    }

    var frame = document.getElementById('browserFrame');
    var loading = document.getElementById('browserLoading');
    var addressInput = document.getElementById('browserAddressInput');

    if (loading) loading.style.display = 'flex';
    if (frame) {
      frame.removeAttribute('sandbox');
      frame.src = finalLoad;
    }

    historyList = historyList.slice(0, historyIndex + 1);
    historyList.push(finalLoad);
    displayList = displayList.slice(0, historyIndex + 1);
    displayList.push(displayUrl);
    historyIndex = historyList.length - 1;
    updateNavButtons();
    if (addressInput) addressInput.value = displayUrl;
  }

  function updateNavButtons() {
    var back = document.getElementById('browserBack');
    var fwd = document.getElementById('browserForward');
    if (back) back.disabled = historyIndex <= 0;
    if (fwd) fwd.disabled = historyIndex >= historyList.length - 1;
  }

  var historyList = [];
  var displayList = [];
  var historyIndex = -1;

  document.addEventListener('DOMContentLoaded', function () {
    var frame = document.getElementById('browserFrame');
    var addressInput = document.getElementById('browserAddressInput');
    var form = document.getElementById('browserAddressForm');
    var back = document.getElementById('browserBack');
    var fwd = document.getElementById('browserForward');
    var refresh = document.getElementById('browserRefresh');
    var home = document.getElementById('browserHome');
    var loading = document.getElementById('browserLoading');

    var q = window.location.search ? new URLSearchParams(window.location.search).get('q') : null;
    if (q && q.trim()) {
      loadUrl(q.trim());
    } else {
      var base = (PROXY_BASE || '').trim();
      if (base && frame) {
        var baseUrl = base.replace(/\?url=.*$/, '').replace(/&url=.*$/, '');
        frame.src = baseUrl || base;
      } else if (frame) {
        frame.src = 'about:blank';
      }
    }

    if (form && addressInput) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var v = addressInput.value.trim();
        if (v) loadUrl(v);
      });
    }

    if (back) {
      back.addEventListener('click', function () {
        if (historyIndex > 0) {
          historyIndex--;
          if (loading) loading.style.display = 'flex';
          frame.src = historyList[historyIndex];
          addressInput.value = displayList[historyIndex] != null ? displayList[historyIndex] : historyList[historyIndex];
          updateNavButtons();
        }
      });
    }

    if (fwd) {
      fwd.addEventListener('click', function () {
        if (historyIndex < historyList.length - 1) {
          historyIndex++;
          if (loading) loading.style.display = 'flex';
          frame.src = historyList[historyIndex];
          addressInput.value = displayList[historyIndex] != null ? displayList[historyIndex] : historyList[historyIndex];
          updateNavButtons();
        }
      });
    }

    if (refresh) {
      refresh.addEventListener('click', function () {
        if (frame.src && frame.src !== 'about:blank') {
          if (loading) loading.style.display = 'flex';
          frame.src = frame.src;
        }
      });
    }

    if (home) {
      home.addEventListener('click', function () {
        window.location.href = 'index.html';
      });
    }

    if (frame) {
      frame.addEventListener('load', function () {
        if (loading) loading.style.display = 'none';
        if (!(PROXY_BASE && PROXY_BASE.trim())) {
          try {
            if (addressInput) addressInput.value = frame.contentWindow.location.href;
          } catch (err) {}
        }
      });
      frame.addEventListener('error', function () {
        if (loading) loading.style.display = 'none';
      });
      window.addEventListener('message', function (e) {
        if (!e.data || e.data.type !== 'palladium-frame-url' || !e.data.url) return;
        if (addressInput) addressInput.value = e.data.url;
      });
    }
  });
})();
