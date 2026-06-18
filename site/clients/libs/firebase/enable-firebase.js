// Enable Point Cloud Viewer — shared Firebase integration.
//
// Exposes two globals (classic script, no modules — relies on the firebase
// compat SDK being loaded first and on window.FIREBASE_CONFIG):
//
//   EnableAuth
//     .requireAccess(clientId)  -> Promise<{user, client}>  // gates the viewer
//     .completeSignInIfNeeded() -> Promise<bool>            // finishes email-link
//     .signOut() / .currentUser() / .onUserChanged(cb)
//
//   EnableCloud
//     .listSessions(projectId)            -> Promise<[{id,name,updatedAt,data}]>
//     .saveSession(projectId, name, data) -> Promise<id>
//     .deleteSession(projectId, id)       -> Promise<void>
//
// Authorization model: any sign-in provider (Google / email-link) resolves to a
// verified email; access is granted iff clients/{clientId}/members/{email}
// exists AND the client's access window is live. Cloud sessions are PRIVATE per
// user under users/{uid}/projects/{projectId}/sessions.
(function (global) {
  'use strict';

  if (!global.firebase || !global.FIREBASE_CONFIG) {
    console.error('[EnableFirebase] firebase SDK or FIREBASE_CONFIG missing — auth disabled.');
    return;
  }
  if (!firebase.apps || !firebase.apps.length) {
    firebase.initializeApp(global.FIREBASE_CONFIG);
  }
  var auth = firebase.auth();
  var db = firebase.firestore();

  var GRACE_MS = 15 * 24 * 60 * 60 * 1000; // 15-day grace, mirrors Firestore rules
  var EMAIL_KEY = 'enable.emailForSignIn';
  var SUPPORT = 'kevin@enable-inc.com';

  // ----------------------------------------------------------------- overlay --
  var overlay = null, cardBody = null;

  function buildOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'enable-auth-overlay';
    overlay.innerHTML =
      '<div id="enable-auth-card">' +
        '<img id="enable-auth-logo" src="../EnableLogo.png" alt="Enable" ' +
             'onerror="this.style.display=\'none\'">' +
        '<div id="enable-auth-body"></div>' +
      '</div>';
    (document.body || document.documentElement).appendChild(overlay);
    cardBody = overlay.querySelector('#enable-auth-body');
  }
  function showOverlay() { buildOverlay(); overlay.style.display = 'flex'; }
  function hideOverlay() { if (overlay) overlay.style.display = 'none'; }
  function setBody(html) { buildOverlay(); cardBody.innerHTML = html; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function stateLoading(msg) {
    setBody('<div class="enable-auth-spinner"></div>' +
            '<div class="enable-auth-msg">' + esc(msg || 'Checking access…') + '</div>');
  }
  function stateLogin(onGoogle, onEmail) {
    setBody(
      '<h2>Sign in to view</h2>' +
      '<p class="enable-auth-sub">Access is restricted to authorized users.</p>' +
      '<button id="enable-auth-google" class="enable-auth-btn enable-auth-google">' +
        'Sign in with Google</button>' +
      '<div class="enable-auth-or"><span>or</span></div>' +
      '<input id="enable-auth-email" type="email" placeholder="you@company.com" autocomplete="email">' +
      '<button id="enable-auth-emaillink" class="enable-auth-btn">Email me a sign-in link</button>' +
      '<div id="enable-auth-note" class="enable-auth-note"></div>'
    );
    overlay.querySelector('#enable-auth-google').onclick = onGoogle;
    var emailInput = overlay.querySelector('#enable-auth-email');
    overlay.querySelector('#enable-auth-emaillink').onclick = function () { onEmail(emailInput.value.trim()); };
    emailInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') onEmail(emailInput.value.trim()); });
  }
  function setNote(msg, isErr) {
    var n = overlay && overlay.querySelector('#enable-auth-note');
    if (n) { n.textContent = msg || ''; n.className = 'enable-auth-note' + (isErr ? ' err' : ''); }
  }
  function stateEmailSent(email) {
    setBody(
      '<h2>Check your inbox</h2>' +
      '<p class="enable-auth-sub">We sent a sign-in link to<br><b>' + esc(email) + '</b></p>' +
      '<p class="enable-auth-note">Open the link on this device to finish signing in.</p>'
    );
  }
  function stateBlocked(title, email, sub, onSwitch) {
    setBody(
      '<h2>' + esc(title) + '</h2>' +
      '<p class="enable-auth-sub"><b>' + esc(email) + '</b><br>' + sub + '</p>' +
      '<button id="enable-auth-switch" class="enable-auth-btn">Use a different account</button>' +
      '<p class="enable-auth-note">Contact <a href="mailto:' + SUPPORT + '">' + SUPPORT + '</a></p>'
    );
    overlay.querySelector('#enable-auth-switch').onclick = onSwitch;
  }

  // ----------------------------------------------------------- email helpers --
  function actionCodeSettings() {
    return { url: location.href, handleCodeInApp: true }; // return to this viewer (keeps ?p=)
  }
  function cleanUrl() {
    try {
      var u = new URL(location.href);
      var p = u.searchParams.get('p');
      history.replaceState(null, '', u.origin + u.pathname + (p ? ('?p=' + encodeURIComponent(p)) : ''));
    } catch (e) { /* ignore */ }
  }
  function completeSignInIfNeeded() {
    return new Promise(function (resolve) {
      try {
        if (!auth.isSignInWithEmailLink(location.href)) return resolve(false);
        var email = global.localStorage.getItem(EMAIL_KEY);
        if (!email) email = global.prompt('Confirm your email to finish signing in:');
        if (!email) return resolve(false);
        stateLoading('Signing you in…');
        auth.signInWithEmailLink(email, location.href).then(function () {
          global.localStorage.removeItem(EMAIL_KEY);
          cleanUrl();
          resolve(true);
        }).catch(function (err) {
          console.error('[EnableFirebase] email-link sign-in failed', err);
          cleanUrl();
          resolve(false);
        });
      } catch (e) { console.error(e); resolve(false); }
    });
  }
  function sendEmailLink(email) {
    if (!email || email.indexOf('@') < 1) { setNote('Enter a valid email address.', true); return; }
    setNote('Sending…');
    auth.sendSignInLinkToEmail(email, actionCodeSettings()).then(function () {
      global.localStorage.setItem(EMAIL_KEY, email);
      stateEmailSent(email);
    }).catch(function (err) {
      console.error('[EnableFirebase] sendSignInLink failed', err);
      setNote('Could not send link: ' + (err && err.message ? err.message : 'error'), true);
    });
  }
  function signInGoogle() {
    var provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    stateLoading('Opening Google sign-in…');
    auth.signInWithPopup(provider).catch(function (err) {
      console.error('[EnableFirebase] Google sign-in failed', err);
      // re-show login; onAuthStateChanged drives success, so just restore the form
      presentLogin();
      var code = err && err.code;
      if (code === 'auth/popup-blocked') setNote('Popup blocked — allow popups, or use the email link.', true);
      else if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request')
        setNote(err && err.message ? err.message : 'Sign-in failed.', true);
    });
  }

  // -------------------------------------------------------------- access gate --
  function emailOf(user) { return (user && user.email ? user.email : '').toLowerCase(); }

  function tsMs(v) {
    if (v == null) return null;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v;
    return null;
  }
  function accessActive(c) {
    if (!c) return false;
    var now = Date.now();
    var status = c.subscriptionStatus || 'none';
    if (status === 'active' || status === 'trialing') return true;
    var grant = tsMs(c.grantUntil);
    if (grant != null && now < grant + GRACE_MS) return true;
    if (status === 'past_due') {
      var cpe = tsMs(c.currentPeriodEnd);
      if (cpe != null && now < cpe + GRACE_MS) return true;
    }
    // No access fields configured at all (pilot/legacy) -> membership alone gates.
    if (c.grantUntil == null && c.currentPeriodEnd == null && status === 'none') return true;
    return false;
  }
  // A user belongs to a client if their email is in members/ OR their email's
  // domain is in the client's allowedDomains list. Reads the client doc (for
  // allowedDomains + access window) and the member doc together.
  function checkMembership(clientId, user) {
    var email = emailOf(user);
    if (!email) return Promise.resolve({ ok: false, reason: 'no-email' });
    var domain = email.indexOf('@') >= 0 ? email.split('@')[1] : '';
    var clientRef = db.doc('clients/' + clientId);
    var memberRef = clientRef.collection('members').doc(email);
    // A members/'everyone' sentinel doc opens the client to ANY signed-in
    // (verified-email) user: they still log in, but no per-user grant is needed.
    var everyoneRef = clientRef.collection('members').doc('everyone');
    return Promise.all([
      clientRef.get().catch(function () { return null; }),
      memberRef.get().catch(function () { return null; }),
      everyoneRef.get().catch(function () { return null; })
    ]).then(function (res) {
      var cSnap = res[0], mSnap = res[1], eSnap = res[2];
      var data = (cSnap && cSnap.exists) ? cSnap.data() : {};
      var domains = data.allowedDomains || [];
      var openToEveryone = !!(eSnap && eSnap.exists);
      var belongs = openToEveryone || (mSnap && mSnap.exists) || (domain && domains.indexOf(domain) >= 0);
      if (!belongs) return { ok: false, reason: 'not-member' };
      writeSigninLog(clientId, user);
      // Open clients skip the subscription/grant window entirely.
      if (!openToEveryone && !accessActive(data)) return { ok: false, reason: 'expired' };
      return { ok: true, client: data };
    });
  }
  function recordUser(user) {
    try {
      db.doc('users/' + user.uid).set({
        email: emailOf(user),
        displayName: user.displayName || '',
        lastSeenAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (e) { /* best effort */ }
  }
  // Per-client sign-in log: clients/{clientId}/signins/{email}. Keyed by email so
  // the document name is human-readable. Captures everyone who reaches the viewer
  // (explicit members AND auto-admitted domain users).
  function writeSigninLog(clientId, user) {
    try {
      db.doc('clients/' + clientId + '/signins/' + emailOf(user)).set({
        email: emailOf(user),
        displayName: user.displayName || '',
        uid: user.uid,
        lastSeenAt: firebase.firestore.FieldValue.serverTimestamp(),
        visits: firebase.firestore.FieldValue.increment(1)
      }, { merge: true });
    } catch (e) { /* best effort */ }
  }
  function presentLogin() {
    stateLogin(function () { signInGoogle(); }, function (email) { sendEmailLink(email); });
  }
  function requireAccess(clientId) {
    showOverlay();
    stateLoading();
    var settled = false;
    return new Promise(function (resolve) {
      function onUser(user) {
        if (settled) return;
        if (!user) { presentLogin(); return; }
        stateLoading('Verifying access…');
        recordUser(user);
        checkMembership(clientId, user).then(function (res) {
          if (settled) return;
          if (res.ok) {
            settled = true;
            hideOverlay();
            resolve({ user: user, client: res.client });
          } else if (res.reason === 'expired') {
            stateBlocked('Access expired', emailOf(user),
              'Access for this project has ended. Please contact Enable to renew.',
              function () { auth.signOut(); });
          } else {
            stateBlocked('No access', emailOf(user),
              'isn\'t authorized for this project.',
              function () { auth.signOut(); });
          }
        });
      }
      completeSignInIfNeeded().then(function () { auth.onAuthStateChanged(onUser); });
    });
  }

  // ---------------------------------------------------------------- cloud API --
  function sessionsCol(projectId) {
    var u = auth.currentUser;
    if (!u) throw new Error('not signed in');
    return db.collection('users').doc(u.uid)
             .collection('projects').doc(projectId)
             .collection('sessions');
  }
  var EnableCloud = {
    listSessions: function (projectId) {
      return sessionsCol(projectId).orderBy('updatedAt', 'desc').get().then(function (qs) {
        var out = [];
        qs.forEach(function (doc) {
          var d = doc.data();
          var data = null;
          try { data = d.dataJson ? JSON.parse(d.dataJson) : (d.data || null); } catch (e) { /* corrupt */ }
          out.push({ id: doc.id, name: d.name || '(unnamed)', updatedAt: tsMs(d.updatedAt), data: data });
        });
        return out;
      });
    },
    saveSession: function (projectId, name, data) {
      return sessionsCol(projectId).add({
        name: name || 'Session',
        pointCloudID: projectId,
        dataJson: JSON.stringify(data),   // stored as a string to dodge Firestore nested-array limits
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }).then(function (ref) { return ref.id; });
    },
    deleteSession: function (projectId, id) {
      return sessionsCol(projectId).doc(id).delete();
    }
  };

  // ------------------------------------------------------------------ exports --
  global.EnableAuth = {
    requireAccess: requireAccess,
    completeSignInIfNeeded: completeSignInIfNeeded,
    signOut: function () { return auth.signOut(); },
    currentUser: function () { return auth.currentUser; },
    onUserChanged: function (cb) { return auth.onAuthStateChanged(cb); }
  };
  global.EnableCloud = EnableCloud;

  // Cover the viewer immediately so it is never visible before access resolves.
  if (document.body) { showOverlay(); stateLoading(); }
  else document.addEventListener('DOMContentLoaded', function () { showOverlay(); stateLoading(); });

})(window);
