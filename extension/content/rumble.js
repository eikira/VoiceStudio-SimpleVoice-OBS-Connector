/* Rumble live chat: the chat popout (/chat/popup/...) and the chat inside a live page. */
// Rumble shows an emote as a picture without any name in it (alt and title are empty; the file name is
// something like iw9Cc.baa.png). The name only appears on the emote buttons of the page (the top emotes
// and the emote list), as data-js-emote=":bbc:" next to the same picture. So the reader learns, from
// every such button it sees, which picture belongs to which name, and keeps that list (it only grows).
// A picture in a chat message is then turned back into :name: when that name has a sound clip.
var emoteByPicture = {};
function pictureKey(img) {
  var src = String(img.getAttribute('src') || '').split('?')[0];
  return src.split('/').pop();
}
function learnEmotes() {
  var added = false;
  document.querySelectorAll('[data-js-emote]').forEach(function (el) {
    var name = String(el.getAttribute('data-js-emote') || '').replace(/:/g, '').trim();
    var img = el.tagName === 'IMG' ? el : el.querySelector('img');
    var key = img ? pictureKey(img) : '';
    if (name && key && emoteByPicture[key] !== name) { emoteByPicture[key] = name; added = true; }
  });
  if (added) {
    try { chrome.storage.local.set({ rumbleEmotes: emoteByPicture }); } catch (e) { /* extension reloaded */ }
  }
}
try {
  chrome.storage.local.get('rumbleEmotes', function (r) {
    var saved = (r && r.rumbleEmotes) || {};
    Object.keys(saved).forEach(function (k) { if (!emoteByPicture[k]) emoteByPicture[k] = saved[k]; });
    learnEmotes();
  });
} catch (e) { /* extension reloaded */ }
setInterval(learnEmotes, 4000);

// The message text. A picture is written as :name: when its name is known and has a sound clip; any
// other picture adds nothing, as before. A picture with a name in alt or title is read from there too.
function messageText(node, isEmote) {
  var out = '';
  node.childNodes.forEach(function (n) {
    if (n.nodeType === 3) { out += n.textContent; return; }
    if (n.nodeType !== 1) return;
    if (n.tagName === 'IMG') {
      var names = [emoteByPicture[pictureKey(n)], n.getAttribute('alt'), n.getAttribute('title'), n.getAttribute('data-emote'), n.getAttribute('data-name'), n.getAttribute('aria-label')];
      for (var i = 0; i < names.length; i++) {
        var nm = String(names[i] || '').replace(/:/g, '').trim();
        if (nm && isEmote(nm)) { out += ' :' + nm + ': '; break; }
      }
      return;
    }
    out += messageText(n, isEmote);
  });
  return out;
}

var rumbleOpts = {
  platform: 'rumble',
  containerSelector: '#chat-history-list, .chat--height',
  messageSelector: '.chat-history--row',
  settleMs: 350,
  extract: function (el) {
    var msg = el.querySelector('.chat-history--message');
    if (!msg) return null;
    var nameEl = el.querySelector('.chat-history--username');
    return { id: el.getAttribute('data-message-id') || '', user: nameEl ? nameEl.textContent.trim() : '', text: messageText(msg, rumbleOpts.isEmote || function () { return false; }) };
  }
};
VSCapture.start(rumbleOpts);
