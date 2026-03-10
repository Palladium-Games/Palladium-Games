(function () {
  var NAV_KEY = 'palladium-nav-expanded';
  var nav = document.getElementById('nav');
  var btn = document.getElementById('nav-toggle');

  function getExpanded() {
    if (typeof sessionStorage === 'undefined') return true;
    var stored = sessionStorage.getItem(NAV_KEY);
    if (stored === null) return true;
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

  if (nav && btn) {
    document.documentElement.classList.remove('nav-initial-collapsed', 'nav-initial-expanded');
    setExpanded(getExpanded());
    btn.addEventListener('click', toggle);
  }
})();
