/* TitanLRS Backpack — hash router, sidebar toggle, overlay, drop-zone. */
(function () {
  'use strict';

  // ── Hash router ──────────────────────────────────────────────────────────────
  // Hides all [data-route] sections, shows the one matching location.hash.
  // Falls back to the first [data-route] when hash is empty or unknown.
  // Fires td:tabchange for backward compat with scan.js.

  function navigate(isInitial) {
    var routeName = location.hash.slice(1) || '';
    var sections = document.querySelectorAll('[data-route]');
    if (!sections.length) return;

    var target = routeName ? document.querySelector('[data-route="' + routeName + '"]') : null;
    if (!target) {
      target = sections[0];
      routeName = target ? target.dataset.route : '';
    }

    function doSwap() {
      sections.forEach(function (s) { s.hidden = true; });
      if (target) target.hidden = false;

      document.querySelectorAll('.td-nav-item').forEach(function (a) {
        a.classList.toggle('is-active', a.getAttribute('href') === '#' + routeName);
      });

      // Update topbar breadcrumb route label
      var breadcrumbRoute = document.getElementById('breadcrumb_route');
      if (breadcrumbRoute) {
        var activeNav = document.querySelector('.td-nav-item.is-active');
        breadcrumbRoute.textContent = activeNav ? activeNav.textContent.trim() : '';
      }

      // Fire events for scan.js compat (td:tabchange on document + on the nav item)
      document.dispatchEvent(new CustomEvent('td:tabchange', { detail: { tab: routeName } }));
      var navItem = document.querySelector('.td-nav-item[href="#' + routeName + '"]');
      if (navItem) navItem.dispatchEvent(new CustomEvent('td:tabchange', { detail: { tab: routeName }, bubbles: true }));

      var main = document.getElementById('main');
      if (main) { main.classList.remove('route-fade-out'); main.classList.add('route-fade-in'); }
    }

    if (!isInitial) {
      var main = document.getElementById('main');
      if (main) {
        main.classList.add('route-fade-out');
        main.classList.remove('route-fade-in');
        setTimeout(doSwap, 120);
      } else {
        doSwap();
      }
    } else {
      doSwap();
    }
  }

  // ── Mobile sidebar toggle ────────────────────────────────────────────────────
  function initSidebar() {
    var toggle = document.getElementById('sidebar-toggle');
    var drawer = document.getElementById('sidedrawer');
    var backdrop = document.getElementById('sidebar-backdrop');

    function open() { if (drawer) drawer.classList.add('active'); if (backdrop) backdrop.classList.add('active'); }
    function close() { if (drawer) drawer.classList.remove('active'); if (backdrop) backdrop.classList.remove('active'); }

    if (toggle) toggle.addEventListener('click', open);
    if (backdrop) backdrop.addEventListener('click', close);
    document.querySelectorAll('.td-nav-item').forEach(function (a) { a.addEventListener('click', close); });
  }

  // ── Overlay (replaces mui.overlay used by calibration) ──────────────────────
  var _overlay = null;

  function overlayOn(content) {
    if (_overlay) return;
    _overlay = document.createElement('div');
    _overlay.className = 'td-overlay';
    var inner = document.createElement('div');
    inner.className = 'td-overlay-content';
    if (typeof content === 'string') { inner.innerHTML = content; }
    else if (content instanceof HTMLElement) { inner.appendChild(content); }
    _overlay.appendChild(inner);
    document.body.appendChild(_overlay);
  }

  function overlayOff() {
    if (_overlay) { _overlay.remove(); _overlay = null; }
  }

  // ── Drop-zone wiring ─────────────────────────────────────────────────────────
  function initDropZones() {
    document.querySelectorAll('.td-drop-zone[data-for]').forEach(function (zone) {
      var inputId = zone.dataset.for;
      var input = document.getElementById(inputId);
      if (!input) return;
      zone.addEventListener('click', function () { input.click(); });
      zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('is-active'); });
      zone.addEventListener('dragleave', function () { zone.classList.remove('is-active'); });
      zone.addEventListener('drop', function (e) {
        e.preventDefault();
        zone.classList.remove('is-active');
        if (e.dataTransfer.files.length) {
          var dt = new DataTransfer();
          dt.items.add(e.dataTransfer.files[0]);
          input.files = dt.files;
          var label = zone.querySelector('.td-drop-filename');
          if (label) label.textContent = e.dataTransfer.files[0].name;
        }
      });
      input.addEventListener('change', function () {
        var label = zone.querySelector('.td-drop-filename');
        if (label && input.files.length) label.textContent = input.files[0].name;
      });
    });
  }

  // ── DOMContentLoaded init ───────────────────────────────────────────────────
  function init() {
    navigate(true);
    initSidebar();
    initDropZones();
    if (window.TD) { TD.init(); }
  }

  window.addEventListener('hashchange', function () { navigate(false); });

  if (document.readyState !== 'loading') { init(); }
  else { document.addEventListener('DOMContentLoaded', init); }

  // ── Public API ───────────────────────────────────────────────────────────────
  window.TdBP = {
    navigate: navigate,
    overlayOn: overlayOn,
    overlayOff: overlayOff
  };

})();
