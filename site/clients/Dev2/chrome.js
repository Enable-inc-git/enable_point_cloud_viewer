/* =============================================================
   Dev2 chrome bootstrap.
   - Sets data-theme on <html> before paint (no flash).
   - Waits for legacy injectMarkButtons() to finish, then moves
     #enable-sidebar-groups into the hidden #enable-legacy-host so
     all existing JS (getElementById('btn-*'), appendChild to list
     <div>s, etc.) keeps working unchanged.
   - Builds the top toolbar with Lucide-iconed dropdowns. Each item
     proxies to a legacy #btn-* by simulating a click — that way we
     don't have to expose any handler from viewer.html's IIFE.
   - Reparents the visible list <div>s out of the hidden host into
     new sidebar sections. The dynamic UI elements (plane depth,
     elevation range/contour controls, status badges) are pulled
     into the right context panel via a MutationObserver that
     watches for them appearing in the DOM.
   ============================================================= */
(function () {
  'use strict';

  // ---- Apply theme + sidebar/panel state synchronously (before first paint) ----
  (function applyEarlyState() {
    var savedTheme = null, savedSidebar = null, savedPinned = null;
    var savedCtxWidth = null, savedPanoWidth = null;
    try { savedTheme     = localStorage.getItem('dev2.theme'); } catch (_) {}
    try { savedSidebar   = localStorage.getItem('dev2.sidebar.collapsed'); } catch (_) {}
    try { savedPinned    = localStorage.getItem('dev2.context.pinned'); } catch (_) {}
    try { savedCtxWidth  = localStorage.getItem('dev2.context.width'); } catch (_) {}
    try { savedPanoWidth = localStorage.getItem('dev2.panorama.width'); } catch (_) {}
    document.documentElement.dataset.theme = (savedTheme === 'light') ? 'light' : 'dark';
    if (savedSidebar === 'true') document.documentElement.dataset.sidebarCollapsed = 'true';
    // Tool Settings is closed by default. Only "pinned" persists; auto-open
    // on content arrival happens through updateContextPanelVisibility.
    if (savedPinned === 'true') document.documentElement.dataset.contextPinned = 'true';
    if (savedCtxWidth) {
      var w = parseInt(savedCtxWidth, 10);
      if (!isNaN(w) && w >= 225 && w <= window.innerWidth * 0.95) {
        document.documentElement.style.setProperty('--context-panel-width', w + 'px');
      }
    }
    if (savedPanoWidth) {
      var pw = parseInt(savedPanoWidth, 10);
      if (!isNaN(pw) && pw >= 225 && pw <= window.innerWidth * 0.5) {
        document.documentElement.style.setProperty('--panorama-width', pw + 'px');
      }
    }
  })();

  // ============================================================
  // Panorama event-blocker interception.
  //
  // viewer.html's openStationPanorama installs a capture-phase
  // listener on document for mouse/wheel/pointer events that
  // calls stopImmediatePropagation on any event NOT inside the
  // modal — effectively making the cloud canvas un-interactable.
  //
  // The function reference is private to viewer.html's IIFE, so
  // we can't remove it directly. We wrap document.addEventListener
  // BEFORE the user can open a panorama (chrome.js loads before
  // user input), and we recognise the blocker by a unique string
  // in its source code ("station-panorama-modal" appears in its
  // target-walk). When we want to allow cloud interaction (docked
  // mode), we call our saved reference into removeEventListener.
  // ============================================================

  var _panoBlockedTypes = ['mousedown','mouseup','mousemove','wheel','contextmenu','pointerdown','pointerup','pointermove'];
  var _panoBlockerFn = null;
  (function interceptPanoramaBlocker() {
    var origAdd = document.addEventListener;
    document.addEventListener = function (type, listener, optsOrCapture) {
      var isCapture = optsOrCapture === true || (optsOrCapture && optsOrCapture.capture);
      if (isCapture && _panoBlockedTypes.indexOf(type) !== -1 && typeof listener === 'function') {
        try {
          // Source-string fingerprint; viewer.html line 1231 checks for this id.
          if (Function.prototype.toString.call(listener).indexOf('station-panorama-modal') !== -1) {
            _panoBlockerFn = listener;
          }
        } catch (_) {}
      }
      return origAdd.call(this, type, listener, optsOrCapture);
    };
  })();

  function disablePanoramaBlocker() {
    if (!_panoBlockerFn) return;
    _panoBlockedTypes.forEach(function (t) {
      document.removeEventListener(t, _panoBlockerFn, true);
    });
    // Restore cloud canvas pointer-events so the model can be interacted with.
    var canvas = document.querySelector('#potree_render_area canvas');
    if (canvas) canvas.style.pointerEvents = '';
    // viewer.html's openStationPanorama sets this on the renderer canvas directly:
    var renderEl = document.getElementById('potree_render_area');
    if (renderEl) {
      var children = renderEl.getElementsByTagName('canvas');
      for (var i = 0; i < children.length; i++) children[i].style.pointerEvents = '';
    }
  }

  function reEnablePanoramaBlocker() {
    if (!_panoBlockerFn) return;
    _panoBlockedTypes.forEach(function (t) {
      // Idempotent re-add — if already present, this is a no-op.
      document.addEventListener(t, _panoBlockerFn, true);
    });
    var renderEl = document.getElementById('potree_render_area');
    if (renderEl) {
      var children = renderEl.getElementsByTagName('canvas');
      for (var i = 0; i < children.length; i++) children[i].style.pointerEvents = 'none';
    }
  }

  // ============================================================
  // Helpers
  // ============================================================

  function el(tag, opts, children) {
    var node = document.createElement(tag);
    if (opts) {
      Object.keys(opts).forEach(function (k) {
        var v = opts[k];
        if (k === 'className') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'style') Object.assign(node.style, v);
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (k.indexOf('on') === 0 && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        }
        else node.setAttribute(k, v);
      });
    }
    if (children) {
      children.forEach(function (c) {
        if (c == null) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  function svg(name, size) {
    return window.dev2Icon(name, { size: size || 18 });
  }

  function clickLegacy(id) {
    var btn = document.getElementById(id);
    if (!btn) {
      console.warn('[dev2-chrome] legacy control not found:', id);
      flashToast('Action unavailable: ' + id);
      return;
    }
    btn.click();
  }

  function clickInsideLegacyHost(selector) {
    var host = document.getElementById('enable-legacy-host') || document.body;
    var btn = host.querySelector(selector);
    if (!btn) {
      console.warn('[dev2-chrome] selector miss:', selector);
      flashToast('Action unavailable');
      return;
    }
    btn.click();
  }

  function flashToast(msg) {
    // Reuse the existing #enable-toast if present (defined in viewer.html); else log.
    var t = document.getElementById('enable-toast');
    if (!t) { console.log('[dev2-chrome]', msg); return; }
    t.textContent = msg;
    t.style.opacity = '1';
    setTimeout(function () { t.style.opacity = '0'; }, 1800);
  }

  function projectName() {
    try {
      var params = new URLSearchParams(location.search);
      var id = params.get('p') || '';
      var p = (window.PROJECTS || {})[id];
      return (p && p.name) || id || 'Project';
    } catch (_) { return 'Project'; }
  }

  // ============================================================
  // Boot wait — chrome.js loads after viewer.html's inline script,
  // but injectMarkButtons() runs once the cloud has loaded. Poll.
  // ============================================================

  function whenLegacyReady(cb) {
    var tries = 0;
    (function tick() {
      var ok = document.getElementById('enable-sidebar-groups');
      if (ok) return cb();
      if (++tries > 120) {
        console.warn('[dev2-chrome] gave up waiting for #enable-sidebar-groups');
        return cb(); // proceed anyway — topbar will still render
      }
      setTimeout(tick, 100);
    })();
  }

  // ============================================================
  // Topbar — build groups and dropdowns
  // ============================================================

  /**
   * Each top-level group:
   *   { id, label, iconName, items: [ MenuItem | 'sep' | {label: '...'} (header) ] }
   * MenuItem:
   *   { label, iconName, kbd?, action: function() }
   */
  function topbarGroups() {
    return [
      {
        id: 'display', label: 'Point size', iconName: 'point-size',
        items: [
          { kind: 'slider', id: 'point-size', min: 0.1, max: 10.0, step: 0.1, get: function () { return readPointPrefs().size; },
            onInput: function (v) {
              applyPointCloudSettings({ size: v });
              writePointPrefs({ size: v });
            } }
        ]
      },
      {
        id: 'view', label: 'View', iconName: 'navigation',
        items: [
          { kind: 'label', text: 'Camera' },
          { label: 'Top view',         iconName: 'compass',     action: function () { proxyView('top'); } },
          { label: 'Front view',       iconName: 'frame',       action: function () { proxyView('front'); } },
          { label: 'Side view',        iconName: 'frame',       action: function () { proxyView('side'); } },
          { kind: 'sep' },
          { label: 'Fit to screen',    iconName: 'target',      kbd: 'F', action: function () { proxyView('fit'); } },
          { kind: 'sep' },
          { kind: 'label', text: 'Controls' },
          { label: 'Orbit',            iconName: 'rotate-ccw',  action: function () { proxyControl('orbit'); } },
          { label: 'Fly (FPS)',        iconName: 'move',        action: function () { proxyControl('fps'); } },
          { label: 'Earth',            iconName: 'compass',     action: function () { proxyControl('earth'); } }
        ]
      },
      {
        id: 'measure', label: 'Measure', iconName: 'ruler',
        items: [
          { label: 'Distance',         iconName: 'ruler',          action: function () { proxyMeasure('distance'); } },
          { label: 'Area',             iconName: 'square-dashed',  action: function () { proxyMeasure('area'); } },
          { label: 'Angle',            iconName: 'triangle',       action: function () { proxyMeasure('angle'); } },
          { label: 'Height',           iconName: 'minus',          action: function () { proxyMeasure('height'); } },
          { label: 'Point',            iconName: 'circle-dot',     action: function () { proxyMeasure('point'); } },
          { kind: 'sep' },
          { label: 'Volume',           iconName: 'box',            action: function () { proxyMeasure('volume'); } },
          { kind: 'sep' },
          { label: 'Export all distances', iconName: 'download',  action: function () { clickLegacy('btn-export-measurements'); } }
        ]
      },
      {
        id: 'mark', label: 'Mark', iconName: 'map-pin',
        items: [
          { label: 'New mark point',   iconName: 'plus',     kbd: 'X', action: function () { clickLegacy('btn-mark-mode'); } },
          { label: 'Clear all marks',  iconName: 'trash-2',  kbd: 'Z', action: function () { clickLegacy('btn-clear-marks'); } }
        ]
      },
      {
        id: 'constraints', label: 'Constraints', iconName: 'axis-3d',
        items: [
          { label: 'Fit plane (3+ pts)', iconName: 'layers', action: function () { clickLegacy('btn-fit-plane'); } },
          { label: 'Set axis (2 pts)',   iconName: 'axis-3d', action: function () { clickLegacy('btn-set-axis'); } }
        ]
      },
      {
        id: 'clip', label: 'Clip', iconName: 'scissors',
        items: [
          { label: 'Toggle clip box outline', iconName: 'frame',  action: function () { clickLegacy('btn-toggle-clipbox-outline'); } },
          { kind: 'sep' },
          { label: 'Add cut-out box',         iconName: 'plus',    action: function () { clickLegacy('btn-add-cutout'); } },
          { label: 'Clear all cut-outs',      iconName: 'trash-2', action: function () { clickLegacy('btn-clear-all-cutouts'); } }
        ]
      },
      {
        id: 'elevation', label: 'Elevation', iconName: 'mountain',
        items: [
          { label: 'Add elevation box',       iconName: 'plus',    action: function () { clickLegacy('btn-add-elev-box'); } },
          { label: 'Clear all boxes',         iconName: 'trash-2', action: function () { clickLegacy('btn-clear-all-elev-boxes'); } },
          { kind: 'sep' },
          { label: 'Add exclusion zone',      iconName: 'plus',    action: function () { clickLegacy('btn-add-exclusion'); } },
          { label: 'Clear exclusion zones',   iconName: 'trash-2', action: function () { clickLegacy('btn-clear-exclusions'); } },
          { label: 'Hide exclusion outlines', iconName: 'eye-off', action: function () { clickLegacy('btn-hide-exclusion-outlines'); } }
        ]
      },
      {
        id: 'members', label: 'Members', iconName: 'pencil',
        items: [
          { label: 'New member',          iconName: 'plus',     kbd: 'M', action: function () { clickLegacy('btn-add-member'); } },
          { label: 'Export DXF',          iconName: 'download', action: function () { clickLegacy('btn-export-dxf'); } }
        ]
      }
    ];
  }

  // -- View / control proxies (defensive; warn if the native control isn't found) --
  function proxyView(which) {
    var map = {
      top:   ['#top_view', '#view_top', '[data-view="top"]'],
      front: ['#front_view', '#view_front'],
      side:  ['#side_view', '#view_side'],
      fit:   ['#fit_view', '#fit-screen']
    };
    var sels = map[which] || [];
    for (var i = 0; i < sels.length; i++) {
      var found = document.querySelector(sels[i]);
      if (found) { found.click(); return; }
    }
    // Fallback: dispatch keyboard event Potree binds for some views (F = fit).
    if (which === 'fit') {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', bubbles: true }));
      return;
    }
    flashToast('View "' + which + '" not available');
  }

  function proxyControl(which) {
    var map = {
      orbit: ['#orbit_controls', '[data-control="orbit"]'],
      fps:   ['#fps_controls', '[data-control="fps"]'],
      earth: ['#earth_controls', '[data-control="earth"]']
    };
    var sels = map[which] || [];
    for (var i = 0; i < sels.length; i++) {
      var found = document.querySelector(sels[i]);
      if (found) { found.click(); return; }
    }
    flashToast('Control "' + which + '" not available');
  }

  function proxyMeasure(which) {
    // Potree's #tools is moved into #enable-meas-tools-slot by injectMarkButtons.
    // Each child <img> has src like ".../icons/distance.svg".
    var pattern = {
      distance: 'distance',
      area:     'area',
      angle:    'angle',
      height:   'height',
      point:    'point',
      volume:   'clip_volume',
      polygon:  'clip-polygon'
    }[which];
    if (!pattern) return;
    var host = document.getElementById('enable-legacy-host') || document.body;
    var candidates = host.querySelectorAll('img[src*="' + pattern + '"]');
    for (var i = 0; i < candidates.length; i++) {
      // skip ones in nested unrelated trees: must live under #tools
      if (candidates[i].closest('#tools')) {
        candidates[i].click();
        return;
      }
    }
    // Final fallback: any img whose src contains the pattern under the legacy host
    if (candidates.length > 0) { candidates[0].click(); return; }
    flashToast('Measure "' + which + '" not available');
  }

  // -- Dropdown menu logic --
  var _openMenu = null;
  function closeOpenMenu() {
    if (!_openMenu) return;
    _openMenu.trigger.setAttribute('aria-expanded', 'false');
    _openMenu.menu.dataset.open = 'false';
    _openMenu = null;
  }
  function openMenuFor(trigger, menu) {
    closeOpenMenu();
    var rect = trigger.getBoundingClientRect();
    menu.style.top  = (rect.bottom + 4) + 'px';
    menu.style.left = rect.left + 'px';
    menu.dataset.open = 'true';
    trigger.setAttribute('aria-expanded', 'true');
    _openMenu = { trigger: trigger, menu: menu };
  }

  // close dropdowns on outside click / escape
  document.addEventListener('mousedown', function (e) {
    if (!_openMenu) return;
    if (_openMenu.trigger.contains(e.target) || _openMenu.menu.contains(e.target)) return;
    closeOpenMenu();
  }, true);
  document.addEventListener('keydown', function (e) {
    // Don't swallow keys when an input/textarea is focused — that breaks
    // sidebar text editing. See feedback_keyboard_guards.md memory.
    var t = e.target;
    var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (e.key === 'Escape' && _openMenu && !typing) closeOpenMenu();
  }, true);

  function buildTopbar() {
    var topbar = document.getElementById('dev2-topbar');
    topbar.innerHTML = '';

    // Brand
    var brand = el('div', { className: 'dev2-tb-brand' }, [
      el('img', { className: 'dev2-tb-logo', src: '../EnableLogo.png', alt: 'Enable' }),
      el('span', { className: 'dev2-tb-project-name', text: projectName() })
    ]);
    topbar.appendChild(brand);

    // Group buttons
    var groupsNav = el('nav', { className: 'dev2-tb-groups' });
    var groups = topbarGroups();
    // Non-elevation groups represent a "switch tool" intent — when the user
    // picks one of their actions, we clear the focused elev box so its
    // settings disappear from the right Tool Settings panel.
    var ELEV_FRIENDLY = { elevation: 1, view: 1 };
    groups.forEach(function (g) {
      var menu = el('div', { className: 'dev2-tb-menu', id: 'dev2-menu-' + g.id, dataset: { open: 'false' } });
      g.items.forEach(function (item) {
        if (item.kind === 'sep') {
          menu.appendChild(el('div', { className: 'dev2-tb-menu-sep' }));
        } else if (item.kind === 'label') {
          menu.appendChild(el('div', { className: 'dev2-tb-menu-label', text: item.text }));
        } else if (item.kind === 'slider') {
          menu.appendChild(buildSliderMenuItem(item));
        } else if (item.kind === 'radio') {
          menu.appendChild(buildRadioMenuItem(item));
        } else {
          var miChildren = [
            svg(item.iconName, 16),
            el('span', { text: item.label })
          ];
          if (item.kbd) miChildren.push(el('span', { className: 'dev2-mi-kbd', text: item.kbd }));
          var origAction = item.action;
          menu.appendChild(el('button', {
            className: 'dev2-tb-menu-item',
            type: 'button',
            onClick: function () {
              closeOpenMenu();
              if (!ELEV_FRIENDLY[g.id] && _focusedElevBoxName) {
                _focusedElevBoxName = null;
                renderFocusedElevSection();
              }
              origAction();
            }
          }, miChildren));
        }
      });
      document.body.appendChild(menu);

      var trigger = el('button', {
        className: 'dev2-tb-btn',
        type: 'button',
        'aria-haspopup': 'menu',
        'aria-expanded': 'false',
        title: g.label,
        onClick: function (e) {
          e.stopPropagation();
          if (_openMenu && _openMenu.trigger === trigger) { closeOpenMenu(); return; }
          openMenuFor(trigger, menu);
        }
      }, [
        svg(g.iconName, 18),
        el('span', { text: g.label }),
        (function () { var c = svg('chevron-down', 14); c.classList.add('dev2-chev'); return c; })()
      ]);
      groupsNav.appendChild(trigger);
    });
    topbar.appendChild(groupsNav);

    // Right cluster
    var right = el('div', { className: 'dev2-tb-right' });
    right.appendChild(iconBtn('save',     'Save session', function () { clickLegacy('btn-save-session'); }));
    right.appendChild(iconBtn('upload',   'Load session', function () { clickLegacy('btn-load-session'); }));
    right.appendChild(iconBtn('download', 'Export distances', function () { clickLegacy('btn-export-measurements'); }));
    right.appendChild(iconBtn('eye',      'Toggle scan stations', function () { clickLegacy('btn-toggle-stations'); }));
    right.appendChild(themeToggleButton());
    right.appendChild(iconBtn('info', 'About', openAboutModal));
    topbar.appendChild(right);
  }

  function buildSliderMenuItem(item) {
    var input = el('input', {
      type: 'range',
      min: String(item.min),
      max: String(item.max),
      step: String(item.step),
      value: String(item.get())
    });
    var valueLabel = el('span', { className: 'dev2-tb-slider-val', text: Number(item.get()).toFixed(1) });
    input.addEventListener('input', function () {
      var v = parseFloat(input.value);
      valueLabel.textContent = v.toFixed(1);
      item.onInput(v);
    });
    // Prevent dragging the slider from closing the dropdown via outside-click.
    input.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    return el('div', { className: 'dev2-tb-menu-slider' }, [input, valueLabel]);
  }

  function buildRadioMenuItem(item) {
    var row = el('div', { className: 'dev2-tb-menu-radio' });
    item.options.forEach(function (opt) {
      var btn = el('button', {
        type: 'button',
        className: 'dev2-tb-menu-radio-opt',
        title: opt.hint || opt.label,
        dataset: { value: opt.value },
        onClick: function (e) {
          e.stopPropagation();
          item.onChange(opt.value);
          // Update active state on siblings
          var siblings = row.querySelectorAll('.dev2-tb-menu-radio-opt');
          for (var i = 0; i < siblings.length; i++) {
            siblings[i].classList.toggle('is-active', siblings[i].dataset.value === opt.value);
          }
        }
      }, [el('span', { text: opt.label })]);
      if (opt.value === item.get()) btn.classList.add('is-active');
      row.appendChild(btn);
    });
    return row;
  }

  function iconBtn(iconName, label, onClick) {
    return el('button', {
      className: 'dev2-tb-btn-icon',
      type: 'button',
      title: label,
      'aria-label': label,
      onClick: onClick
    }, [svg(iconName, 18)]);
  }

  function themeToggleButton() {
    function currentIcon() {
      var t = document.documentElement.dataset.theme || 'dark';
      return svg(t === 'dark' ? 'sun' : 'moon', 18);
    }
    var btn = el('button', {
      className: 'dev2-tb-btn-icon',
      type: 'button',
      id: 'dev2-theme-toggle',
      title: 'Toggle theme',
      'aria-label': 'Toggle theme',
      onClick: function () {
        var cur = document.documentElement.dataset.theme || 'dark';
        var next = (cur === 'dark') ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem('dev2.theme', next); } catch (_) {}
        btn.innerHTML = '';
        btn.appendChild(currentIcon());
      }
    });
    btn.appendChild(currentIcon());
    return btn;
  }

  function openAboutModal() {
    flashToast('Enable Point Cloud Viewer — Dev2 redesign sandbox');
  }

  // ============================================================
  // Sidebar (Objects panel) — reparent legacy list <div>s
  // ============================================================

  // Section order: object-management lists first (the things the user creates
  // while working), Scene Tree last (the underlying Potree object graph — useful
  // but rarely the primary thing).
  var SIDEBAR_SECTIONS = [
    { id: 'marks',        title: 'Marks',         iconName: 'map-pin',      slotIds: ['enable-mark-list'],          defaultOpen: true  },
    { id: 'constraints',  title: 'Constraints',   iconName: 'axis-3d',      slotIds: ['enable-constraint-list'],    defaultOpen: true  },
    { id: 'members',      title: 'Members',       iconName: 'pencil',       slotIds: ['enable-member-list'],        defaultOpen: false },
    { id: 'measurements', title: 'Measurements',  iconName: 'ruler',        slotIds: ['enable-measurement-list', 'enable-area-list', 'enable-angle-list', 'enable-volume-list'], defaultOpen: false },
    { id: 'clip',         title: 'Clip / cut-outs', iconName: 'scissors',   slotIds: ['enable-global-crop-list', 'exclusion-list'],  defaultOpen: false },
    { id: 'elevation',    title: 'Elevation boxes', iconName: 'mountain',   slotIds: ['enable-elevation-box-list'], defaultOpen: false },
    { id: 'scene',        title: 'Scene tree',    iconName: 'list-tree',    slotIds: ['enable-scene-slot'],         defaultOpen: false }
  ];

  function buildSidebar() {
    var sidebar = document.getElementById('dev2-sidebar');
    sidebar.innerHTML = '';

    SIDEBAR_SECTIONS.forEach(function (sec) {
      var body = el('div', { className: 'dev2-sb-body' });
      sec.slotIds.forEach(function (slotId) {
        var existing = document.getElementById(slotId);
        if (existing) {
          // Detach from legacy host and attach to our body — identity is preserved
          body.appendChild(existing);
        } else {
          // Create a stub div with the right ID so future dynamic appends still find it.
          body.appendChild(el('div', { id: slotId }));
        }
      });

      var headerChev = svg('chevron-down', 14);
      headerChev.classList.add('dev2-sb-chev');
      var header = el('button', {
        className: 'dev2-sb-header',
        type: 'button',
        onClick: function () {
          var open = section.dataset.expanded === 'true';
          section.dataset.expanded = open ? 'false' : 'true';
        }
      }, [
        headerChev,
        svg(sec.iconName, 14),
        el('span', { text: sec.title })
      ]);

      var section = el('div', {
        className: 'dev2-sb-section',
        id: 'dev2-sb-' + sec.id,
        dataset: { expanded: sec.defaultOpen ? 'true' : 'false' }
      }, [header, body]);

      sidebar.appendChild(section);
    });
  }

  // ============================================================
  // Right context panel — watch for dynamically injected controls
  // and pull them into the panel when they appear.
  // ============================================================

  var CONTEXT_SLOTS = [
    'enable-plane-depth-controls',
    'enable-elevation-status',
    'enable-constraint-status',
    'enable-elevation-range',
    'enable-elevation-compute',
    'enable-contour-buttons',
    'enable-contour-interval'
  ];

  function getContextBody() {
    var cp = document.getElementById('dev2-context-panel');
    var body = cp.querySelector('.dev2-cp-body');
    if (!body) {
      cp.innerHTML = '';
      var header = el('div', { className: 'dev2-cp-header' }, [
        el('span', { className: 'dev2-cp-title', text: 'Tool settings' }),
        el('button', {
          className: 'dev2-cp-close',
          type: 'button',
          title: 'Close',
          'aria-label': 'Close',
          onClick: function () { cp.dataset.open = 'false'; }
        }, [svg('x', 16)])
      ]);
      body = el('div', { className: 'dev2-cp-body' });
      cp.appendChild(header);
      cp.appendChild(body);
    }
    return body;
  }

  function adoptIntoContextPanel(node) {
    var body = getContextBody();
    body.appendChild(node);
    // IMPORTANT: do NOT force display=''. These elements live in viewer.html's
    // JS with their own visibility logic — when no tool is active they're
    // display:none on purpose. The panel must stay closed until the underlying
    // tool actually populates content.
    updateContextPanelVisibility();
  }

  function updateContextPanelVisibility() {
    var cp = document.getElementById('dev2-context-panel');
    if (!cp) return;
    // Pin overrides everything: panel stays open.
    if (document.documentElement.dataset.contextPinned === 'true') {
      cp.dataset.open = 'true';
      return;
    }
    // Transient manual-hide override — user clicked tab while content was
    // visible to dismiss it. Cleared automatically when new content arrives
    // (see clearContextHiddenIfActive() callers).
    if (document.documentElement.dataset.contextHidden === 'true') {
      cp.dataset.open = 'false';
      return;
    }
    // Otherwise, panel auto-opens iff there's visible content (active tool).
    var body = getContextBody();
    var hasContent = false;
    for (var i = 0; i < body.children.length; i++) {
      var c = body.children[i];
      if (c.dataset && c.dataset.elevHost && c.children.length === 0) continue;
      var hidden = (c.hidden === true) ||
                   (c.style && c.style.display === 'none') ||
                   (window.getComputedStyle(c).display === 'none');
      if (!hidden) { hasContent = true; break; }
    }
    cp.dataset.open = hasContent ? 'true' : 'false';
  }

  // Called whenever a tool transitions into "active" — e.g. a new elev box is
  // placed, or focus switches to a different box. Auto-clears the user's
  // manual-hide override so the panel can re-open for the new content.
  function clearContextHiddenIfActive() {
    if (document.documentElement.dataset.contextHidden === 'true') {
      delete document.documentElement.dataset.contextHidden;
    }
  }

  function startContextObserver() {
    // Scan once for elements that already exist (rare on first load, but
    // safe-guards us if some are injected synchronously before we mount).
    CONTEXT_SLOTS.forEach(function (id) {
      var n = document.getElementById(id);
      if (n && !n.closest('#dev2-context-panel')) adoptIntoContextPanel(n);
    });

    var observer = new MutationObserver(function (mutations) {
      var shouldRecheck = false;
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (n) {
          if (n.nodeType !== 1) return;
          if (CONTEXT_SLOTS.indexOf(n.id) !== -1 && !n.closest('#dev2-context-panel')) {
            adoptIntoContextPanel(n);
          } else if (n.querySelector) {
            CONTEXT_SLOTS.forEach(function (id) {
              var found = n.querySelector('#' + id);
              if (found && !found.closest('#dev2-context-panel')) adoptIntoContextPanel(found);
            });
          }
        });
        // Removal or attribute change might empty the panel
        if (m.removedNodes.length || m.type === 'attributes') shouldRecheck = true;
      });
      if (shouldRecheck) updateContextPanelVisibility();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'hidden', 'class']
    });
  }

  // ============================================================
  // Elevation box settings — focus-based right-panel display.
  //
  // Each box's dense settings (Mode / Z-base / Range / Compute /
  // Contours) lives as the SECOND child div of its wrapper inside
  // #enable-elevation-box-list, rebuilt on every
  // rebuildElevationBoxList() call. We:
  //   - extract those panels OUT of every wrapper on each rebuild
  //     (so the left sidebar only shows the compact top row)
  //   - cache them keyed by box name
  //   - display ONLY the focused box's panel in the right panel
  //
  // Focus rules:
  //   - Placing a new box auto-focuses it (so the user can immediately
  //     configure what they just made)
  //   - Click any other row in the left sidebar to switch focus
  //   - Click again on the focused row, or the X in the right-panel
  //     header, to clear focus (right panel empties out)
  //   - If the focused box is deleted, focus clears
  // ============================================================

  var _elevPanelCache = {};       // boxName -> { wrapper, panels, accent }
  var _focusedElevBoxName = null;
  var _lastSeenBoxNames = [];

  function getElevHost() {
    var body = getContextBody();
    var host = body.querySelector('[data-elev-host]');
    if (!host) {
      host = el('div', { dataset: { elevHost: 'true' }, className: 'dev2-cp-slot' });
      body.appendChild(host);
    }
    return host;
  }

  function readBoxName(wrapper, idx) {
    var topRow = wrapper.children[0];
    var nameEl = topRow ? topRow.querySelector('span:nth-of-type(2)') : null;
    return (nameEl && nameEl.textContent) || ('Box ' + (idx + 1));
  }

  function relocateElevationPanels() {
    var list = document.getElementById('enable-elevation-box-list');
    if (!list) return;

    var wrappers = Array.prototype.slice.call(list.children);
    var freshCache = {};
    var currentNames = [];

    wrappers.forEach(function (w, i) {
      var boxName = readBoxName(w, i);
      currentNames.push(boxName);

      // Extract all <div> children after the first (the settings panels).
      // Even non-focused boxes get extracted so left sidebar only shows the
      // compact top row.
      var panels = [];
      var children = Array.prototype.slice.call(w.children);
      for (var j = 1; j < children.length; j++) {
        if (children[j].tagName === 'DIV') {
          panels.push(children[j]);
          w.removeChild(children[j]);
        }
      }

      var accent = window.getComputedStyle(w).borderLeftColor || '';
      freshCache[boxName] = { wrapper: w, panels: panels, accent: accent };

      // Make the row clickable for focus switching (skip button clicks).
      var topRow = w.children[0];
      if (topRow && !topRow.dataset.dev2FocusHook) {
        topRow.style.cursor = 'pointer';
        (function (name) {
          topRow.addEventListener('click', function (e) {
            if (e.target.closest('button')) return;
            var wasFocused = _focusedElevBoxName === name;
            _focusedElevBoxName = wasFocused ? null : name;
            // Switching focus to a different box is a fresh "active tool"
            // event — clear the user's manual-hide override.
            if (!wasFocused) clearContextHiddenIfActive();
            renderFocusedElevSection();
          });
        })(boxName);
        topRow.dataset.dev2FocusHook = 'true';
      }
    });

    _elevPanelCache = freshCache;

    // Auto-focus: if a new box appeared since last rebuild, focus it.
    // Otherwise, keep current focus (if still valid).
    var newlyAdded = null;
    for (var i = 0; i < currentNames.length; i++) {
      if (_lastSeenBoxNames.indexOf(currentNames[i]) === -1) {
        newlyAdded = currentNames[i];
        break;
      }
    }
    if (newlyAdded) {
      _focusedElevBoxName = newlyAdded;
      // Placing a new box is a fresh tool-active event — clear any prior
      // manual-hide override so the panel can auto-open for this new box.
      clearContextHiddenIfActive();
    } else if (_focusedElevBoxName && currentNames.indexOf(_focusedElevBoxName) === -1) {
      _focusedElevBoxName = null; // focused box was deleted
    }
    _lastSeenBoxNames = currentNames;

    renderFocusedElevSection();
  }

  function renderFocusedElevSection() {
    var host = getElevHost();
    host.innerHTML = '';

    var name = _focusedElevBoxName;
    if (name && _elevPanelCache[name] && _elevPanelCache[name].panels.length > 0) {
      var cached = _elevPanelCache[name];
      var headerEl = el('div', { className: 'dev2-cp-elev-header' }, [
        el('span', { className: 'dev2-cp-elev-dot', style: { background: cached.accent || 'var(--accent)' } }),
        el('span', { className: 'dev2-cp-elev-name', text: name }),
        el('button', {
          className: 'dev2-cp-elev-close',
          type: 'button',
          title: 'Close settings',
          'aria-label': 'Close settings',
          onClick: function () {
            _focusedElevBoxName = null;
            renderFocusedElevSection();
          }
        }, [svg('x', 14)])
      ]);
      var section = el('div', { className: 'dev2-cp-elev-section' });
      section.appendChild(headerEl);
      cached.panels.forEach(function (p) { section.appendChild(p); });
      host.appendChild(section);
    }

    // Reflect focus in the left sidebar row styling.
    var list = document.getElementById('enable-elevation-box-list');
    if (list) {
      for (var i = 0; i < list.children.length; i++) {
        var w = list.children[i];
        var bn = readBoxName(w, i);
        if (bn === name) w.classList.add('dev2-elev-focused');
        else w.classList.remove('dev2-elev-focused');
      }
    }

    updateContextPanelVisibility();
  }

  function startElevationPanelObserver() {
    var list = document.getElementById('enable-elevation-box-list');
    if (!list) return;
    var pending = false;
    function schedule() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () {
        pending = false;
        relocateElevationPanels();
      });
    }
    var observer = new MutationObserver(schedule);
    observer.observe(list, { childList: true });
    schedule();
  }

  // ============================================================
  // Panorama dock — when a station marker is clicked, viewer.html
  // adds `.show` to #station-panorama-modal which is normally a
  // fullscreen overlay. We observe that class change and dock the
  // modal into the right context panel area instead. A toggle
  // button in the modal header switches back to fullscreen.
  // ============================================================

  function injectPanoramaButtons(modal) {
    if (modal.querySelector('[data-dev2-pano-btn]')) return;
    var header = modal.querySelector('.spm-header');
    if (!header) return;
    var fsBtn = el('button', {
      type: 'button',
      className: 'spm-close', // reuse modal's existing button skin
      'data-dev2-pano-btn': 'fullscreen',
      title: 'Toggle fullscreen',
      'aria-label': 'Toggle fullscreen',
      onClick: function () {
        modal.classList.toggle('dev2-pano-docked');
        modal.classList.toggle('dev2-pano-fullscreen');
        // Panorama's WebGL renderer reads canvas.clientWidth/Height on resize
        window.dispatchEvent(new Event('resize'));
      }
    }, [svg('frame', 16)]);
    fsBtn.style.cssText =
      'pointer-events:auto;background:rgba(0,0,0,0.5);color:#fff;' +
      'border:1px solid rgba(255,255,255,0.3);border-radius:4px;' +
      'width:32px;height:32px;cursor:pointer;padding:0;' +
      'display:inline-flex;align-items:center;justify-content:center;' +
      'margin-right:4px;';
    var close = header.querySelector('.spm-close');
    if (close) header.insertBefore(fsBtn, close);
    else header.appendChild(fsBtn);
  }

  function applyPanoramaMode(modal) {
    if (modal.classList.contains('dev2-pano-docked')) {
      document.documentElement.dataset.panoramaMode = 'docked';
      disablePanoramaBlocker();
      buildPanoramaResizeHandle(modal);
    } else if (modal.classList.contains('dev2-pano-fullscreen')) {
      document.documentElement.dataset.panoramaMode = 'fullscreen';
      reEnablePanoramaBlocker();
    } else {
      delete document.documentElement.dataset.panoramaMode;
    }
    // Reflect the active station on the cloud pin (green tint).
    var titleEl = document.getElementById('spm-title');
    var activeName = (titleEl && titleEl.textContent) || null;
    setActiveStationHighlight(activeName);
  }

  // ============================================================
  // Station pin augmentation:
  //   1. Add a sprite over each pin showing the station number, so the
  //      user can say "look at station 24" and find it in the model.
  //   2. When a panorama is open, tint that station's cone green so it's
  //      obvious which scan we're viewing from.
  //
  // Both depend on viewer.html's stations[] array, exposed via the
  // `window.__dev2` bridge at the end of the IIFE.
  // ============================================================

  var STATION_DEFAULT_COLOR = 0x4db6ff; // viewer.html buildStationPinVisual default
  var STATION_ACTIVE_COLOR  = 0x3EAD4A; // Enable green
  var _activeStationName = null;

  function getThree() { return (window.__dev2 && window.__dev2.THREE) || window.THREE; }

  function setStationConeColor(station, colorHex) {
    if (!station || !station.visual) return;
    station.visual.children.forEach(function (child) {
      if (child.userData && child.userData.isStationCone && child.material) {
        child.material.color.setHex(colorHex);
      }
    });
  }

  // Tint the camera-icon sprite material so the visible icon goes green when
  // active. The icon texture is white-ish on transparent; setting material.color
  // multiplies the texture, producing a clean recolor.
  function setStationIconColor(station, colorHex) {
    if (!station || !station.visual) return;
    station.visual.children.forEach(function (child) {
      if (child.userData && child.userData.isStationIcon && child.material) {
        child.material.color.setHex(colorHex);
      }
    });
  }

  function makeActiveRingSprite() {
    var THREE = getThree();
    if (!THREE) return null;
    var canvas = document.createElement('canvas');
    var size = 256;
    canvas.width = size; canvas.height = size;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    // Soft radial glow
    var radial = ctx.createRadialGradient(size/2, size/2, size*0.30, size/2, size/2, size*0.46);
    radial.addColorStop(0,    'rgba(62, 173, 74, 0.00)');
    radial.addColorStop(0.65, 'rgba(62, 173, 74, 0.18)');
    radial.addColorStop(0.92, 'rgba(62, 173, 74, 0.60)');
    radial.addColorStop(1.00, 'rgba(62, 173, 74, 0.00)');
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, size, size);
    // Crisp ring
    ctx.strokeStyle = 'rgba(62, 173, 74, 0.95)';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.43, 0, Math.PI * 2);
    ctx.stroke();
    var texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    var mat = new THREE.SpriteMaterial({
      map: texture, transparent: true,
      depthTest: false, depthWrite: false
    });
    var sprite = new THREE.Sprite(mat);
    sprite.userData.isStationActiveRing = true;
    sprite.renderOrder = 0; // behind icon + number
    return sprite;
  }

  function setStationActiveRing(station, isActive) {
    if (!station || !station.visual) return;
    var group = station.visual;
    var existing = group.userData.activeRing;
    if (isActive && !existing) {
      var ring = makeActiveRingSprite();
      if (!ring) return;
      var iconOffsetZ = group.userData.iconOffsetZ || 0;
      var iconScale = group.userData.iconScale || 1;
      ring.scale.set(iconScale * 2.4, iconScale * 2.4, 1);
      ring.position.set(0, 0, iconOffsetZ);
      group.add(ring);
      group.userData.activeRing = ring;
    } else if (!isActive && existing) {
      group.remove(existing);
      if (existing.material) {
        if (existing.material.map) existing.material.map.dispose();
        existing.material.dispose();
      }
      group.userData.activeRing = null;
    }
  }

  function makeNumberSprite(text) {
    var THREE = getThree();
    if (!THREE) return null;
    var canvas = document.createElement('canvas');
    var size = 128;
    canvas.width = size; canvas.height = size;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    // Round badge background for legibility against busy point clouds.
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 4;
    ctx.stroke();
    // Number text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 60px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(text), size / 2, size / 2);
    var texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    var spriteMat = new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      depthWrite: false,
      transparent: true
    });
    var sprite = new THREE.Sprite(spriteMat);
    sprite.userData.isStationNumber = true;
    sprite.renderOrder = 4;
    return sprite;
  }

  function addStationNumberLabel(station) {
    var THREE = getThree();
    if (!THREE) return;
    if (!station || !station.visual || station.visual.userData.hasNumberSprite) return;
    var sprite = makeNumberSprite(station.name);
    if (!sprite) return;
    // Position above the camera icon — use the same iconOffsetZ saved by
    // viewer.html's buildStationPinVisual + a bit more so they don't overlap.
    var iconOffsetZ = station.visual.userData.iconOffsetZ || 0;
    var iconScale = station.visual.userData.iconScale || 1;
    sprite.position.set(0, 0, iconOffsetZ + iconScale * 0.65);
    sprite.scale.set(iconScale * 0.7, iconScale * 0.7, 1);
    station.visual.add(sprite);
    station.visual.userData.hasNumberSprite = true;
    // Bump renderer so the sprite shows up immediately.
    var v = window.__dev2 && window.__dev2.viewer;
    if (v && v.repaint) v.repaint();
  }

  function decorateAllStations() {
    var dev2 = window.__dev2;
    if (!dev2 || !dev2.stations || !dev2.stations.length) return false;
    dev2.stations.forEach(addStationNumberLabel);
    return true;
  }

  function setActiveStationHighlight(activeStationName) {
    _activeStationName = activeStationName;
    var dev2 = window.__dev2;
    if (!dev2 || !dev2.stations) return;
    dev2.stations.forEach(function (st) {
      var isActive = (activeStationName != null) && (st.name === activeStationName);
      // Cone + icon both recoloured; ring sprite added only when active.
      setStationConeColor(st, isActive ? STATION_ACTIVE_COLOR : STATION_DEFAULT_COLOR);
      setStationIconColor(st, isActive ? STATION_ACTIVE_COLOR : 0xffffff);
      setStationActiveRing(st, isActive);
    });
    var v = dev2.viewer;
    if (v && v.repaint) v.repaint();
  }

  // ============================================================
  // Point cloud display settings: size, size-mode, shape.
  //
  // viewer.html defaults pointSizeType to ADAPTIVE (line 8608), which sizes
  // points inversely to octree node density — creates a visible "some big,
  // some small" pattern at zoom. We override to FIXED for uniform sizing
  // on load, then expose live controls in a Display topbar dropdown.
  // User selections persist in localStorage.
  // ============================================================

  // Point rendering mode is fixed to ADAPTIVE — it's the only one that gave
  // a usable, visibly-responsive slider in practice. FIXED and ATTENUATED
  // are removed from the UI; the user requested a single size control.
  var POINT_SIZE_DEFAULT  = 1.0;
  var POINT_MODE_DEFAULT  = 'ADAPTIVE';
  var POINT_SHAPE_DEFAULT = 'CIRCLE';

  function getActivePointcloud() {
    var v = window.__dev2 && window.__dev2.viewer;
    if (!v || !v.scene || !v.scene.pointclouds || !v.scene.pointclouds.length) return null;
    return v.scene.pointclouds[0];
  }

  function applyPointCloudSettings(opts) {
    var pc = getActivePointcloud();
    if (!pc || !pc.material) return false;
    var Potree = window.Potree;
    if (!Potree) return false;
    // Loosen the shader-side pixel clamp. Potree's defaults are minSize=2,
    // maxSize=50; in ATTENUATED mode the calculated `size * spacing * projFactor`
    // is often less than 2 for dense scans, which makes the slider feel dead.
    // We set these once per material so all three modes have meaningful range.
    if (pc.material.uniforms && pc.material.uniforms.minSize) {
      pc.material.uniforms.minSize.value = 0.6;
    }
    if (pc.material.uniforms && pc.material.uniforms.maxSize) {
      pc.material.uniforms.maxSize.value = 100;
    }
    if (opts.size != null)  pc.material.size = opts.size;
    if (opts.mode != null && Potree.PointSizeType[opts.mode] != null) {
      pc.material.pointSizeType = Potree.PointSizeType[opts.mode];
    }
    if (opts.shape != null && Potree.PointShape[opts.shape] != null) {
      pc.material.shape = Potree.PointShape[opts.shape];
    }
    var v = window.__dev2 && window.__dev2.viewer;
    if (v && v.repaint) v.repaint();
    return true;
  }

  function readPointPrefs() {
    var get = function (k, fb) {
      try { var v = localStorage.getItem(k); return v == null ? fb : v; } catch (_) { return fb; }
    };
    var size = parseFloat(get('dev2.point.size', POINT_SIZE_DEFAULT));
    if (isNaN(size) || size <= 0) size = POINT_SIZE_DEFAULT;
    return {
      size: size,
      mode: get('dev2.point.mode', POINT_MODE_DEFAULT),
      shape: get('dev2.point.shape', POINT_SHAPE_DEFAULT)
    };
  }

  function writePointPrefs(prefs) {
    try {
      if (prefs.size != null)  localStorage.setItem('dev2.point.size',  String(prefs.size));
      if (prefs.mode != null)  localStorage.setItem('dev2.point.mode',  prefs.mode);
      if (prefs.shape != null) localStorage.setItem('dev2.point.shape', prefs.shape);
    } catch (_) {}
  }

  function applySavedPointPrefsWhenReady() {
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      // Force mode + shape to ADAPTIVE/CIRCLE on every load — user removed the
      // toggle UI for these so we don't honour any stale saved values.
      var prefs = readPointPrefs();
      prefs.mode  = POINT_MODE_DEFAULT;
      prefs.shape = POINT_SHAPE_DEFAULT;
      if (applyPointCloudSettings(prefs)) {
        clearInterval(iv);
      } else if (tries > 200) {
        clearInterval(iv);
      }
    }, 100);
  }

  // ============================================================
  // Strip the opaque black background from Potree's measurement
  // edge / coordinate labels. The labels still keep their built-in
  // 4px black text stroke (TextSprite.update line ~51929) so white
  // text remains readable over the cloud — but without the rectangle
  // backdrop, overlapping labels no longer cover the points being
  // measured. World-space sprite scaling does the rest at zoom-out.
  //
  // Polled (250ms) rather than event-hooked because Potree's Measure
  // class creates new labels lazily during marker insertion and edits;
  // each loop re-checks and bails early via the alpha guard.
  // ============================================================

  function applyMinimalLabelStyle(label) {
    if (!label) return;
    // Guard: if backgroundColor is already transparent, this label has been
    // restyled — bail to avoid the texture-regeneration cost of update().
    if (label.backgroundColor && label.backgroundColor.a === 0) return;
    label.borderColor     = { r: 0,   g: 0,   b: 0,   a: 0.0 };
    label.backgroundColor = { r: 0,   g: 0,   b: 0,   a: 0.0 };
    label.textColor       = { r: 255, g: 255, b: 255, a: 1.0 };
    if (typeof label.update === 'function') label.update();
    // Enable depthTest so cloud points in front of the label hide it.
    // depthWrite stays off — billboarded label quads shouldn't poison the
    // depth buffer for other transparent overlays.
    if (label.sprite && label.sprite.material) {
      label.sprite.material.depthTest  = true;
      label.sprite.material.depthWrite = false;
    }
    if (label.material) {
      label.material.depthTest  = true;
      label.material.depthWrite = false;
    }
  }

  // ============================================================
  // Reposition edge labels so they sit at the depth of the nearer
  // measurement endpoint (instead of the world-space midpoint).
  //
  // Why: with depthTest on, a label at the midpoint of two points
  // gets occluded whenever something is in front of the midpoint —
  // which can hide labels even when the endpoints themselves are
  // visible. Placing the label along the camera→midpoint ray at
  // the nearer endpoint's distance keeps it visible whenever the
  // nearer endpoint is visible, while still projecting to a screen
  // position that's roughly between the two endpoints.
  // ============================================================

  function repositionEdgeLabel(label, A, B, camera) {
    if (!label || !A || !B || !camera) return;
    var dA = camera.position.distanceTo(A);
    var dB = camera.position.distanceTo(B);
    var nearerDepth = (dA < dB) ? dA : dB;
    var M = A.clone().add(B).multiplyScalar(0.5);
    var ray = M.sub(camera.position);
    var rayLen = ray.length();
    if (rayLen < 1e-4) return;
    ray.multiplyScalar(nearerDepth / rayLen);
    label.position.copy(camera.position).add(ray);
  }

  function updateMeasurementLabelDepths() {
    var v = window.__dev2 && window.__dev2.viewer;
    if (!v || !v.scene || !v.scene.measurements) return;
    var camera = v.scene.getActiveCamera();
    if (!camera) return;
    var ms = v.scene.measurements;
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      if (!m.edgeLabels || !m.points) continue;
      for (var j = 0; j < m.edgeLabels.length && j + 1 < m.points.length; j++) {
        var A = m.points[j].position;
        var B = m.points[j + 1].position;
        repositionEdgeLabel(m.edgeLabels[j], A, B, camera);
      }
    }
  }

  // --- Edge-label depth-test scene ---
  //
  // Why a separate scene: Potree's EDL renderer renders the main scene
  // (including measurements + their child labels) BEFORE the depth-blit
  // pass that writes the cloud's depth back to the screen buffer. So
  // labels with depthTest=true rendered as part of viewer.scene.scene
  // see an empty depth buffer and end up always-on-top.
  //
  // What we do: reparent every Measure.edgeLabel into _edgeLabelScene
  // (it sits at world origin so coords are preserved), then render that
  // scene during render.pass.depth_overlay — which fires AFTER the
  // depth-blit (see potree.js EDLRenderer.render line 70885). Labels in
  // this pass test against the real cloud depth and get hidden behind
  // points correctly. The original Measure object never sees the labels
  // again, but that's fine — Measure.update() only sets their position,
  // which works regardless of parentage.

  var _edgeLabelScene = null;

  function getEdgeLabelScene() {
    if (_edgeLabelScene) return _edgeLabelScene;
    var THREE = getThree();
    if (!THREE) return null;
    _edgeLabelScene = new THREE.Scene();
    _edgeLabelScene.name = 'Dev2EdgeLabelScene';
    // The sphere markers use MeshLambertMaterial (potree.js:53916) which is a
    // lit material — without a light in this scene the spheres render black.
    // (We also swap them to MeshBasicMaterial on adoption; the light is a
    // safety net in case any other lit material lands here.)
    _edgeLabelScene.add(new THREE.AmbientLight(0xffffff, 1.0));
    // Register with Potree's input handler so the reparented spheres remain
    // pickable for drag-to-reposition. getHoveredElements (potree.js:81795)
    // only traverses interactiveScenes + viewer.scene.scene — without this,
    // our adopted spheres are invisible to the raycaster.
    var v = window.__dev2 && window.__dev2.viewer;
    if (v && v.inputHandler && typeof v.inputHandler.registerInteractiveScene === 'function') {
      v.inputHandler.registerInteractiveScene(_edgeLabelScene);
    }
    return _edgeLabelScene;
  }

  function enableDepthTestRecursive(obj) {
    if (!obj) return;
    if (obj.material) {
      // For Line2 / LineMaterial, depthTest is also on .material
      obj.material.depthTest = true;
      // Spheres/markers and labels: depthWrite false is safer (avoid blocking
      // other overlays), but for solid sphere markers depthWrite=true is fine
      // and gives better self-occlusion.
      if (obj.material.transparent !== false && !(obj.isMesh && !obj.material.transparent)) {
        obj.material.depthWrite = false;
      }
    }
    if (obj.sprite && obj.sprite.material) {
      obj.sprite.material.depthTest  = true;
      obj.sprite.material.depthWrite = false;
    }
    // TextSprite's child Sprite has its own material — handled above
    if (obj.children) {
      for (var i = 0; i < obj.children.length; i++) enableDepthTestRecursive(obj.children[i]);
    }
  }

  function adoptIntoDepthScene(obj) {
    var scene = getEdgeLabelScene();
    if (!scene || !obj || obj.parent === scene) return;
    if (obj.parent) obj.parent.remove(obj);
    scene.add(obj);
    swapLambertToBasic(obj);
    enableDepthTestRecursive(obj);
  }

  // Potree builds measurement sphere markers with MeshLambertMaterial
  // (potree.js:53916–53924). Lambert is a lit material — our depth-test scene
  // has no lights of the right kind, so the spheres render black. We swap them
  // to MeshBasicMaterial (unlit, just the diffuse color), which is also what
  // we want visually for a flat-shaded marker dot. Potree's update() still
  // writes `sphere.material.color = this.color` (line 54256) which works
  // identically on the new material.
  function swapLambertToBasic(obj) {
    if (!obj || !obj.material) return;
    if (!obj.material.isMeshLambertMaterial) return;
    var THREE = getThree();
    if (!THREE) return;
    var src = obj.material;
    var basic = new THREE.MeshBasicMaterial({
      color: src.color ? src.color.clone() : new THREE.Color(0xff0000),
      transparent: !!src.transparent,
      opacity: src.opacity != null ? src.opacity : 1,
      depthTest: true,
      depthWrite: false
    });
    src.dispose();
    obj.material = basic;
  }

  function harvestAndPruneEdgeLabels() {
    var v = window.__dev2 && window.__dev2.viewer;
    if (!v || !v.scene || !v.scene.measurements) return;
    var scene = getEdgeLabelScene();
    if (!scene) return;
    var valid = new Set();

    // Reparent every visible part of every Measure into our depth-tested scene.
    // Lists Potree maintains on each Measure (see potree.js:53884–53892):
    //   spheres        — red dot markers (Mesh)
    //   edges          — red connecting lines (Line2)
    //   edgeLabels     — 3D/XY/Z value labels (TextSprite)
    //   coordinateLabels, sphereLabels, angleLabels — other label types
    //   heightEdge / heightLabel / areaLabel — only for those measure modes
    // We harvest each per frame; new ones (created during marker insertion)
    // get caught on the next tick.
    var groups = ['spheres', 'edges', 'edgeLabels', 'coordinateLabels',
                  'sphereLabels', 'angleLabels'];
    var singletons = ['heightEdge', 'heightLabel', 'areaLabel'];

    v.scene.measurements.forEach(function (m) {
      groups.forEach(function (key) {
        var arr = m[key];
        if (!arr || !arr.length) return;
        arr.forEach(function (item) {
          if (!item) return;
          valid.add(item);
          adoptIntoDepthScene(item);
        });
      });
      singletons.forEach(function (key) {
        var item = m[key];
        if (!item) return;
        // Only adopt if it's actually visible — e.g. heightLabel exists on
        // every Measure but is invisible for non-height measurements.
        if (item.visible) {
          valid.add(item);
          adoptIntoDepthScene(item);
        }
      });
    });

    // Also harvest Enable's custom D# labels from the legacy measureLabelScene.
    // They render in perspective_overlay (which fires after clearDepth, with no
    // depth available), so they always appear on top. Moving them into our
    // depth-aware scene fixes that.
    var legacyD = window.__dev2 && window.__dev2.measureLabelScene;
    if (legacyD && legacyD.children) {
      // Copy array because we mutate parentage during iteration.
      var kids = legacyD.children.slice();
      for (var i = 0; i < kids.length; i++) {
        var lbl = kids[i];
        if (lbl && lbl.userData && lbl.userData.isMeasureLabel) {
          valid.add(lbl);
          adoptIntoDepthScene(lbl);
        }
      }
    }

    // Prune objects that no longer belong to any Measure (e.g. after removeMarker
    // or measurement deletion). Skip removal for items that just lost their
    // valid registration this frame — only delete on the next pass to avoid
    // disposal races with Potree's internal cleanup.
    var stale = [];
    for (var i = 0; i < scene.children.length; i++) {
      if (!valid.has(scene.children[i])) stale.push(scene.children[i]);
    }
    stale.forEach(function (obj) {
      scene.remove(obj);
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
      }
      if (obj.geometry) obj.geometry.dispose();
      if (obj.sprite && obj.sprite.material) {
        if (obj.sprite.material.map) obj.sprite.material.map.dispose();
        obj.sprite.material.dispose();
      }
    });
  }

  function startEdgeLabelDepthLoop() {
    var v = window.__dev2 && window.__dev2.viewer;
    if (!v) return;
    // Hook the depth_overlay pass — fires after Potree blits cloud depth
    // back to the screen buffer, so depthTest finally works.
    v.addEventListener('render.pass.depth_overlay', function () {
      var scene = getEdgeLabelScene();
      var camera = v.scene && v.scene.getActiveCamera && v.scene.getActiveCamera();
      if (!scene || !camera) return;
      try { v.renderer.render(scene, camera); }
      catch (err) { /* swallow — happens briefly while measurements rebuild */ }
    });
    // Per-frame: harvest new labels, reposition at nearer-point depth, prune.
    function tick() {
      harvestAndPruneEdgeLabels();
      updateMeasurementLabelDepths();
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function destyleMeasurementLabels() {
    var v = window.__dev2 && window.__dev2.viewer;
    if (!v || !v.scene || !v.scene.measurements) return;
    var ms = v.scene.measurements;
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      if (m.edgeLabels) {
        for (var j = 0; j < m.edgeLabels.length; j++) applyMinimalLabelStyle(m.edgeLabels[j]);
      }
      if (m.coordinateLabels) {
        for (var k = 0; k < m.coordinateLabels.length; k++) applyMinimalLabelStyle(m.coordinateLabels[k]);
      }
      // Area / height labels — same treatment if present.
      if (m.heightLabel) applyMinimalLabelStyle(m.heightLabel);
      if (m.areaLabel)   applyMinimalLabelStyle(m.areaLabel);
      if (m.angleLabels) {
        for (var a = 0; a < m.angleLabels.length; a++) applyMinimalLabelStyle(m.angleLabels[a]);
      }
    }
  }

  function startMeasurementLabelRestyler() {
    setInterval(destyleMeasurementLabels, 250);
    // First pass once viewer is ready
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      if (window.__dev2 && window.__dev2.viewer) {
        destyleMeasurementLabels();
        clearInterval(iv);
      } else if (tries > 200) {
        clearInterval(iv);
      }
    }, 100);
  }

  function startStationDecorations() {
    // Stations load asynchronously after the cloud's bounding box is ready.
    // Poll for them to appear (manifest fetch happens once; population is
    // synchronous after the fetch resolves).
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      if (decorateAllStations()) {
        clearInterval(iv);
      } else if (tries > 200) { // 20 s — manifest just didn't load
        clearInterval(iv);
      }
    }, 100);
  }

  function startPanoramaDockObserver() {
    var modal = document.getElementById('station-panorama-modal');
    if (!modal) return;
    // Guard: prevents the observer from reacting to its own classList writes.
    // Without this, removing our mode classes on close re-fires the observer,
    // and any unexpected re-trigger from elsewhere can spiral.
    var selfMutating = false;
    var observer = new MutationObserver(function (mutations) {
      if (selfMutating) return;
      mutations.forEach(function (m) {
        if (m.type !== 'attributes' || m.attributeName !== 'class') return;
        if (modal.classList.contains('show')) {
          if (!modal.classList.contains('dev2-pano-docked') &&
              !modal.classList.contains('dev2-pano-fullscreen')) {
            selfMutating = true;
            modal.classList.add('dev2-pano-docked');
            selfMutating = false;
            window.dispatchEvent(new Event('resize'));
          }
          applyPanoramaMode(modal);
          injectPanoramaButtons(modal);
        } else {
          // Strip mode classes so the NEXT panorama open defaults back to docked.
          if (modal.classList.contains('dev2-pano-docked') ||
              modal.classList.contains('dev2-pano-fullscreen')) {
            selfMutating = true;
            modal.classList.remove('dev2-pano-docked', 'dev2-pano-fullscreen');
            selfMutating = false;
          }
          delete document.documentElement.dataset.panoramaMode;
          setActiveStationHighlight(null);
        }
      });
    });
    observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
  }

  // ============================================================
  // Generic left-edge resize handle.
  //
  // Used by both the right context panel (--context-panel-width)
  // and the docked panorama (--panorama-width). Each owner provides
  // its own CSS variable name, persistence key, and min/max.
  // ============================================================

  var MIN_PANEL_PX = 225;
  function maxContextPx()  { return Math.max(MIN_PANEL_PX + 100, Math.round(window.innerWidth * 0.85)); }
  function maxPanoramaPx() { return Math.max(MIN_PANEL_PX + 100, Math.round(window.innerWidth * 0.50)); }

  /**
   * @param {HTMLElement} element   panel whose width is driven
   * @param {object} cfg            { cssVar, storageKey, min, max, klass }
   */
  function attachLeftResizeHandle(element, cfg) {
    if (!element || element.querySelector('.' + cfg.klass)) return;
    var handle = el('div', {
      className: 'dev2-cp-resize ' + cfg.klass,
      title: 'Drag to resize',
      'aria-label': 'Drag to resize panel'
    });
    element.appendChild(handle);

    var dragging = false;
    var pendingResize = false;
    handle.addEventListener('mousedown', function (e) {
      dragging = true;
      document.documentElement.classList.add('dev2-dragging');
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
      // Belt-and-suspenders: disable pointer-events on the cloud canvas
      // while dragging so subsequent mousemoves can't reach Potree's input
      // handler. This kills any chance of the model orbiting during a drag.
      setCloudCanvasInteractive(false);
      e.preventDefault();
      e.stopImmediatePropagation();
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var newWidth = window.innerWidth - e.clientX;
      // Layout: Tool Settings sits at right:0 (rightmost). Panorama, when
      // docked, sits at right:0 by default, or at right:--context-panel-width
      // when both panels are visible. So when dragging the panorama handle
      // while context is open, subtract context width from the raw delta.
      if (cfg.cssVar === '--panorama-width') {
        var cp = document.getElementById('dev2-context-panel');
        if (cp && cp.dataset.open === 'true') {
          var cw = parseInt(window.getComputedStyle(document.documentElement)
                             .getPropertyValue('--context-panel-width'), 10) || 225;
          newWidth = window.innerWidth - e.clientX - cw;
        }
      }
      var max = (typeof cfg.max === 'function') ? cfg.max() : cfg.max;
      newWidth = Math.max(cfg.min, Math.min(max, newWidth));
      document.documentElement.style.setProperty(cfg.cssVar, newWidth + 'px');
      if (!pendingResize) {
        pendingResize = true;
        requestAnimationFrame(function () {
          pendingResize = false;
          window.dispatchEvent(new Event('resize'));
        });
      }
    });
    document.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      document.documentElement.classList.remove('dev2-dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setCloudCanvasInteractive(true);
      var w = document.documentElement.style.getPropertyValue(cfg.cssVar);
      try { localStorage.setItem(cfg.storageKey, w); } catch (_) {}
      window.dispatchEvent(new Event('resize'));
    });
  }

  function setCloudCanvasInteractive(interactive) {
    var renderEl = document.getElementById('potree_render_area');
    if (!renderEl) return;
    var canvases = renderEl.getElementsByTagName('canvas');
    for (var i = 0; i < canvases.length; i++) {
      canvases[i].style.pointerEvents = interactive ? '' : 'none';
    }
  }

  function buildContextResizeHandle() {
    var cp = document.getElementById('dev2-context-panel');
    if (!cp) return;
    attachLeftResizeHandle(cp, {
      cssVar: '--context-panel-width',
      storageKey: 'dev2.context.width',
      min: MIN_PANEL_PX,
      max: maxContextPx,
      klass: 'dev2-cp-resize-context'
    });
  }

  function buildPanoramaResizeHandle(modal) {
    attachLeftResizeHandle(modal, {
      cssVar: '--panorama-width',
      storageKey: 'dev2.panorama.width',
      min: MIN_PANEL_PX,
      max: maxPanoramaPx,
      klass: 'dev2-cp-resize-pano'
    });
  }

  // ============================================================
  // Hide-the-legacy-chrome step
  // ============================================================

  function reparentLegacyHost() {
    var groups = document.getElementById('enable-sidebar-groups');
    var host   = document.getElementById('enable-legacy-host');
    if (!groups || !host) return;
    if (groups.parentNode === host) return;
    host.appendChild(groups);
  }

  // ============================================================
  // Boot
  // ============================================================

  function buildSidebarToggle() {
    if (document.getElementById('dev2-sidebar-toggle')) return;
    var btn = el('button', {
      id: 'dev2-sidebar-toggle',
      type: 'button',
      title: 'Collapse sidebar',
      'aria-label': 'Collapse sidebar',
      onClick: function () {
        var collapsed = document.documentElement.dataset.sidebarCollapsed === 'true';
        var next = !collapsed;
        if (next) document.documentElement.dataset.sidebarCollapsed = 'true';
        else delete document.documentElement.dataset.sidebarCollapsed;
        try { localStorage.setItem('dev2.sidebar.collapsed', next ? 'true' : 'false'); } catch (_) {}
        btn.title = next ? 'Expand sidebar' : 'Collapse sidebar';
        btn.setAttribute('aria-label', btn.title);
        // Nudge Potree to recompute its WebGL canvas size after the layout shift.
        window.dispatchEvent(new Event('resize'));
      }
    }, [svg('chevron-right', 14)]);
    document.body.appendChild(btn);
  }

  function buildContextToggle() {
    if (document.getElementById('dev2-context-toggle')) return;
    var btn = el('button', {
      id: 'dev2-context-toggle',
      type: 'button',
      title: 'Show / hide Tool Settings',
      'aria-label': 'Show / hide Tool Settings',
      onClick: function () {
        var cp = document.getElementById('dev2-context-panel');
        var isOpen = cp && cp.dataset.open === 'true';
        if (isOpen) {
          // Close: unpin (if pinned) AND set transient hide flag so the panel
          // disappears even when there's active content. The flag is cleared
          // automatically when new content arrives (see clearContextHiddenIfActive).
          if (document.documentElement.dataset.contextPinned === 'true') {
            delete document.documentElement.dataset.contextPinned;
            try { localStorage.setItem('dev2.context.pinned', 'false'); } catch (_) {}
          }
          document.documentElement.dataset.contextHidden = 'true';
          btn.title = 'Show Tool Settings';
        } else {
          // Open from a hidden state: pin so the panel stays open even
          // without active content. Clear any transient hide override.
          document.documentElement.dataset.contextPinned = 'true';
          delete document.documentElement.dataset.contextHidden;
          try { localStorage.setItem('dev2.context.pinned', 'true'); } catch (_) {}
          btn.title = 'Hide Tool Settings';
        }
        btn.setAttribute('aria-label', btn.title);
        updateContextPanelVisibility();
        window.dispatchEvent(new Event('resize'));
      }
    }, [svg('chevron-right', 14)]);
    document.body.appendChild(btn);
  }

  function init() {
    whenLegacyReady(function () {
      reparentLegacyHost();
      buildTopbar();
      buildSidebar();
      buildSidebarToggle();
      buildContextToggle();
      buildContextResizeHandle();
      startContextObserver();
      startElevationPanelObserver();
      startPanoramaDockObserver();
      startStationDecorations();
      applySavedPointPrefsWhenReady();
      startMeasurementLabelRestyler();
      startEdgeLabelDepthLoop();
      // Ensure context panel starts closed (auto-opens when content arrives)
      var cp = document.getElementById('dev2-context-panel');
      if (cp) cp.dataset.open = 'false';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
