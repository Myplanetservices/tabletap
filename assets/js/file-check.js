/* ==========================================================================
   TableTap — file-check.js
   Classic script (runs even from file://). Browsers block ES modules on
   file://, so warn once instead of showing an empty page.
   ========================================================================== */
(function () {
  if (location.protocol !== 'file:') return;
  document.addEventListener('DOMContentLoaded', function () {
    var banner = document.createElement('div');
    banner.setAttribute('role', 'status');
    banner.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;padding:12px 16px;' +
      'background:#B45309;color:#fff;font:14px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;' +
      'text-align:center;';
    banner.textContent = 'This demo uses ES modules, which browsers block on file:// links. ' +
      'Serve the folder first: python3 -m http.server 8000 — then open http://localhost:8000';
    document.body.appendChild(banner);
  });
})();
