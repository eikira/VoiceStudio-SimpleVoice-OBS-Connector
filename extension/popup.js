(function () {
  'use strict';
  var S = window.VSShared;
  var $ = function (id) { return document.getElementById(id); };
  var cfg = null;

  function paint(el, text, cls) {
    el.textContent = text;
    el.className = cls || '';
  }

  // Without a relay of version 0.0.7 or newer the extension refuses to speak: say so loudly.
  function gateCheck(force) {
    var done = function (gate) {
      var bad = gate && gate.ok === false;
      $('gate').hidden = !bad;
      if (bad) { $('gateText').textContent = S.relayGateShort(gate); $('gateLink').href = S.relayPage(gate.engine); $('gateLink').textContent = gate.engine === 'simplevoice' ? 'Download SimpleVoice OBS' : 'Download relay'; }
    };
    if (force) {
      chrome.runtime.sendMessage({ type: 'relaycheck', force: true }, function (res) { void chrome.runtime.lastError; done(res && res.gate); });
    } else {
      chrome.runtime.sendMessage({ type: 'relaycheck' }, function (res) { void chrome.runtime.lastError; done(res && res.gate); });
    }
  }

  function refresh() {
    chrome.storage.local.get('config').then(function (res) {
      cfg = Object.assign({}, S.DEFAULTS, res.config || {});
      $('enabled').checked = cfg.enabled;
      paint($('readAllState'), cfg.readAll ? 'on' : 'off', cfg.readAll ? 'good' : 'muted');
      var n = (cfg.mappings || []).filter(function (m) { return m.command && m.voice; }).length;
      paint($('cmds'), n ? n + ' set up' : 'none yet', n ? '' : 'bad');
      var sv = S.isSimpleVoice(cfg);
      $('relayLabel').textContent = sv ? 'Relay (SV)' : 'Relay (VS)';
      $('relayHintText').textContent = sv ? 'Start SimpleVoice OBS.' : 'Start the relay.';
      $('relayHintLink').href = S.relayPage(cfg.engine);
      if (!cfg.overlayId) { paint($('relay'), 'open Settings first', 'bad'); return; }

      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, 2000);
      fetch(S.trimUrl(cfg.relayUrl) + '/status?id=' + encodeURIComponent(cfg.overlayId), { signal: ctrl.signal })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          paint($('relay'), 'running', 'good');
          $('relayHint').hidden = true;
          paint($('obs'), d.listeners > 0 ? 'connected' : 'not connected', d.listeners > 0 ? 'good' : 'muted');
        })
        .catch(function () {
          paint($('relay'), 'not running', 'bad');
          $('relayHint').hidden = true; // the red box above already says it
          paint($('obs'), '-', 'muted');
        })
        .then(function () { clearTimeout(timer); });
    });
    chrome.storage.local.get(['soundbites', 'rumbleEmotes']).then(function (res) {
      var n = ((res.soundbites && res.soundbites.names) || []).length;
      var e = Object.keys(res.rumbleEmotes || {}).length;
      $('sbinfo').textContent = n + ' clip' + (n === 1 ? '' : 's') + (e ? ', ' + e + ' Rumble emote' + (e === 1 ? '' : 's') + ' known' : '');
    });
    chrome.storage.session.get('stats').then(function (res) {
      var st = res.stats || {};
      $('sent').textContent = String(st.sent || 0);
      $('err').textContent = st.lastError || '';
    });
  }

  // Firefox lets the user switch off site access per extension; the chat readers then never run.
  function sitesAllowed() {
    var origins = [];
    (chrome.runtime.getManifest().content_scripts || []).forEach(function (cs) {
      cs.matches.forEach(function (m) {
        var host = (m.match(/^(https:\/\/[^/]+)\//) || [])[1];
        if (host && origins.indexOf(host + '/*') === -1) origins.push(host + '/*');
      });
    });
    try {
      return chrome.permissions.contains({ origins: origins }).then(function (ok) { return !!ok; }, function () { return true; });
    } catch (e) {
      return Promise.resolve(true);
    }
  }

  // Which chat pages the extension is listening to right now.
  function refreshChat() {
    chrome.storage.session.get('chatTabs').then(function (res) {
      var map = res.chatTabs || {};
      var now = Date.now();
      var names = { twitch: 'Twitch', youtube: 'YouTube', rumble: 'Rumble', kick: 'Kick' };
      var all = Object.keys(map).map(function (k) { return map[k]; })
        .filter(function (t) { return now - t.at < 45000; });
      // One tab can have several pages inside it (Rumble's chat is inside the stream page). A page
      // without the chat list must not hide the one that has it: per tab, listening pages win.
      var tabs = all.filter(function (t) {
        return t.listening || !all.some(function (o) { return o.tab === t.tab && o.listening; });
      });
      if (!tabs.length) {
        paint($('chat'), 'not detected', 'bad');
        $('chatHint').textContent = 'Open your chat page. If it is already open and still not detected, refresh it (F5).';
        sitesAllowed().then(function (ok) {
          if (!ok) $('chatHint').textContent = 'The browser has not allowed this extension on all chat sites. Open the add-ons page (about:addons), click this extension, then Permissions, and switch the chat sites on. Then refresh your chat page (F5).';
        });
        return;
      }
      var allListening = tabs.every(function (t) { return t.listening; });
      paint($('chat'), tabs.map(function (t) {
        return (names[t.platform] || t.platform) + (t.listening ? ' listening' : ' chat list not found') + ' · ' + t.seen + ' seen';
      }).join('; '), allListening ? 'good' : 'bad');
      var last = tabs.map(function (t) { return t.last; }).filter(Boolean).pop();
      $('chatHint').textContent = allListening
        ? (last ? 'Last command seen: ' + last : 'Waiting for a message that starts with a command.')
        : 'The chat page was found, but not its message list.';
    });
  }

  $('enabled').addEventListener('change', function () {
    chrome.storage.local.get('config').then(function (res) {
      var c = Object.assign({}, S.DEFAULTS, res.config || {});
      c.enabled = $('enabled').checked;
      return chrome.storage.local.set({ config: c });
    });
  });
  $('settings').addEventListener('click', function () { chrome.runtime.openOptionsPage(); window.close(); });
  $('copy').addEventListener('click', function () {
    if (!cfg || !cfg.overlayId) { paint($('msg'), 'Open Settings first.', 'status bad'); return; }
    navigator.clipboard.writeText(S.overlayUrl(cfg)).then(function () { paint($('msg'), 'URL copied.', 'status good'); });
  });
  $('test').addEventListener('click', function () {
    paint($('msg'), 'Sending...', 'status muted');
    chrome.runtime.sendMessage({ type: 'test' }, function (res) {
      if (chrome.runtime.lastError || !res) { paint($('msg'), 'Could not reach the extension.', 'status bad'); return; }
      if (!res.ok) { paint($('msg'), res.error || 'Failed', 'status bad'); return; }
      paint($('msg'), res.listeners > 0 ? 'Sent. You should hear it in OBS.' : 'Sent, but no OBS page is connected.', res.listeners > 0 ? 'status good' : 'status bad');
      refresh();
    });
  });

  // ---- update notice (the check itself runs in the background, at most once a day) ----------
  function showUpdate() {
    chrome.storage.local.get(['update', 'config']).then(function (res) {
      var u = res.update;
      var on = !res.config || res.config.updateCheck !== false;
      var show = on && u && S.newerThan(u.latest, chrome.runtime.getManifest().version);
      $('updateBox').hidden = !show;
      if (show) { $('updateVer').textContent = u.latest; $('updateLink').href = S.RELEASES_PAGE; }
    });
  }
  chrome.runtime.sendMessage({ type: 'updatecheck' }, function () { void chrome.runtime.lastError; showUpdate(); });
  showUpdate();

  $('version').textContent = chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version;
  gateCheck(true);
  refresh();
  refreshChat();
  setInterval(function () { refresh(); refreshChat(); gateCheck(false); }, 3000);
})();
