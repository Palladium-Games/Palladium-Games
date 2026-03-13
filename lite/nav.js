(function () {
  var NAV_KEY = 'palladium-nav-expanded';
  var nav = document.getElementById('nav');
  var btn = document.getElementById('nav-toggle');

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
    syncActiveLink();
    setExpanded(getExpanded());
    document.documentElement.classList.remove('nav-initial-collapsed', 'nav-initial-expanded');
    btn.addEventListener('click', toggle);
  }
})();
