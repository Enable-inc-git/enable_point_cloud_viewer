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

  // ---- Apply state synchronously (before first paint) ----
  // Theme is locked to dark; light mode CSS still ships but is unreachable
  // from the UI. (Removed the user toggle per request.)
  (function applyEarlyState() {
    var savedSidebar = null, savedPinned = null;
    var savedCtxWidth = null, savedPanoWidth = null;
    try { savedSidebar   = localStorage.getItem('dev2.sidebar.collapsed'); } catch (_) {}
    try { savedPinned    = localStorage.getItem('dev2.context.pinned'); } catch (_) {}
    try { savedCtxWidth  = localStorage.getItem('dev2.context.width'); } catch (_) {}
    try { savedPanoWidth = localStorage.getItem('dev2.panorama.width'); } catch (_) {}
    document.documentElement.dataset.theme = 'dark';
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
          { kind: 'label', text: 'Camera angle' },
          { label: 'Top',           iconName: 'compass',     action: function () { callViewer('setTopView'); } },
          { label: 'Bottom',        iconName: 'compass',     action: function () { callViewer('setBottomView'); } },
          { label: 'Front',         iconName: 'frame',       action: function () { callViewer('setFrontView'); } },
          { label: 'Back',          iconName: 'frame',       action: function () { callViewer('setBackView'); } },
          { label: 'Left',          iconName: 'frame',       action: function () { callViewer('setLeftView'); } },
          { label: 'Right',         iconName: 'frame',       action: function () { callViewer('setRightView'); } },
          { kind: 'sep' },
          { label: 'Fit to screen', iconName: 'target', kbd: 'F', action: function () { callViewer('fitToScreen'); } },
          { kind: 'sep' },
          { kind: 'label', text: 'Projection' },
          { kind: 'radio', id: 'projection',
            get: function () { return readProjectionMode(); },
            options: [
              { value: 'PERSPECTIVE',  label: 'Perspective' },
              { value: 'ORTHOGRAPHIC', label: 'Orthographic' }
            ],
            onChange: function (v) { setCameraMode(v); }
          }
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
        id: 'notes', label: 'Notes', iconName: 'sticky-note',
        items: [
          { label: 'Add note',         iconName: 'plus',     action: function () { clickLegacy('btn-add-note'); } }
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

  // -- View + control invocation via the viewer API (exposed by window.__dev2) --
  // viewer methods: setTopView/setBottomView/setFrontView/setBackView/setLeftView/
  //                 setRightView/fitToScreen (potree.js:80928-80958 confirms)
  function callViewer(methodName) {
    var v = window.__dev2 && window.__dev2.viewer;
    if (!v || typeof v[methodName] !== 'function') {
      flashToast('"' + methodName + '" not available');
      return;
    }
    try { v[methodName](); }
    catch (err) { console.warn('[dev2]', methodName, 'threw:', err); flashToast(methodName + ' failed'); }
  }

  // -- Projection mode (perspective / orthographic) --
  // viewer.setCameraMode(Potree.CameraMode.PERSPECTIVE | .ORTHOGRAPHIC)
  function readProjectionMode() {
    var v = window.__dev2 && window.__dev2.viewer;
    if (!v) return 'PERSPECTIVE';
    var cam = v.scene && v.scene.getActiveCamera && v.scene.getActiveCamera();
    if (cam && cam.isOrthographicCamera) return 'ORTHOGRAPHIC';
    return 'PERSPECTIVE';
  }

  function setCameraMode(mode) {
    var v = window.__dev2 && window.__dev2.viewer;
    var P = window.Potree;
    if (!v || typeof v.setCameraMode !== 'function' || !P || !P.CameraMode || P.CameraMode[mode] == null) {
      flashToast('Camera mode "' + mode + '" not available');
      return;
    }
    try { v.setCameraMode(P.CameraMode[mode]); }
    catch (err) { console.warn('[dev2] setCameraMode threw:', err); flashToast(mode + ' failed'); }
  }

  function proxyMeasure(which) {
    var v = window.__dev2 && window.__dev2.viewer;
    if (!v) { flashToast('Viewer not ready'); return; }
    try {
      switch (which) {
        case 'distance':
          v.measuringTool.startInsertion({
            showDistances: true, showArea: false, closed: false, name: 'Distance' });
          return;
        case 'area':
          v.measuringTool.startInsertion({
            showDistances: true, showArea: true, closed: true, name: 'Area' });
          return;
        case 'angle':
          v.measuringTool.startInsertion({
            showDistances: false, showAngles: true, showArea: false,
            closed: true, maxMarkers: 3, name: 'Angle' });
          return;
        case 'height':
          v.measuringTool.startInsertion({
            showDistances: false, showHeight: true, showArea: false,
            closed: false, maxMarkers: 2, name: 'Height' });
          return;
        case 'point':
          v.measuringTool.startInsertion({
            showDistances: false, showAngles: false, showCoordinates: true,
            showArea: false, closed: true, maxMarkers: 1, name: 'Point' });
          return;
        case 'volume':
          var vol = v.volumeTool.startInsertion();
          if (vol) vol.userData.isDev2VolumeMeasurement = true;
          return;
        case 'polygon':
          v.clippingTool.startInsertion({ type: 'polygon' });
          return;
      }
    } catch (err) {
      console.warn('[dev2] measure "' + which + '" failed:', err);
      flashToast('Measure "' + which + '" failed');
    }
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

  // -- Top-toolbar horizontal scroll. The tool-group row can overflow when many
  //    tools are present; arrows appear only when it actually overflows. --
  var _tbGroupsNav = null, _tbScrollArrowL = null, _tbScrollArrowR = null, _tbScrollBound = false;

  function updateTbScrollArrows() {
    var nav = _tbGroupsNav;
    if (!nav) return;
    var max = nav.scrollWidth - nav.clientWidth;
    if (nav.parentNode) nav.parentNode.classList.toggle('has-overflow', max > 2);
    if (_tbScrollArrowL) _tbScrollArrowL.disabled = nav.scrollLeft <= 1;
    if (_tbScrollArrowR) _tbScrollArrowR.disabled = nav.scrollLeft >= max - 1;
  }

  function scrollTbGroups(dir) {
    var nav = _tbGroupsNav;
    if (!nav) return;
    nav.scrollBy({ left: dir * Math.max(160, nav.clientWidth * 0.6), behavior: 'smooth' });
  }

  function buildTopbar() {
    var topbar = document.getElementById('dev2-topbar');
    topbar.innerHTML = '';

    // ---- Brand area (logo + project name) — width matches the sidebar so the
    //      first tool aligns with the canvas's left edge. ----
    var brandArea = el('div', { className: 'dev2-tb-brand-area' }, [
      el('div', { className: 'dev2-tb-brand-main' }, [
        el('img', { className: 'dev2-tb-logo', src: '../EnableLogo.png', alt: 'Enable' }),
        el('span', { className: 'dev2-tb-project-name', text: projectName() })
      ]),
      // Company contact, tight beside the logo/title — same font as the project
      // name, two stacked lines that fit the existing bar height. Lives INSIDE
      // the fixed-width brand area, so the tools keep their original position.
      el('div', { className: 'dev2-tb-contact' }, [
        el('a', { className: 'dev2-tb-contact-line', href: 'https://www.enable-inc.com', target: '_blank', rel: 'noopener', text: 'www.enable-inc.com' }),
        el('a', { className: 'dev2-tb-contact-line', href: 'mailto:info@enable-inc.com', text: 'info@enable-inc.com' })
      ])
    ]);
    topbar.appendChild(brandArea);

    // ---- Tool dropdowns ----
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

    // Wrap the tool groups in a horizontal scroller with left/right arrows that
    // appear only when the groups overflow the available width.
    _tbGroupsNav = groupsNav;
    _tbScrollArrowL = el('button', {
      className: 'dev2-tb-scroll-arrow dev2-tb-scroll-left', type: 'button',
      title: 'Scroll tools left', onClick: function () { scrollTbGroups(-1); }
    }, [ (function () { var c = svg('chevron-right', 18); c.classList.add('dev2-tb-arrow-flip'); return c; })() ]);
    _tbScrollArrowR = el('button', {
      className: 'dev2-tb-scroll-arrow dev2-tb-scroll-right', type: 'button',
      title: 'Scroll tools right', onClick: function () { scrollTbGroups(1); }
    }, [ svg('chevron-right', 18) ]);
    var groupsWrap = el('div', { className: 'dev2-tb-groups-wrap' }, [ _tbScrollArrowL, groupsNav, _tbScrollArrowR ]);
    topbar.appendChild(groupsWrap);

    groupsNav.addEventListener('scroll', updateTbScrollArrows);
    if (!_tbScrollBound) { window.addEventListener('resize', updateTbScrollArrows); _tbScrollBound = true; }
    // Defer until layout settles so scrollWidth/clientWidth are accurate.
    setTimeout(updateTbScrollArrows, 0);
    if (window.requestAnimationFrame) requestAnimationFrame(updateTbScrollArrows);

    // ---- Meta actions on the right (save / load / export / vis / undo / redo / about) ----
    topbar.appendChild(el('div', { className: 'dev2-tb-flex-spacer' }));
    var meta = el('div', { className: 'dev2-tb-right' });
    meta.appendChild(iconBtn('save',     'Save session',           function () { clickLegacy('btn-save-session'); }));
    meta.appendChild(iconBtn('upload',   'Load session',           function () { clickLegacy('btn-load-session'); }));
    meta.appendChild(iconBtn('download', 'Export distances',       function () { clickLegacy('btn-export-measurements'); }));
    meta.appendChild(iconBtn('eye',      'Toggle annotations (stations + notes)', function () { clickLegacy('btn-toggle-stations'); }));
    meta.appendChild(iconBtn('undo',     'Undo (Ctrl+Z)',          function () {
      var d = window.__dev2; if (d && typeof d.performUndo === 'function') d.performUndo();
    }));
    meta.appendChild(iconBtn('redo',     'Redo (Ctrl+Y / Ctrl+Shift+Z)', function () {
      var d = window.__dev2;
      if (d && typeof d.performRedo === 'function') d.performRedo();
      else flashToast('Nothing to redo');
    }));
    meta.appendChild(iconBtn('info',     'About',                  openAboutModal));
    topbar.appendChild(meta);
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
    flashToast('Enable Point Cloud Viewer');
  }

  // ============================================================
  // Sidebar (Objects panel) — reparent legacy list <div>s
  // ============================================================

  // Section order: object-management lists first (the things the user creates
  // while working), Scene Tree last (the underlying Potree object graph — useful
  // but rarely the primary thing).
  var SIDEBAR_SECTIONS = [
    { id: 'views',        title: 'Saved Views',   iconName: 'frame',        slotIds: ['enable-views-list'],         defaultOpen: true  },
    { id: 'marks',        title: 'Marks',         iconName: 'map-pin',      slotIds: ['enable-mark-list'],          defaultOpen: true  },
    { id: 'notes',        title: 'Notes',         iconName: 'sticky-note',  slotIds: ['enable-note-list'],          defaultOpen: false },
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
    'enable-models-panel',
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
  // Area + Volume interior shading.
  //
  // Potree renders area measurements as edge segments + a centroid label
  // and clip-box / box-volume measurements as wireframes; neither fills
  // the interior. We add a translucent green fill mesh for area polygons
  // (fan-triangulated from the centroid each frame so dragging a point
  // keeps the fill in sync) and a translucent green BoxGeometry mesh for
  // each Potree BoxVolume that lives in viewer.scene.volumes.
  // ============================================================

  var AREA_FILL_COLOR   = 0x39ff14;
  var AREA_FILL_OPACITY = 0.16;

  function ensureAreaFill(measure) {
    var THREE = (window.__dev2 && window.__dev2.THREE) || window.THREE;
    if (!THREE || !measure || !measure.showArea) return;
    if (!measure.points || measure.points.length < 3) {
      if (measure._dev2AreaFill) {
        measure.remove(measure._dev2AreaFill);
        if (measure._dev2AreaFill.geometry) measure._dev2AreaFill.geometry.dispose();
        if (measure._dev2AreaFill.material) measure._dev2AreaFill.material.dispose();
        measure._dev2AreaFill = null;
      }
      return;
    }
    if (!measure._dev2AreaFill) {
      var geom = new THREE.BufferGeometry();
      var mat = new THREE.MeshBasicMaterial({
        color: AREA_FILL_COLOR,
        transparent: true,
        opacity: AREA_FILL_OPACITY,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: false
      });
      var mesh = new THREE.Mesh(geom, mat);
      mesh.userData.isAreaFill = true;
      mesh.renderOrder = -1; // render before edge labels
      measure.add(mesh);
      measure._dev2AreaFill = mesh;
    }
    // Fan-triangulate from the centroid. Works for convex polygons. Concave
    // polygons will have minor overlap artefacts, but for typical CAD use
    // (rectangular slabs, building outlines) this is fine.
    var pts = measure.points;
    var n = pts.length;
    var centroid = new THREE.Vector3();
    for (var i = 0; i < n; i++) centroid.add(pts[i].position);
    centroid.multiplyScalar(1 / n);
    var verts = new Float32Array((n) * 3 * 3);
    var v = 0;
    for (var i = 0; i < n; i++) {
      var a = pts[i].position;
      var b = pts[(i + 1) % n].position;
      verts[v++] = centroid.x; verts[v++] = centroid.y; verts[v++] = centroid.z;
      verts[v++] = a.x;        verts[v++] = a.y;        verts[v++] = a.z;
      verts[v++] = b.x;        verts[v++] = b.y;        verts[v++] = b.z;
    }
    var geo = measure._dev2AreaFill.geometry;
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.computeBoundingSphere();
  }

  function ensureVolumeFill(volume) {
    var THREE = (window.__dev2 && window.__dev2.THREE) || window.THREE;
    if (!THREE || !volume) return;
    // Only fill BoxVolumes that we tagged when creating them via the Measure
    // → Volume tool. Skips the initial clip box, cut-outs, elevation boxes,
    // exclusion zones, anything restored from a session that wasn't tagged.
    if (!volume.userData || !volume.userData.isDev2VolumeMeasurement) return;
    if (volume._dev2VolumeFill) return;
    var geom = new THREE.BoxGeometry(1, 1, 1);
    var mat = new THREE.MeshBasicMaterial({
      color: AREA_FILL_COLOR,
      transparent: true,
      opacity: AREA_FILL_OPACITY,
      depthTest: true,
      depthWrite: false
    });
    var mesh = new THREE.Mesh(geom, mat);
    mesh.userData.isVolumeFill = true;
    volume.add(mesh);
    volume._dev2VolumeFill = mesh;
  }

  function startAreaVolumeFillObserver() {
    var seen = new WeakSet();
    function tick() {
      var v = window.__dev2 && window.__dev2.viewer;
      if (v && v.scene) {
        if (v.scene.measurements) {
          for (var i = 0; i < v.scene.measurements.length; i++) {
            ensureAreaFill(v.scene.measurements[i]);
          }
        }
        if (v.scene.volumes) {
          for (var j = 0; j < v.scene.volumes.length; j++) {
            ensureVolumeFill(v.scene.volumes[j]);
          }
        }
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
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

  // Set depthTest on every material in obj's subtree based on whether the
  // subtree is a label (always-on-top) or geometry (occluded by cloud).
  function setMaterialDepth(obj, isLabel) {
    if (!obj) return;
    if (obj.material) {
      obj.material.depthTest  = !isLabel;
      obj.material.depthWrite = false; // billboards / transparent overlays never write depth
    }
    if (obj.children) {
      for (var i = 0; i < obj.children.length; i++) setMaterialDepth(obj.children[i], isLabel);
    }
  }

  function adoptIntoDepthScene(obj, isLabel) {
    var scene = getEdgeLabelScene();
    if (!scene || !obj) return;
    // Only reparent the first time; once it's in our scene, leave it alone.
    if (obj.parent !== scene) {
      if (obj.parent) obj.parent.remove(obj);
      scene.add(obj);
      swapLambertToBasic(obj);
    }
    // ALWAYS re-apply depth policy (idempotent). Earlier versions of this code
    // set depthTest=true on labels; objects adopted under that version kept
    // the stale value because the early-return above prevented reapplication.
    setMaterialDepth(obj, !!isLabel);
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
    // Split by category so we can apply different depth policies:
    //   GEOM  → depth-tested (occluded by cloud — feels physically correct)
    //   LABEL → always-on-top (text values must be readable even when behind
    //           a wall; otherwise the label vanishes the instant you place it
    //           on a cloud surface, since the surface is right at label depth).
    var GEOM_GROUPS  = ['spheres', 'edges'];
    var LABEL_GROUPS = ['edgeLabels', 'coordinateLabels', 'sphereLabels', 'angleLabels'];
    var GEOM_SINGLE  = ['heightEdge'];
    var LABEL_SINGLE = ['heightLabel', 'areaLabel'];

    v.scene.measurements.forEach(function (m) {
      // Respect a hidden measurement (m.visible===false, set by the viewer's
      // per-measurement eye toggle / Save View). The parts are reparented out of
      // m's subtree into this depth scene, so m.visible alone can't hide them;
      // and Potree's Measure.update() resets edge.visible (but NOT sphere.visible)
      // — that's why points/D# labels hid but the LINES and value labels stayed.
      // Re-assert it every frame, after adoption, so the hide sticks.
      var hidden = (m.visible === false);
      GEOM_GROUPS.forEach(function (key) {
        var arr = m[key]; if (!arr || !arr.length) return;
        arr.forEach(function (item) {
          if (!item) return;
          valid.add(item);
          adoptIntoDepthScene(item, false);
          if (hidden) item.visible = false;
        });
      });
      LABEL_GROUPS.forEach(function (key) {
        var arr = m[key]; if (!arr || !arr.length) return;
        arr.forEach(function (item) {
          if (!item) return;
          valid.add(item);
          adoptIntoDepthScene(item, true);
          if (hidden) item.visible = false;
        });
      });
      GEOM_SINGLE.forEach(function (key) {
        var item = m[key]; if (!item || !item.visible) return;
        valid.add(item);
        adoptIntoDepthScene(item, false);
        if (hidden) item.visible = false;
      });
      LABEL_SINGLE.forEach(function (key) {
        var item = m[key]; if (!item || !item.visible) return;
        valid.add(item);
        adoptIntoDepthScene(item, true);
        if (hidden) item.visible = false;
      });
    });

    // Enable's custom D# labels — walk the measurePointLabels Map (Measure→
    // labels[]) rather than scanning measureLabelScene.children. The labels
    // get reparented out of measureLabelScene on first adoption, so scanning
    // that scene would miss them on subsequent frames and the prune step
    // would then delete them. Walking the Map keeps every D# label valid
    // for as long as its parent Measure exists.
    var pointLabelsMap = window.__dev2 && window.__dev2.measurePointLabels;
    if (pointLabelsMap && typeof pointLabelsMap.forEach === 'function') {
      pointLabelsMap.forEach(function (labels) {
        if (!labels || !labels.length) return;
        for (var i = 0; i < labels.length; i++) {
          var lbl = labels[i];
          if (!lbl) continue;
          valid.add(lbl);
          adoptIntoDepthScene(lbl, true);
        }
      });
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

    // Pointer events unify mouse + touch + pen — no separate touch handlers
    // needed and the resize handle works identically on a tablet.
    var dragging = false;
    var pendingResize = false;
    var dragPointerId = null;
    handle.addEventListener('pointerdown', function (e) {
      dragging = true;
      dragPointerId = e.pointerId;
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
      document.documentElement.classList.add('dev2-dragging');
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
      setCloudCanvasInteractive(false);
      e.preventDefault();
      e.stopImmediatePropagation();
    });
    handle.addEventListener('pointermove', function (e) {
      if (!dragging || (dragPointerId != null && e.pointerId !== dragPointerId)) return;
      var newWidth = window.innerWidth - e.clientX;
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
    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      try { if (e && e.pointerId != null) handle.releasePointerCapture(e.pointerId); } catch (_) {}
      dragPointerId = null;
      document.documentElement.classList.remove('dev2-dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setCloudCanvasInteractive(true);
      var w = document.documentElement.style.getPropertyValue(cfg.cssVar);
      try { localStorage.setItem(cfg.storageKey, w); } catch (_) {}
      window.dispatchEvent(new Event('resize'));
    }
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
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

  // ============================================================
  // Touch input — unified mouse-event synthesis.
  //
  //   1 finger:    synthesize mousedown / mousemove / mouseup on the canvas
  //                at the touch position. Every downstream listener (Potree
  //                input handler, EarthControls, MeasuringTool insertion,
  //                Enable's tool placement + marker / member / constraint
  //                drag, station-pin / note-icon tap detection) reacts
  //                exactly as it would for a mouse — touch parity by design.
  //
  //   2 fingers:   pan from midpoint motion + pinch from distance ratio,
  //                both applied simultaneously per move (Google-Maps style).
  //                Direct writes to view.position / view.radius bypass
  //                Potree's smoothed orbit-control delta system, so the
  //                cloud follows fingers 1:1 and pinch scales naturally
  //                with current zoom ("further out = faster" for free).
  //
  // Transitions: a 2nd finger lifts off → start a fresh 1-finger drag at
  // the remaining finger's position so orbit continues without a re-touch.
  //
  // EarthControls (not OrbitControls) is the active controller — it picks
  // the cloud on mousedown and orbits around that pivot, matching the
  // "orbit around where the cursor / finger is" behaviour the user asked
  // for on both desktop and tablet.
  // ============================================================

  function setupTouchInput() {
    var v = window.__dev2 && window.__dev2.viewer;
    if (!v || !v.renderer || !v.renderer.domElement) return;
    var THREE = (window.__dev2 && window.__dev2.THREE) || window.THREE;
    if (!THREE) return;
    var canvas = v.renderer.domElement;
    canvas.style.touchAction = 'none';

    // OrbitControls (left=orbit, right=pan, wheel=zoom — the conventional
    // mapping users expect). EarthControls is wrong for our needs because it
    // swaps left/right.  Orbit-around-picked-point is handled separately by
    // the mousedown listener below, which view.lookAt()s the picked location
    // so OrbitControls.getPivot() returns it on the very next frame.
    if (v.orbitControls && typeof v.setControls === 'function') {
      try { v.setControls(v.orbitControls); }
      catch (err) { console.warn('[dev2] could not switch to orbitControls:', err); }
    }

    // (No pivot manipulation. Potree's OrbitControls already orbit around
    // view.getPivot() = position + direction × radius — i.e. whatever the
    // user is currently looking at. That pivot naturally follows panning,
    // which is what the user experienced as "orbits around where I am" in
    // the original viewer. Forcing a lookAt() on every click introduced a
    // visible jump because view.direction is derived from yaw + pitch.)

    var two = null;       // pinch/pan state when 2 fingers active
    var oneActive = false; // a 1-finger drag is in flight (mousedown synthesized)
    // Two-finger tap state — used to detect a quick non-moving 2-finger tap
    // (the tablet equivalent of pressing Esc).
    var twoTapStart = null; // { midX, midY, time }
    // 1-finger tap state — used to detect a double-tap (zoom-to-cursor,
    // mirroring desktop dblclick which Potree binds to zoomToLocation).
    var oneTapStart = null; // { x, y, time } start of current 1-finger touch
    var lastTap = null;     // { x, y, time } most recent completed tap
    // Touch-recent flag — true if any touch has occurred within the last
    // ~30 seconds. Used to constrain measurement insertions to single
    // segments (2 points only) on tablet, where chained multi-point
    // measurements are unwieldy.
    var lastTouchTime = 0;
    function isTouchActive() { return (Date.now() - lastTouchTime) < 30000; }

    // Wrap MeasuringTool.startInsertion so touch-initiated measurements
    // behave well on tablet:
    //   - Single-segment tools (distance, height) auto-finish at 2 points
    //   - Multi-point tools (area, angle) stay open for as many points as
    //     the user wants, and `_multiPointInsertionActive` flips so the
    //     touchend double-tap detection switches from "zoom" to
    //     "finalize the measurement via Esc".
    var _multiPointInsertionActive = false;
    if (v.measuringTool && !v.measuringTool._dev2TouchLimit) {
      var origStart = v.measuringTool.startInsertion.bind(v.measuringTool);
      v.measuringTool.startInsertion = function (args) {
        args = args || {};
        if (isTouchActive() && (args.maxMarkers == null || args.maxMarkers === Infinity)) {
          if (args.showArea || args.showAngles) {
            _multiPointInsertionActive = true;
          } else {
            args.maxMarkers = 2;
          }
        }
        var measure = origStart(args);
        // Reset the multi-point flag whenever the measurement is finished
        // or cancelled — restores normal double-tap-to-zoom behaviour.
        if (measure && _multiPointInsertionActive) {
          var clear = function () {
            _multiPointInsertionActive = false;
            measure.removeEventListener && measure.removeEventListener('measurement_finished', clear);
          };
          measure.addEventListener && measure.addEventListener('measurement_finished', clear);
          v.addEventListener && v.addEventListener('cancel_insertions', clear);
        }
        return measure;
      };
      v.measuringTool._dev2TouchLimit = true;
    }

    function pairState(touches) {
      var t1 = touches[0], t2 = touches[1];
      var dx = t2.clientX - t1.clientX, dy = t2.clientY - t1.clientY;
      return {
        dist: Math.sqrt(dx * dx + dy * dy),
        midX: (t1.clientX + t2.clientX) / 2,
        midY: (t1.clientY + t2.clientY) / 2
      };
    }

    function panInPixels(dxPx, dyPx) {
      var cam = v.scene.getActiveCamera();
      var view = v.scene.view;
      if (!cam || !view) return;
      var rect = canvas.getBoundingClientRect();
      var sx, sy;
      if (cam.isOrthographicCamera) {
        sx = (cam.right - cam.left) / rect.width;
        sy = (cam.top - cam.bottom) / rect.height;
      } else {
        var pivot = (view._pivot && view._pivot.isVector3) ? view._pivot : view.position;
        var d = cam.position.distanceTo(pivot) || view.radius || 50;
        var vFov = (cam.fov || 60) * Math.PI / 180;
        sy = (2 * Math.tan(vFov / 2) * d) / rect.height;
        sx = sy;
      }
      var right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      var up    = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      var delta = new THREE.Vector3()
        .addScaledVector(right, -dxPx * sx)
        .addScaledVector(up,     dyPx * sy);
      if (view.position) view.position.add(delta);
      if (view._pivot && view._pivot.isVector3) view._pivot.add(delta);
      if (cam.target && cam.target.isVector3) cam.target.add(delta);
      v.repaint && v.repaint();
    }

    function synthMouse(type, x, y, buttons, buttonOverride) {
      canvas.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        button: (buttonOverride != null) ? buttonOverride : 0,
        buttons: buttons || 0,
        clientX: x, clientY: y, screenX: x, screenY: y
      }));
    }

    // Find a draggable measurement / member / constraint sphere whose
    // projected screen position is within ~30 px of the given client
    // coordinates. Returns the closest match, or null. We use this on
    // touchstart so we can invoke inputHandler.startDragging(sphere)
    // directly; the regular mousedown → hoveredElements path is unreliable
    // on touch (no prior mousemove track to settle hovered state).
    function findDraggableSphereAt(clientX, clientY) {
      var THREE = (window.__dev2 && window.__dev2.THREE) || window.THREE;
      if (!THREE || !v.scene || !v.scene.measurements) return null;
      // During multi-point insertion (Area / Angle) we never want a tap to
      // grab a measurement sphere — Potree's insertion flow leaves a
      // duplicate of the previous marker stacked at the tap position, and
      // letting the user drag that duplicate produces the "tap places a
      // point + a draggable shadow point" awkwardness the user complained
      // about. Distance auto-finalizes on the first tap so the flag stays
      // false there; its "tap places 2 stacked points, drag one out"
      // behavior is preserved.
      if (_multiPointInsertionActive) return null;
      var rect = canvas.getBoundingClientRect();
      var camera = v.scene.getActiveCamera();
      if (!camera) return null;
      var best = null;
      // 18px threshold — tight enough that casual 2-finger pinch fingers
      // don't accidentally start a sphere drag, loose enough that direct
      // taps on the sphere reliably engage it.
      var bestPxSq = 324;
      var ms = v.scene.measurements;
      for (var mi = 0; mi < ms.length; mi++) {
        var sph = ms[mi].spheres;
        if (!sph) continue;
        for (var si = 0; si < sph.length; si++) {
          var s = sph[si];
          if (!s.visible || !s._listeners || !s._listeners.drag) continue;
          var wp = s.getWorldPosition(new THREE.Vector3());
          var ndc = wp.project(camera);
          if (ndc.z < -1 || ndc.z > 1) continue;
          var sx = (ndc.x + 1) * 0.5 * rect.width + rect.left;
          var sy = (1 - (ndc.y + 1) * 0.5) * rect.height + rect.top;
          var dx = sx - clientX, dy = sy - clientY;
          var dsq = dx * dx + dy * dy;
          if (dsq < bestPxSq) { bestPxSq = dsq; best = s; }
        }
      }
      return best;
    }

    // When the 1-finger drag locks onto a measurement sphere, save its
    // ORIGINAL world position so we can restore it if the 2nd finger
    // arrives quickly (user was trying to pinch, not drag).
    var _spheredragSphere   = null;
    var _spheredragOrigPos  = null;
    var _spheredragStartTime = 0;

    function startOneFingerAt(x, y) {
      var sphere = findDraggableSphereAt(x, y);
      if (sphere && v.inputHandler) {
        var rect = canvas.getBoundingClientRect();
        var THREE = (window.__dev2 && window.__dev2.THREE) || window.THREE;
        v.inputHandler.mouse.set(x - rect.left, y - rect.top);
        _spheredragSphere    = sphere;
        _spheredragOrigPos   = THREE ? sphere.getWorldPosition(new THREE.Vector3()) : sphere.position.clone();
        _spheredragStartTime = Date.now();
        v.inputHandler.startDragging(sphere);
        oneActive = true;
        return;
      }
      _spheredragSphere = null;
      _spheredragOrigPos = null;
      synthMouse('mousemove', x, y, 0);
      synthMouse('mousedown', x, y, 1);
      oneActive = true;
    }

    // If finger 2 lands within ~250 ms of a sphere drag starting (and the
    // sphere has shifted), the user was really initiating a pinch — restore
    // the sphere to its original position and update the owning measurement
    // so the displayed values revert too.
    function maybeRevertSphereDrag() {
      if (!_spheredragSphere || !_spheredragOrigPos) return;
      if (Date.now() - _spheredragStartTime > 250) return;
      _spheredragSphere.position.copy(_spheredragOrigPos);
      if (v.scene && v.scene.measurements) {
        for (var i = 0; i < v.scene.measurements.length; i++) {
          var m = v.scene.measurements[i];
          if (!m.spheres) continue;
          var idx = m.spheres.indexOf(_spheredragSphere);
          if (idx === -1) continue;
          if (m.points && m.points[idx]) m.points[idx].position.copy(_spheredragOrigPos);
          if (typeof m.update === 'function') m.update();
          break;
        }
      }
    }
    function endOneFinger(x, y, disqualify) {
      if (!oneActive) return;
      if (disqualify) {
        // Displaced RIGHT-button mouseup:
        //   - 20 px offset clears viewer.html's 5 px drag-guard so no
        //     mark / note / measurement-placement fires from the synth
        //     mouseup. The guard reads (mouseup.clientX - mouseDownPos.x),
        //     so the mouseup alone is sufficient — NO mousemove. Firing a
        //     mousemove here would make inputHandler.onMouseMove dispatch
        //     a 'drag' event to whatever sphere is currently dragged
        //     (e.g. the sphere2 left armed by a just-completed measurement
        //     insertion), causing it to jump to the displaced position.
        //   - RIGHT button so Potree's MeasuringTool.insertionCallback
        //     treats it as CANCEL instead of "add point".
        synthMouse('mouseup', x + 20, y, 0, /*button=*/2);
      } else {
        synthMouse('mouseup', x, y, 0);
      }
      oneActive = false;
      // Belt-and-suspenders: force-clear inputHandler.drag in case the
      // synth mouseup didn't reach onMouseUp (e.g. the explicit
      // startDragging() path skipped the normal mousedown flow). Without
      // this, a stale drag.object can survive between touches, causing
      // the previously-dragged sphere to follow each fresh finger press.
      if (v.inputHandler && v.inputHandler.drag) {
        try {
          if (v.inputHandler.drag.object && v.inputHandler.drag.object.dispatchEvent) {
            v.inputHandler.drag.object.dispatchEvent({
              type: 'drop', drag: v.inputHandler.drag, viewer: v
            });
          }
        } catch (_) {}
        v.inputHandler.drag = null;
      }
    }

    canvas.addEventListener('touchstart', function (e) {
      e.stopImmediatePropagation();
      e.preventDefault();
      lastTouchTime = Date.now();
      if (e.touches.length === 1) {
        var t = e.touches[0];
        startOneFingerAt(t.clientX, t.clientY);
        // Tap state for double-tap detection.
        oneTapStart = { x: t.clientX, y: t.clientY, time: Date.now() };
      } else if (e.touches.length === 2) {
        // 2nd finger arrived; cancel any in-flight 1-finger drag and
        // displace the synthesized mouseup so it doesn't fire as a click
        // (which would place a marker / note / measurement point at the
        // first finger's position — a common bug for "two-finger Esc"
        // gestures where the fingers don't land exactly simultaneously).
        // If finger 1 had locked onto a measurement sphere, undo the
        // tiny drag it may have caused before finger 2 arrived.
        maybeRevertSphereDrag();
        _spheredragSphere = null;
        _spheredragOrigPos = null;
        var lastX = e.touches[0].clientX, lastY = e.touches[0].clientY;
        endOneFinger(lastX, lastY, /*disqualify=*/true);
        two = pairState(e.touches);
        // Seed the two-finger-tap-detector. Cleared if the fingers move
        // (becomes a pan/pinch) or if the tap exceeds ~300ms.
        twoTapStart = { midX: two.midX, midY: two.midY, time: Date.now() };
      }
    }, { capture: true, passive: false });

    canvas.addEventListener('touchmove', function (e) {
      e.stopImmediatePropagation();
      e.preventDefault();
      if (e.touches.length === 1 && oneActive) {
        var t = e.touches[0];
        synthMouse('mousemove', t.clientX, t.clientY, 1);
        // Significant motion disqualifies this touch as a tap.
        if (oneTapStart) {
          var dx = t.clientX - oneTapStart.x;
          var dy = t.clientY - oneTapStart.y;
          if (dx * dx + dy * dy > 100) oneTapStart = null;
        }
      } else if (e.touches.length === 2 && two) {
        var cur = pairState(e.touches);
        var dMidX = cur.midX - two.midX;
        var dMidY = cur.midY - two.midY;
        if (dMidX || dMidY) panInPixels(dMidX, dMidY);
        if (cur.dist > 0 && two.dist > 0) {
          var view = v.scene.view;
          if (view) {
            var rawRatio = two.dist / cur.dist;
            // Dead zone — fingers wiggle by a couple pixels even when the
            // user is "holding still". Without this, every touchmove during
            // a pure pan would micro-zoom.
            if (Math.abs(rawRatio - 1) > 0.004) {
              // Square-root dampening on the per-frame ratio. Multiplicative
              // adaptation with radius is preserved (further out = bigger
              // absolute change), but the sensitivity per touchmove event
              // is halved so the user can settle on a target zoom without
              // overshooting close-up points.
              var ratio = rawRatio < 1
                ? Math.sqrt(rawRatio)
                : 1 / Math.sqrt(1 / rawRatio);
              var pivot = view.getPivot();
              view.radius *= ratio;
              view.position.copy(pivot).addScaledVector(view.direction, -view.radius);
              v.repaint && v.repaint();
            }
          }
        }
        // If fingers moved meaningfully (~16px from start midpoint or ~12px
        // change in inter-finger distance), no longer eligible as a "tap".
        if (twoTapStart) {
          var dxs = cur.midX - twoTapStart.midX;
          var dys = cur.midY - twoTapStart.midY;
          if (dxs * dxs + dys * dys > 256 ||
              Math.abs(cur.dist - two.dist) > 12) twoTapStart = null;
        }
        two = cur;
      }
    }, { capture: true, passive: false });

    canvas.addEventListener('touchend', function (e) {
      e.stopImmediatePropagation();
      e.preventDefault();
      // Two-finger tap → Esc. Fires once BOTH fingers are off, provided
      // no significant motion happened (touchmove clears twoTapStart on
      // movement) and the total duration was under ~600ms. Generous
      // thresholds because hitting both fingers down + lifted in <300ms
      // proved hard.
      if (e.touches.length === 0 && twoTapStart) {
        if (Date.now() - twoTapStart.time < 600) {
          document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true
          }));
          window.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true
          }));
        }
        twoTapStart = null;
      }
      if (e.touches.length === 0) {
        var t = (e.changedTouches && e.changedTouches[0]) || { clientX: 0, clientY: 0 };
        // 1-finger tap detection — if no motion and short duration, this
        // is a tap. Double-tap normally zooms-to-cursor, BUT during a
        // multi-point measurement insertion (area, angle) double-tap
        // finalizes the measurement instead (synthetic Esc → cancel-
        // insertions → keeps placed points if there are enough of them).
        if (oneTapStart && Date.now() - oneTapStart.time < 350) {
          var now = Date.now();
          if (lastTap && now - lastTap.time < 500) {
            var ddx = t.clientX - lastTap.x;
            var ddy = t.clientY - lastTap.y;
            if (ddx * ddx + ddy * ddy < 576) {
              if (_multiPointInsertionActive) {
                document.dispatchEvent(new KeyboardEvent('keydown', {
                  key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true
                }));
                window.dispatchEvent(new KeyboardEvent('keydown', {
                  key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true
                }));
              } else {
                canvas.dispatchEvent(new MouseEvent('dblclick', {
                  bubbles: true, cancelable: true, view: window,
                  button: 0, buttons: 0,
                  clientX: t.clientX, clientY: t.clientY,
                  screenX: t.clientX, screenY: t.clientY
                }));
              }
              lastTap = null;
              oneTapStart = null;
            }
          }
          if (oneTapStart) {
            lastTap = { x: t.clientX, y: t.clientY, time: now };
          }
        }
        oneTapStart = null;
        endOneFinger(t.clientX, t.clientY);
        _spheredragSphere = null;
        _spheredragOrigPos = null;
        two = null;
        // After a clean tap, auto-exit any single-action pick mode on
        // touch (mark mode in particular — desktop expects the mode to
        // persist for multi-placement, but tablet UX wants it to revert
        // to navigation immediately so pan/rotate works without an
        // explicit cancel step).
        if (window.__dev2 && window.__dev2._touchExitSingleModes) {
          window.__dev2._touchExitSingleModes();
        }
      } else if (e.touches.length === 1) {
        // Was 2-finger pan/pinch; one finger lifted. Drop pinch state and
        // start a fresh 1-finger drag at the remaining finger so orbit
        // continues seamlessly without re-touching.
        two = null;
        var t2 = e.touches[0];
        startOneFingerAt(t2.clientX, t2.clientY);
      }
    }, { capture: true, passive: false });

    canvas.addEventListener('touchcancel', function () {
      endOneFinger(0, 0);
      two = null;
    }, { capture: true, passive: false });
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
      setupTouchInput();
      startAreaVolumeFillObserver();
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
