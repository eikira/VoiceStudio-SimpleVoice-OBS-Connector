'use strict';
// Runs background.js in a small fake browser (no Chrome needed): the subscriber check and the soundbites.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', 'extension');

function make(cfgPatch, opts) {
  opts = opts || {};
  const store = {
    local: { config: Object.assign({ enabled: true, overlayId: 'abc', relayUrl: 'http://127.0.0.1:8787', engine: 'simplevoice', cooldownSec: 0,
      mappings: [{ command: 'sub', voice: 'anna', access: 'subs' }, { command: 'all', voice: 'bob' }], rumbleKey: 'abcdefghij12345' }, cfgPatch || {}) },
    session: {}
  };
  const area = (n) => ({
    get: async (k) => { const o = {}; (Array.isArray(k) ? k : [k]).forEach((x) => { if (store[n][x] !== undefined) o[x] = store[n][x]; }); return o; },
    set: async (o) => { Object.assign(store[n], o); }
  });
  let listener;
  const posts = [];
  let rumbleCalls = 0;
  const chrome = {
    storage: { local: area('local'), session: area('session'), onChanged: { addListener() {} } },
    runtime: { id: 'x', onMessage: { addListener: (f) => { listener = f; } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, getManifest: () => ({ version: '0' }) },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {}, setTitle() {} }, scripting: {}, tabs: { onUpdated: { addListener() {} }, query: async () => [] },
    permissions: { contains: async () => true }
  };
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  async function fetch(url, o) {
    if (url.endsWith('/info')) return ok({ name: 'SimpleVoice OBS', version: '1.0.4', protocol: 99 });
    if (url.endsWith('/v1/soundbites')) return ok({ soundbites: opts.clips || [] });
    if (url.includes('rumble.com/-livestream-api')) {
      rumbleCalls++;
      if (opts.rumble403) return { ok: false, status: 403, json: async () => ({}) };
      return ok({ username: 'TheChannel', subscribers: { num_subscribers: 2, recent_subscribers: [{ username: 'SubOne' }, { username: 'SubTwo' }] } });
    }
    if (url.includes('/send')) { posts.push(JSON.parse(o.body)); return ok({ ok: true, listeners: 1 }); }
    return { ok: false, status: 404, json: async () => ({}) };
  }
  const ctx = vm.createContext({ chrome, fetch, self: {}, console, setTimeout, clearTimeout, AbortController, Promise, Date, Map, Array, Object, JSON, String, Number, Math, URL });
  vm.runInContext(fs.readFileSync(path.join(dir, 'lib', 'shared.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(dir, 'background.js'), 'utf8'), ctx);
  let n = 0;
  const chat = (platform, user, text) => new Promise((r) => listener({ type: 'chat', platform, user, text, id: String(++n) }, { id: 'x' }, r));
  const lastError = () => (store.session.stats && store.session.stats.lastError) || '';
  return { chat, posts, lastError, rumbleCalls: () => rumbleCalls, store };
}

test('subscribers-only voice: subscriber and admin are read, others are refused with a reason', async () => {
  const h = make();
  await h.chat('rumble', 'SubOne', '!sub hello');
  assert.strictEqual(h.posts.length, 1);
  await h.chat('rumble', 'Random', '!sub hello');
  assert.strictEqual(h.posts.length, 1);
  assert.match(h.lastError(), /Random is not a subscriber/);
  await h.chat('rumble', 'thechannel', '!sub hi there');
  assert.strictEqual(h.posts.length, 2, 'the admin, written in other letters');
  await h.chat('rumble', 'Random', '!all hello');
  assert.strictEqual(h.posts.length, 3, 'a voice for everyone does not check anything');
  assert.strictEqual(h.rumbleCalls(), 1, 'Rumble is asked once for these commands (30 s)');
});

test('subscribers-only voice: other platforms, missing key and a refused key say why', async () => {
  let h = make();
  await h.chat('twitch', 'SubOne', '!sub hello');
  assert.strictEqual(h.posts.length, 0);
  assert.match(h.lastError(), /Rumble only/);
  h = make({ rumbleKey: '' });
  await h.chat('rumble', 'SubOne', '!sub hello');
  assert.strictEqual(h.posts.length, 0);
  assert.match(h.lastError(), /add your Rumble key/);
  h = make({}, { rumble403: true });
  await h.chat('rumble', 'SubOne', '!sub hello');
  assert.strictEqual(h.posts.length, 0);
  assert.match(h.lastError(), /did not accept the key/);
});

test('soundbites: a message of only known emotes is sent, anything else stays as before', async () => {
  const h = make({}, { clips: [{ name: 'choppa' }] });
  await h.chat('rumble', 'a', '!all first');   // learns the clip names on the first message
  const before = h.posts.length;
  await h.chat('rumble', 'b', ':choppa:');
  assert.strictEqual(h.posts.length, before + 1);
  assert.strictEqual(h.posts[h.posts.length - 1].text, ':choppa:');
  await h.chat('rumble', 'c', 'hello :choppa:');   // not a command, read-all is off
  await h.chat('rumble', 'd', ':other:');
  assert.strictEqual(h.posts.length, before + 1);
  await h.chat('rumble', 'e', '!all hello :choppa: friend');
  assert.strictEqual(h.posts[h.posts.length - 1].text, 'hello :choppa: friend');
});

test('soundbites: with the VoiceStudio relay there is no clip list and nothing changes', async () => {
  const h = make({ engine: 'voicestudio', voiceStudioUrl: 'http://127.0.0.1:3900' }, { clips: [{ name: 'choppa' }] });
  await h.chat('rumble', 'b', ':choppa:');
  assert.strictEqual(h.posts.length, 0);
});
