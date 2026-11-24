/* TableTap — shell-boot.js (classic script, no imports, must run before first paint)
   SOURCE FILE. It is pasted inline into every page with the app shell by
   scripts/sync-boot.js (an external script would be fetched first and the browser
   would paint an empty sidebar meanwhile, which is the flicker this removes).
   Paints the sidebar and top bar straight away from the copy layout.js saved on an
   earlier page, then marks the current page's link and title. layout.js redraws the
   real shell a moment later; when nothing changed it is identical.
   Also hides the page body (html.tt-pending) until the page script has drawn it, so a
   page's static placeholder never flashes before the live data replaces it. */
(function () {
  var root = document.documentElement;
  root.classList.add('tt-pending');
  try {
    var body = document.body;
    var sidebar = document.getElementById('app-sidebar');
    var topbar = document.getElementById('app-topbar');
    if (!body || !sidebar) return;
    var page = body.getAttribute('data-page') || '';
    var KEYS = ['tqr_admin_session', 'tqr_session', 'tqr_floor_session', 'tqr_kitchen_session'];
    var stamp = KEYS.map(function (k) { return localStorage.getItem(k) || ''; }).join('|');
    var raw = localStorage.getItem('tt_shell:' + (body.getAttribute('data-role') || 'app') + ':' + (page === 'floor' ? 'floor' : 'std'));
    if (!raw) return;
    var cached = JSON.parse(raw);
    if (!cached || cached.stamp !== stamp) return; // another user or a fresh login: layout.js draws it
    sidebar.innerHTML = cached.sidebar || '';
    if (topbar) topbar.innerHTML = cached.topbar || '';

    // Current page: the link whose file name matches this page (sub-pages map to their parent)
    var ALIAS = { 'menu-item.html': 'menu.html', 'client-detail.html': 'clients.html' };
    var file = location.pathname.split('/').pop() || '';
    var want = ALIAS[file] || file;
    var links = sidebar.querySelectorAll('a.nav-link');
    for (var i = 0; i < links.length; i++) {
      var href = (links[i].getAttribute('href') || '').split('?')[0].split('/').pop();
      if (href === want) { links[i].classList.add('active'); links[i].setAttribute('aria-current', 'page'); }
    }
    var title = topbar && topbar.querySelector('.app-shell__title');
    if (title) title.textContent = body.getAttribute('data-title') || document.title.split('—')[0].split('·')[0].trim();
  } catch (e) { /* storage blocked: layout.js draws the shell as before */ }
})();
