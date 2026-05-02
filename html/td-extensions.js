/* TitanLRS Backpack — tab switcher + utilities to replace mui.js tab behaviour. */
(function () {
  'use strict';

  // ── Tab switcher ─────────────────────────────────────────────────────────────
  // Finds all [data-td-tabs] containers, wires clicks on .td-tabs button[data-tab]
  // to set is-active on both the button and the matching .td-tab-pane[data-tab].
  // Exposes TdBP.activateTab(name) for programmatic tab activation (used by scan.js).

  function activateTab(name) {
    // Find button(s) with matching data-tab across all tab groups
    var buttons = document.querySelectorAll('.td-tabs > button[data-tab="' + name + '"]');
    buttons.forEach(function (btn) {
      var container = btn.closest('[data-td-tabs]');
      if (!container) return;
      // Deactivate all in this group
      container.querySelectorAll('.td-tabs > button').forEach(function (b) {
        b.classList.remove('is-active');
      });
      // Find and hide all panes
      document.querySelectorAll('.td-tab-pane').forEach(function (pane) {
        pane.classList.remove('is-active');
      });
      // Activate this button and its pane
      btn.classList.add('is-active');
      var pane = document.querySelector('.td-tab-pane[data-tab="' + name + '"]');
      if (pane) pane.classList.add('is-active');
      // Fire custom event so scan.js can react
      container.dispatchEvent(new CustomEvent('td:tabchange', { detail: { tab: name }, bubbles: true }));
    });
  }

  function initTabs() {
    document.querySelectorAll('[data-td-tabs]').forEach(function (container) {
      container.querySelectorAll('.td-tabs > button[data-tab]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          activateTab(btn.dataset.tab);
        });
      });
    });
    // Ensure at least one tab is active (the first visible one)
    document.querySelectorAll('[data-td-tabs]').forEach(function (container) {
      var active = container.querySelector('.td-tabs > button.is-active');
      if (!active) {
        var first = container.querySelector('.td-tabs > button:not([style*="display: none"]):not([style*="display:none"])');
        if (first) activateTab(first.dataset.tab);
      } else {
        // Make sure pane is shown for any pre-marked active button
        var pane = document.querySelector('.td-tab-pane[data-tab="' + active.dataset.tab + '"]');
        if (pane && !pane.classList.contains('is-active')) pane.classList.add('is-active');
      }
    });
  }

  // ── Overlay (replaces mui.overlay used by calibration) ──────────────────────
  var _overlay = null;

  function overlayOn(content) {
    if (_overlay) return;
    _overlay = document.createElement('div');
    _overlay.className = 'td-overlay';
    var inner = document.createElement('div');
    inner.className = 'td-overlay-content';
    if (typeof content === 'string') {
      inner.innerHTML = content;
    } else if (content instanceof HTMLElement) {
      inner.appendChild(content);
    }
    _overlay.appendChild(inner);
    document.body.appendChild(_overlay);
  }

  function overlayOff() {
    if (_overlay) {
      _overlay.remove();
      _overlay = null;
    }
  }

  // ── Drop-zone wiring ─────────────────────────────────────────────────────────
  function initDropZones() {
    document.querySelectorAll('.td-drop-zone[data-for]').forEach(function (zone) {
      var inputId = zone.dataset.for;
      var input = document.getElementById(inputId);
      if (!input) return;
      zone.addEventListener('click', function () { input.click(); });
      zone.addEventListener('dragover', function (e) {
        e.preventDefault();
        zone.classList.add('is-active');
      });
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
    initTabs();
    initDropZones();
    if (window.TD) { TD.init(); }
  }

  if (document.readyState !== 'loading') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }

  // ── Public API ───────────────────────────────────────────────────────────────
  window.TdBP = {
    activateTab: activateTab,
    overlayOn: overlayOn,
    overlayOff: overlayOff
  };

})();
