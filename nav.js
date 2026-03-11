(function () {
  var NAV_KEY = 'palladium-nav-expanded';
  var nav = document.getElementById('nav');
  var btn = document.getElementById('nav-toggle');
  var SETTINGS_HREF = 'settings.html';

  function getExpanded() {
    if (typeof sessionStorage === 'undefined') return false;
    var stored = sessionStorage.getItem(NAV_KEY);
    if (stored === null) return false;
    return stored === '1';
  }

  function setExpanded(expanded) {
    if (!nav) return;
    nav.classList.toggle('nav--collapsed', !expanded);
    nav.classList.toggle('nav--expanded', expanded);
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(NAV_KEY, expanded ? '1' : '0');
  }

  function toggle() {
    setExpanded(!getExpanded());
  }

  function settingsLinkMarkup() {
    return (
      '<svg class="nav__link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="12" cy="12" r="3"></circle>' +
      '<path d="M19.4 15a1.6 1.6 0 0 0 .33 1.76l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.76-.33 1.6 1.6 0 0 0-.94 1.46V21a2 2 0 0 1-4 0v-.09a1.6 1.6 0 0 0-.94-1.46 1.6 1.6 0 0 0-1.76.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.6 1.6 0 0 0 4.6 15a1.6 1.6 0 0 0-1.46-.94H3a2 2 0 0 1 0-4h.09a1.6 1.6 0 0 0 1.46-.94 1.6 1.6 0 0 0-.33-1.76l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.6 1.6 0 0 0 1.76.33h.02a1.6 1.6 0 0 0 .92-1.45V3a2 2 0 0 1 4 0v.09a1.6 1.6 0 0 0 .94 1.46h.02a1.6 1.6 0 0 0 1.76-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.6 1.6 0 0 0-.33 1.76v.02a1.6 1.6 0 0 0 1.45.92H21a2 2 0 0 1 0 4h-.09a1.6 1.6 0 0 0-1.46.94z"></path>' +
      '</svg>' +
      '<span class="nav__link-text">Settings</span>'
    );
  }

  function ensureSettingsLink() {
    if (!nav) return;
    var links = nav.querySelector('.nav__links');
    if (!links) return;

    if (links.querySelector('a[href="' + SETTINGS_HREF + '"]')) return;

    var link = document.createElement('a');
    link.href = SETTINGS_HREF;
    link.className = 'nav__link';
    link.innerHTML = settingsLinkMarkup();
    links.appendChild(link);
  }

  function syncActiveLink() {
    if (!nav) return;
    var links = Array.prototype.slice.call(nav.querySelectorAll('.nav__link[href]'));
    if (!links.length) return;

    var current = String(window.location.pathname || '').split('/').pop().toLowerCase();
    if (!current) current = 'index.html';

    var match = null;
    for (var i = 0; i < links.length; i += 1) {
      var href = String(links[i].getAttribute('href') || '').split('?')[0].split('#')[0].toLowerCase();
      if (href === current) {
        match = links[i];
        break;
      }
    }

    if (!match) return;

    for (var j = 0; j < links.length; j += 1) {
      links[j].classList.remove('nav__link--active');
    }
    match.classList.add('nav__link--active');
  }

  if (nav && btn) {
    ensureSettingsLink();
    syncActiveLink();
    document.documentElement.classList.remove('nav-initial-collapsed', 'nav-initial-expanded');
    setExpanded(getExpanded());
    btn.addEventListener('click', toggle);
  }
})();
