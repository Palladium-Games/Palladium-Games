(function () {
  function init() {
    var strip = document.querySelector('.nav-strip');
    var toggle = document.querySelector('.nav-strip-toggle');
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
