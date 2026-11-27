'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../extension/lib/shared.js');

const mappings = [
  { command: 'hazed', voice: 'hazed', speed: '1.1' },
  { command: '!Mao', voice: 'mao-voice', speed: '', model: 'tts-1' },
  { command: 'broken', voice: '' }
];
const opts = { removeCommand: true, maxChars: 300 };

test('matches a command and strips it', () => {
  const r = S.parse('!hazed hello there', mappings, opts);
  assert.strictEqual(r.match, true);
  assert.strictEqual(r.spoken, 'hello there');
  assert.strictEqual(r.mapping.voice, 'hazed');
});

test('command matching is case-insensitive and mapping may be stored with "!"', () => {
  const r = S.parse('!MAO Welcome', mappings, opts);
  assert.strictEqual(r.match, true);
  assert.strictEqual(r.mapping.voice, 'mao-voice');
});

test('ignores normal chat, unknown commands, empty text and unmapped voices', () => {
  assert.strictEqual(S.parse('hello !hazed', mappings, opts).match, false);
  assert.strictEqual(S.parse('!nope hi', mappings, opts).reason, 'unknown-command');
  assert.strictEqual(S.parse('!hazed', mappings, opts).reason, 'empty');
  assert.strictEqual(S.parse('!hazed    ', mappings, opts).reason, 'empty');
  assert.strictEqual(S.parse('!broken hi', mappings, opts).reason, 'unknown-command');
  assert.strictEqual(S.parse('', mappings, opts).match, false);
});

test('does not treat a longer word as the command', () => {
  assert.strictEqual(S.parse('!hazedx hi', mappings, opts).match, false);
});

test('keeps the command when removeCommand is off', () => {
  assert.strictEqual(S.parse('!hazed hi', mappings, { removeCommand: false, maxChars: 300 }).spoken, '!hazed hi');
});

test('collapses whitespace, strips zero-width characters, truncates by characters', () => {
  assert.strictEqual(S.parse('!hazed  a ​  b\n c', mappings, opts).spoken, 'a b c');
  const long = S.parse('!hazed ' + 'x'.repeat(500), mappings, { removeCommand: true, maxChars: 20 });
  assert.strictEqual(Array.from(long.spoken).length, 20);
  const emoji = S.parse('!hazed ' + '\u{1F600}'.repeat(50), mappings, { removeCommand: true, maxChars: 10 });
  assert.strictEqual(Array.from(emoji.spoken).length, 10);
});

test('speed is limited to 0.5-1.5 in 0.1 steps', () => {
  assert.strictEqual(S.parseSpeed('1,26'), 1.3);
  assert.strictEqual(S.parseSpeed('9'), 1.5);
  assert.strictEqual(S.parseSpeed('0.01'), 0.5);
  assert.strictEqual(S.parseSpeed(1.1), 1.1);
  assert.strictEqual(S.parseSpeed(''), null);
  assert.strictEqual(S.parseSpeed('fast'), null);
  assert.strictEqual(S.parseSpeed(null), null);
  assert.deepStrictEqual(S.speedChoices(), ['0.5', '0.6', '0.7', '0.8', '0.9', '1.0', '1.1', '1.2', '1.3', '1.4', '1.5']);
});

test('commands: 8 characters after the "!" are fine, 9 are refused with an explanation', () => {
  assert.strictEqual(S.MAX_COMMAND_CHARS, 8);
  assert.strictEqual(S.commandProblem('abcdefgh'), '');
  assert.strictEqual(S.commandProblem('!abcdefgh'), '');            // a typed "!" is ignored, not counted twice
  const msg = S.commandProblem('abcdefghi');
  assert.match(msg, /too long\. Maximum is 8 characters\./);
  assert.strictEqual(S.commandProblem('äöüabcde'), ''); // 8 letters incl. umlauts
  assert.match(S.commandProblem('a b'), /may only contain/);
  assert.match(S.commandProblem(''), /empty/);
});

test('default message limit is 190 characters', () => {
  assert.strictEqual(S.DEFAULTS.maxChars, 190);
  const r = S.parse('!hazed ' + 'x'.repeat(400), mappings, { removeCommand: true });
  assert.strictEqual(Array.from(r.spoken).length, 190);
});

test('payload uses per-voice speed/model, falling back to defaults', () => {
  const cfg = Object.assign({}, S.DEFAULTS, { voiceStudioUrl: 'http://127.0.0.1:3900/', model: 'tts-1-hd', speed: 0.9, format: 'wav' });
  const hazed = S.buildPayload(cfg, S.parse('!hazed hi', mappings, opts), { user: 'Jess', platform: 'twitch' });
  assert.deepStrictEqual(hazed, {
    endpoint: 'http://127.0.0.1:8787/vs/v1/audio/speech', model: 'tts-1-hd', voice: 'hazed', format: 'wav',
    text: 'hi', user: 'Jess', platform: 'twitch', command: 'hazed', speed: 1.1
  });
  const mao = S.buildPayload(cfg, S.parse('!mao hi', mappings, opts), {});
  assert.strictEqual(mao.model, 'tts-1');   // per-voice model override
  assert.strictEqual(mao.speed, 0.9);       // falls back to the default speed
});

test('speechBody matches the request VoiceStudio expects', () => {
  const cfg = Object.assign({}, S.DEFAULTS);
  assert.deepStrictEqual(S.speechBody(cfg, { voice: 'hazed', speed: '1.1' }, 'hi'),
    { model: 'tts-1-hd', input: 'hi', voice: 'hazed', response_format: 'wav', speed: 1.1 });
});

test('overlay URL and permission patterns', () => {
  assert.strictEqual(S.overlayUrl({ relayUrl: 'http://127.0.0.1:8787/', overlayId: 'abc' }), 'http://127.0.0.1:8787/overlay.html?id=abc');
  assert.strictEqual(S.permissionPattern('http://127.0.0.1:3900'), null);
  assert.strictEqual(S.permissionPattern('http://localhost:3900'), null);
  assert.strictEqual(S.permissionPattern('http://192.168.1.20:3900'), 'http://192.168.1.20/*');
  assert.strictEqual(S.permissionPattern('nonsense'), null);
});

test('random ids are long, unique and URL-safe', () => {
  const a = S.randomId();
  const b = S.randomId();
  assert.match(a, /^[A-Za-z0-9]{20}$/);
  assert.notStrictEqual(a, b);
});

test('update check: version comparison', () => {
  const S = require('../extension/lib/shared.js');
  assert.strictEqual(S.newerThan('v0.0.10', '0.0.9'), true);
  assert.strictEqual(S.newerThan('0.1.0', '0.0.9'), true);
  assert.strictEqual(S.newerThan('0.0.9', '0.0.9'), false);
  assert.strictEqual(S.newerThan('0.0.8', '0.0.9'), false);
  assert.strictEqual(S.newerThan('1.0', '1.0.0'), false);
  assert.strictEqual(S.newerThan('1.0-beta', '0.0.9'), false);
  assert.strictEqual(S.newerThan('', '0.0.9'), false);
  assert.strictEqual(S.newerThan('latest', '0.0.9'), false);
  assert.strictEqual(S.DEFAULTS.updateCheck, true);
});

test('settings backup: export then import gives the same settings', () => {
  const cfg = { enabled: true, relayUrl: 'http://127.0.0.1:8787/', overlayId: 'abcdefgh1234', voiceStudioUrl: 'http://192.168.1.20:3900', model: 'omnivoice', format: 'mp3', speed: 1.2,
    mappings: [{ command: '!Hazed', voice: 'hazed', voiceName: 'Hazed', speed: '1.1', model: '' }, { command: 'mao', voice: 'mao-voice', speed: 1.5, model: 'tts-1' }],
    removeCommand: false, maxChars: 250, cooldownSec: 7, updateCheck: false, stats: 'not exported' };
  const doc = S.buildExport(cfg, '0.1.0');
  assert.strictEqual(doc.app, 'VoiceStudio+SimpleVoice OBS Connector');
  assert.strictEqual(doc.format, 2);
  assert.strictEqual(doc.settings.stats, undefined);
  const r = S.parseImport(JSON.stringify(doc), 'zzzzzzzzzz');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.warnings, []);
  assert.strictEqual(r.config.overlayId, 'abcdefgh1234');
  assert.strictEqual(r.config.relayUrl, 'http://127.0.0.1:8787');
  assert.deepStrictEqual(r.config.mappings, [
    { command: 'hazed', voice: 'hazed', voiceName: 'Hazed', speed: '1.1', model: '', access: 'everyone' },
    { command: 'mao', voice: 'mao-voice', voiceName: '', speed: '1.5', model: 'tts-1', access: 'everyone' }]);
  assert.strictEqual(r.config.updateCheck, false);
  assert.strictEqual(r.config.removeCommand, false);
  // a second round gives the same thing
  assert.deepStrictEqual(S.parseImport(JSON.stringify(S.buildExport(r.config, '0.1.0')), 'x').config, r.config);
});

test('settings backup: refuses files that are not ours, accepts old files with missing keys', () => {
  assert.strictEqual(S.parseImport('nope').ok, false);
  assert.strictEqual(S.parseImport('{"a":1}').ok, false);
  assert.strictEqual(S.parseImport('[]').ok, false);
  assert.strictEqual(S.parseImport(JSON.stringify({ app: 'VoiceStudio OBS Connector', kind: 'settings', format: 99, settings: {} })).ok, false);
  assert.strictEqual(S.parseImport('x'.repeat(S.MAX_IMPORT_BYTES + 1)).ok, false);
  const r = S.parseImport(JSON.stringify({ app: 'VoiceStudio OBS Connector', kind: 'settings', format: 1, settings: { mappings: [{ command: 'a', voice: 'v' }] } }), 'keepkeepkeep');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.config.overlayId, 'keepkeepkeep');
  assert.strictEqual(r.config.voiceStudioUrl, 'http://127.0.0.1:3900');
  assert.strictEqual(r.config.maxChars, 190);
});

test('settings backup: tampered values are cleaned, not trusted', () => {
  const r = S.sanitizeConfig({ relayUrl: 'javascript:alert(1)', voiceStudioUrl: 'file:///etc/passwd', overlayId: '../x', model: 5, format: 'exe', speed: 99, maxChars: 1e9, cooldownSec: -3,
    mappings: [{ command: 'toolongcmd9', voice: 'v' }, { command: 'ok', voice: 'v', speed: '0.01' }, { command: 'OK', voice: 'w' }, { command: 'x', voice: '' }, 7, null, { command: 'bad cmd!', voice: 'v' }], evil: true }, 'mine12345');
  assert.strictEqual(r.config.relayUrl, 'http://127.0.0.1:8787');
  assert.strictEqual(r.config.voiceStudioUrl, 'http://127.0.0.1:3900');
  assert.strictEqual(r.config.overlayId, 'mine12345');
  assert.strictEqual(r.config.format, 'wav');
  assert.strictEqual(r.config.speed, 1.5);
  assert.strictEqual(r.config.maxChars, 2000);
  assert.strictEqual(r.config.cooldownSec, 0);
  assert.deepStrictEqual(r.config.mappings.map((m) => m.command + ':' + m.speed), ['ok:0.5']);
  assert.strictEqual(r.config.evil, undefined);
  assert.ok(r.warnings.length >= 5);
  const many = S.sanitizeConfig({ mappings: Array.from({ length: 300 }, (_, i) => ({ command: 'c' + i, voice: 'v' })) });
  assert.strictEqual(many.config.mappings.length, 200);
});

// ---- 0.1.1: read all chat ----------------------------------------------------------------
const base = () => Object.assign({}, S.DEFAULTS, { readAll: true, allVoice: 'v1', allVoices: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], maxChars: 100 });

test('allLine: filters', () => {
  const c = base();
  assert.strictEqual(S.allLine(c, 'hello there').text, 'hello there');
  assert.strictEqual(S.allLine(c, '!sr foo').reason, 'bang');
  assert.strictEqual(S.allLine(c, 'look https://x.com/a').reason, 'link');
  assert.strictEqual(S.allLine(c, 'visit example.com now').reason, 'link');
  assert.strictEqual(S.allLine(c, '😂😂').reason, 'nothing-to-read');
  assert.strictEqual(S.allLine(c, 'Kappa 😂 nice').text, 'Kappa nice');
  assert.strictEqual(S.allLine(c, '   ').reason, 'empty');
  c.blockedWords = 'ass';
  assert.strictEqual(S.allLine(c, 'you ass').reason, 'blocked-word');
  assert.strictEqual(S.allLine(c, 'nice bass').ok, true);
  assert.strictEqual(S.allLine(Object.assign(c, { allIgnoreLinks: false }), 'a.com hi').ok, true);
  assert.ok(S.allLine(base(), 'x'.repeat(500)).text.length <= 100);
});

test('ignored names', () => {
  const c = base();
  assert.ok(S.isIgnoredName(c, 'Nightbot'));
  assert.ok(S.isIgnoredName(c, '@streamelements'));
  assert.ok(!S.isIgnoredName(c, 'paul'));
  assert.ok(!S.isIgnoredName(c, ''));
});

test('pickAllVoice: modes', () => {
  const c = base();
  assert.strictEqual(S.pickAllVoice(c, 'k', {}).voice, 'v1');
  c.allVoiceMode = 'random';
  const seen = new Set();
  for (let i = 0; i < 60; i++) seen.add(S.pickAllVoice(c, 'k', {}).voice);
  assert.deepStrictEqual([...seen].sort(), ['a', 'b', 'c']);
  c.allVoiceMode = 'perChatter';
  assert.deepStrictEqual(S.pickAllVoice(c, 'k', { k: 'b' }), { voice: 'b' });
  const as = {};
  ['t:1', 't:2', 't:3'].forEach((k) => { const p = S.pickAllVoice(c, k, as); as[k] = p.assign; });
  assert.deepStrictEqual(Object.values(as).sort(), ['a', 'b', 'c']); // spread over the pool
  assert.ok(S.pickAllVoice(c, 'k', { k: 'gone' }).assign); // voice left the pool: new pick
  c.allVoices = [];
  assert.strictEqual(S.pickAllVoice(c, 'k', {}).voice, 'v1');
});

test('names and payloads', () => {
  const c = base();
  assert.strictEqual(S.spokenName('xX_paul_1234'), 'xX paul');
  assert.strictEqual(S.spokenName('@Anna'), 'Anna');
  c.allSayName = true;
  assert.ok(S.needsName(c, 'k', null, 1000));
  assert.ok(!S.needsName(c, 'k', { key: 'k', at: 900 }, 1000));
  assert.ok(S.needsName(c, 'k', { key: 'z', at: 900 }, 1000));
  assert.ok(S.needsName(c, 'k', { key: 'k', at: 0 }, 200000));
  const plain = S.buildChatPayload(c, 'hi', 'a', { user: 'Paul', platform: 'twitch' }, false);
  assert.strictEqual(plain.kind, 'chat'); assert.strictEqual(plain.text, 'hi'); assert.ok(!plain.intro); assert.strictEqual(plain.maxQueue, 5);
  const same = S.buildChatPayload(c, 'hi', 'a', { user: 'Paul' }, true);
  assert.strictEqual(same.text, 'Paul says: hi'); assert.ok(!same.intro);
  c.allNameVoice = 'narrator';
  const two = S.buildChatPayload(c, 'hi', 'a', { user: 'Paul' }, true);
  assert.strictEqual(two.text, 'hi'); assert.deepStrictEqual([two.intro.text, two.intro.voice], ['Paul says', 'narrator']);
});

test('relay gate', () => {
  assert.strictEqual(S.checkRelayInfo({ version: '0.1.1', protocol: 2 }).ok, true);
  assert.strictEqual(S.checkRelayInfo({ version: '0.0.6' }).ok, false);
  assert.strictEqual(S.checkRelayInfo({ version: '0.0.6' }).reason, 'old');
  assert.strictEqual(S.checkRelayInfo(null).ok, false);
  assert.match(S.relayGateMessage({ ok: false, reason: 'old', version: '0.0.6' }), /too old.*0\.1\.1/);
  assert.match(S.relayGateMessage({ ok: false, reason: 'down', error: 'no answer' }), /not running/);
  assert.strictEqual(S.relayGateMessage({ ok: true }), '');
});

test('sanitizeConfig keeps and bounds the read-all keys', () => {
  const r = S.sanitizeConfig({ readAll: true, allVoiceMode: 'bogus', maxQueue: 9999, allVoices: [{ id: 'a', name: 'A' }, { id: 'a' }, {}] }).config;
  assert.strictEqual(r.readAll, true); assert.strictEqual(r.allVoiceMode, 'fixed');
  assert.ok(r.maxQueue <= 100); assert.strictEqual(r.allVoices.length, 1);
});

test('same-voice name line never exceeds the relay limit of 2000 characters', () => {
  const c = Object.assign(base(), { allSayName: true, maxChars: 2000 });
  const p = S.buildChatPayload(c, 'x'.repeat(2000), 'a', { user: 'Paul' }, true);
  assert.ok(p.text.length <= 2000);
});

// ---- speech engine: VoiceStudio or SimpleVoice OBS (0.2.0) -------------------------------------
const svCfg = { engine: 'simplevoice', relayUrl: 'http://127.0.0.1:8787/', voiceStudioUrl: 'http://127.0.0.1:3900', model: 'tts-1-hd', format: 'mp3', speed: 1 };
const vsCfg = Object.assign({}, svCfg, { engine: 'voicestudio' });

test('engine: default is VoiceStudio, so an old saved setup behaves exactly as before', () => {
  assert.strictEqual(S.DEFAULTS.engine, 'voicestudio');
  assert.strictEqual(S.sanitizeConfig({}).config.engine, 'voicestudio');
  assert.strictEqual(S.sanitizeConfig({ engine: 'simplevoice' }).config.engine, 'simplevoice');
  assert.strictEqual(S.sanitizeConfig({ engine: 'nonsense' }).config.engine, 'voicestudio');
  assert.strictEqual(S.sanitizeConfig({ engine: 5 }).config.engine, 'voicestudio');
  assert.strictEqual(S.engineName(vsCfg), 'VoiceStudio');
  assert.strictEqual(S.engineName(svCfg), 'SimpleVoice OBS');
  assert.strictEqual(S.engineName({}), 'VoiceStudio');
});

test('engine: VoiceStudio requests are unchanged', () => {
  assert.strictEqual(S.speechBase(vsCfg), 'http://127.0.0.1:8787/vs');
  assert.strictEqual(S.speechEndpoint(vsCfg), 'http://127.0.0.1:8787/vs/v1/audio/speech');
  const b = S.speechBody(vsCfg, { voice: 'hazed', model: 'tts-1', speed: '1.2' }, 'hi');
  assert.deepStrictEqual(b, { model: 'tts-1', input: 'hi', voice: 'hazed', response_format: 'mp3', speed: 1.2 });
});

test('engine: SimpleVoice OBS uses the relay address, its one model and WAV, whatever was saved for VoiceStudio', () => {
  assert.strictEqual(S.speechBase(svCfg), 'http://127.0.0.1:8787');
  assert.strictEqual(S.speechEndpoint(svCfg), 'http://127.0.0.1:8787/v1/audio/speech');
  const b = S.speechBody(svCfg, { voice: 'Heart', model: 'tts-1', speed: '0.6' }, 'hi');
  assert.strictEqual(b.model, 'omnivoice');
  assert.strictEqual(b.response_format, 'wav');
  assert.strictEqual(b.voice, 'Heart');
  assert.strictEqual(b.speed, 0.6); // the extension does not clamp: SimpleVoice OBS raises it for imported voices itself
  const p = S.buildPayload(svCfg, { mapping: { voice: 'Heart', speed: '' }, spoken: 'hi', command: 'heart' }, {});
  assert.strictEqual(p.endpoint, 'http://127.0.0.1:8787/v1/audio/speech');
  assert.strictEqual(p.model, 'omnivoice');
  assert.strictEqual(p.format, 'wav');
  // chat lines and the "Paul says" part use the same engine
  const chat = S.buildChatPayload(Object.assign({}, svCfg, { allNameVoice: 'Bella', allSayName: true }), 'hello', 'Heart', { user: 'Paul' }, true);
  assert.strictEqual(chat.endpoint, 'http://127.0.0.1:8787/v1/audio/speech');
  assert.strictEqual(chat.model, 'omnivoice');
  assert.strictEqual(chat.intro.model, 'omnivoice');
});

test('engine: the choice survives export and import; old files without it mean VoiceStudio', () => {
  const doc = S.buildExport(Object.assign({}, S.DEFAULTS, { engine: 'simplevoice', overlayId: 'abcdefgh1234' }), '0.2.0');
  assert.strictEqual(S.parseImport(JSON.stringify(doc), 'x').config.engine, 'simplevoice');
  const old = S.parseImport(JSON.stringify({ app: 'VoiceStudio OBS Connector', kind: 'settings', format: 1, settings: { mappings: [] } }), 'keepkeepkeep');
  assert.strictEqual(old.ok, true);
  assert.strictEqual(old.config.engine, 'voicestudio');
  assert.strictEqual(S.parseImport(JSON.stringify({ app: 'Something else', kind: 'settings', format: 1, settings: {} })).ok, false);
});

test('engine: gate messages name the right program and download page', () => {
  assert.match(S.relayGateMessage({ ok: false, reason: 'down', error: 'connection refused', engine: 'simplevoice' }), /SimpleVoice OBS is not running/);
  assert.match(S.relayGateMessage({ ok: false, reason: 'old', engine: 'simplevoice' }), /1\.0\.0 or newer/);
  assert.match(S.relayGateMessage({ ok: false, reason: 'down', error: 'x' }), /This extension needs relay 0\.1\.1/);
  assert.strictEqual(S.relayPage('simplevoice'), 'https://github.com/eikira/SimpleVoice-OBS/releases/latest');
  assert.strictEqual(S.relayPage('voicestudio'), S.RELAY_RELEASES_PAGE);
  assert.strictEqual(S.relayGateMessage({ ok: true }), '');
});

// A fake fetch: `servers` maps a base address to what answers there.
function fakeFetch(servers) {
  return function (url) {
    const base = Object.keys(servers).filter((b) => url.indexOf(b + '/') === 0).sort((a, b) => b.length - a.length)[0]; // the longest match: VoiceStudio is a path of the relay address
    const s = base && servers[base];
    if (!s) return Promise.reject(new Error('connection refused'));
    const path = base === VSA ? '/health' : '/v1/models'; // VoiceStudio (through the relay: /vs/health), SimpleVoice OBS /v1/models
    if (url !== base + path) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    return Promise.resolve({ ok: s.ok !== false, status: s.ok === false ? 404 : 200, json: () => (s.badJson ? Promise.reject(new Error('x')) : Promise.resolve(s.body)) });
  };
}
const flags = (p) => p.then((r) => ({ simplevoice: r.simplevoice, voicestudio: r.voicestudio }));
const SVA = 'http://127.0.0.1:8787', VSA = 'http://127.0.0.1:8787/vs'; // VoiceStudio is asked through the relay
const models = { object: 'list', data: [{ id: 'omnivoice' }] };
const health = { status: 'ok', device: 'cuda', engine: 'omnivoice', version: '1.2.3' };

test('detect: finds which program answers', async () => {
  const cfg = { relayUrl: SVA + '/', voiceStudioUrl: 'ignored' };
  assert.deepStrictEqual(await flags(S.probeEngines(fakeFetch({ [SVA]: { body: models } }), cfg, 50)), { simplevoice: true, voicestudio: false });
  assert.deepStrictEqual(await flags(S.probeEngines(fakeFetch({ [VSA]: { body: health } }), cfg, 50)), { simplevoice: false, voicestudio: true });
  assert.deepStrictEqual(await flags(S.probeEngines(fakeFetch({ [SVA]: { body: models }, [VSA]: { body: health } }), cfg, 50)), { simplevoice: true, voicestudio: true });
  assert.deepStrictEqual(await flags(S.probeEngines(fakeFetch({}), cfg, 50)), { simplevoice: false, voicestudio: false });
});

test('detect: the standalone relay (no /v1/models) and broken answers do not count as SimpleVoice OBS', async () => {
  const cfg = { relayUrl: SVA, voiceStudioUrl: 'ignored' };
  assert.deepStrictEqual(await flags(S.probeEngines(fakeFetch({ [SVA]: { ok: false } }), cfg, 50)), { simplevoice: false, voicestudio: false });
  assert.deepStrictEqual(await flags(S.probeEngines(fakeFetch({ [SVA]: { badJson: true } }), cfg, 50)), { simplevoice: false, voicestudio: false });
  assert.deepStrictEqual(await flags(S.probeEngines(fakeFetch({ [SVA]: { body: { error: 'x' } } }), cfg, 50)), { simplevoice: false, voicestudio: false });
  assert.deepStrictEqual(await flags(S.probeEngines(fakeFetch({ [SVA]: { body: 'text' } }), cfg, 50)), { simplevoice: false, voicestudio: false });
});

test('detect: a program that never answers does not hang the check', async () => {
  const hang = () => new Promise(() => {});
  const t = Date.now();
  // AbortController cannot stop a fake that ignores it, so the real fetch is what ends it; here we only check that a refusal is fast
  const r = await flags(S.probeEngines(() => Promise.reject(new Error('refused')), { relayUrl: SVA, voiceStudioUrl: 'ignored' }, 50));
  assert.deepStrictEqual(r, { simplevoice: false, voicestudio: false });
  assert.ok(Date.now() - t < 1000);
  void hang;
});

test('detect: both programs are asked on the relay address (VoiceStudio through the relay, /vs)', async () => {
  const urls = [];
  const f = (u, o) => { urls.push(u); return fakeFetch({ [SVA]: { body: models } })(u, o); };
  const r = await flags(S.probeEngines(f, { relayUrl: SVA + '/' }, 50));
  assert.deepStrictEqual(r, { simplevoice: true, voicestudio: false });
  assert.deepStrictEqual(urls.sort(), [SVA + '/v1/models', SVA + '/vs/health']);
});

test('detect: the choice only changes when exactly one program answers', () => {
  assert.deepStrictEqual(S.chooseEngine({ simplevoice: true, voicestudio: false }, 'voicestudio'), { engine: 'simplevoice', change: true, note: 'simplevoice' });
  assert.deepStrictEqual(S.chooseEngine({ simplevoice: true, voicestudio: false }, 'simplevoice'), { engine: 'simplevoice', change: false, note: 'simplevoice' });
  assert.deepStrictEqual(S.chooseEngine({ simplevoice: false, voicestudio: true }, 'simplevoice'), { engine: 'voicestudio', change: true, note: 'voicestudio' });
  assert.deepStrictEqual(S.chooseEngine({ simplevoice: true, voicestudio: true }, 'simplevoice'), { engine: 'simplevoice', change: false, note: 'both' });
  assert.deepStrictEqual(S.chooseEngine({ simplevoice: true, voicestudio: true }, 'voicestudio'), { engine: 'voicestudio', change: false, note: 'both' });
  assert.deepStrictEqual(S.chooseEngine({ simplevoice: false, voicestudio: false }, 'simplevoice'), { engine: 'simplevoice', change: false, note: 'none' });
  assert.deepStrictEqual(S.chooseEngine({ simplevoice: false, voicestudio: false }, 'garbage'), { engine: 'voicestudio', change: false, note: 'none' });
});

test('detect: says why nothing was found, and waits long enough for a slow start', async () => {
  const cfg = { relayUrl: SVA, voiceStudioUrl: 'ignored' };
  const refused = await S.probeEngines(() => Promise.reject(new TypeError('Failed to fetch')), cfg, 50);
  assert.match(refused.why.simplevoice, /connection refused/);
  const notList = await S.probeEngines(fakeFetch({ [VSA]: { body: { error: 'x' } }, [SVA]: { ok: false } }), cfg, 50);
  assert.match(notList.why.voicestudio, /not with a VoiceStudio health answer/);
  assert.match(notList.why.simplevoice, /HTTP 404/);
  // a server that never answers, but honours the abort signal like a real fetch
  const hang = (u, o) => new Promise((res, rej) => { o.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
  const slow = await S.probeEngines(hang, cfg, 60);
  assert.match(slow.why.voicestudio, /no answer within/);
  // a VoiceStudio that needs 3 seconds is found with the default wait (simulated with a short wait here)
  const late = (u, o) => new Promise((res, rej) => {
    const t = setTimeout(() => res({ ok: true, status: 200, json: () => Promise.resolve(u.endsWith('/health') ? health : { data: [] }) }), 150);
    o.signal.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
  });
  assert.strictEqual((await S.probeEngines(late, cfg, 1000)).voicestudio, true);
  assert.strictEqual((await S.probeEngines(late, cfg, 50)).voicestudio, false);
});

test('detect: the request is as plain as the Load buttons (no extra options besides the abort signal)', async () => {
  const seen = [];
  const f = (u, o) => { seen.push(Object.keys(o).sort().join(',')); return Promise.reject(new Error('x')); };
  await S.probeEngines(f, { relayUrl: SVA, voiceStudioUrl: 'ignored' }, 50);
  assert.deepStrictEqual(seen, ['signal', 'signal']);
});

test('detect: VoiceStudio is asked /health (never the slow /v1/models) and a starting VoiceStudio is explained', async () => {
  const urls = [];
  const f = (u) => { urls.push(u); return u.indexOf(VSA + '/') === 0 ? Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({ status: 'starting' }) }) : Promise.reject(new Error('x')); };
  const r = await S.probeEngines(f, { relayUrl: SVA, voiceStudioUrl: 'ignored' }, 50);
  assert.deepStrictEqual(urls.sort(), [SVA + '/v1/models', VSA + '/health'].sort());
  assert.strictEqual(r.voicestudio, false);
  assert.match(r.why.voicestudio, /still starting/);
  assert.strictEqual((await S.probeEngines(fakeFetch({ [VSA]: { body: { status: 'ok' } } }), { relayUrl: SVA, voiceStudioUrl: 'ignored' }, 50)).voicestudio, false);
});

// ---- each program keeps its own setup (sections 2, 3 and 4) ----
const mk = (c, v) => ({ command: c, voice: v, voiceName: '', speed: '', model: '', access: 'everyone' });

test('profiles: a config made before two setups existed becomes the setup of the selected program', () => {
  const a = S.completeProfiles({ engine: 'voicestudio', mappings: [mk('a', 'v1')], model: 'tts-1' });
  assert.deepStrictEqual(a.profiles.voicestudio.mappings, [mk('a', 'v1')]);
  assert.strictEqual(a.profiles.voicestudio.model, 'tts-1');
  assert.deepStrictEqual(a.profiles.simplevoice.mappings, []);
  const b = S.completeProfiles({ engine: 'simplevoice', mappings: [mk('b', 'v2')] });
  assert.deepStrictEqual(b.profiles.simplevoice.mappings, [mk('b', 'v2')]);
  assert.deepStrictEqual(b.profiles.voicestudio.mappings, []);
  // no engine at all (0.1.1) = VoiceStudio
  assert.deepStrictEqual(S.completeProfiles({ mappings: [mk('c', 'v3')] }).profiles.voicestudio.mappings, [mk('c', 'v3')]);
});

test('profiles: the program in use always comes from the flat fields, the other one is kept as it was', () => {
  const stored = { engine: 'simplevoice', mappings: [mk('new', 'x')], profiles: { simplevoice: { mappings: [mk('stale', 's')] }, voicestudio: { mappings: [mk('vs', 'y')], readAll: true } } };
  const c = S.completeProfiles(stored);
  assert.deepStrictEqual(c.profiles.simplevoice.mappings, [mk('new', 'x')]);
  assert.deepStrictEqual(c.profiles.voicestudio.mappings, [mk('vs', 'y')]);
  assert.strictEqual(c.profiles.voicestudio.readAll, true);
  assert.strictEqual(c.profiles.voicestudio.maxQueue, S.DEFAULTS.maxQueue); // missing keys get defaults
  // the input is not changed
  assert.deepStrictEqual(stored.profiles.simplevoice.mappings, [mk('stale', 's')]);
});

test('profiles: export and import keep both setups apart', () => {
  const cfg = S.completeProfiles(Object.assign({}, S.DEFAULTS, { engine: 'simplevoice', overlayId: 'abcdefgh1234', mappings: [mk('sv', 'sarge')], allVoice: 'sarge' }));
  cfg.profiles.voicestudio.mappings = [mk('vs', 'alloy')];
  cfg.profiles.voicestudio.model = 'tts-1';
  const r = S.parseImport(JSON.stringify(S.buildExport(cfg, '0.2.0')), 'x');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.config.engine, 'simplevoice');
  assert.deepStrictEqual(r.config.mappings, [mk('sv', 'sarge')]);
  assert.deepStrictEqual(r.config.profiles.simplevoice.mappings, [mk('sv', 'sarge')]);
  assert.deepStrictEqual(r.config.profiles.voicestudio.mappings, [mk('vs', 'alloy')]);
  assert.strictEqual(r.config.profiles.voicestudio.model, 'tts-1');
  assert.strictEqual(r.config.profiles.simplevoice.allVoice, 'sarge');
  assert.strictEqual(r.config.profiles.voicestudio.allVoice, '');
});

test('profiles: an old export file (flat, format 1, old app name) fills the selected program only', () => {
  const doc = { app: 'VoiceStudio OBS Connector', kind: 'settings', format: 1, settings: { mappings: [mk('old', 'v')], model: 'tts-1' } };
  const r = S.parseImport(JSON.stringify(doc), 'abcdefgh1234');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.config.profiles.voicestudio.mappings, [mk('old', 'v')]);
  assert.deepStrictEqual(r.config.profiles.simplevoice.mappings, []);
});

test('profiles: broken data in the other setup is cleaned, not trusted', () => {
  const r = S.sanitizeConfig({ engine: 'voicestudio', profiles: { simplevoice: { mappings: [{ command: 'toolongcommand', voice: 'v' }, mk('ok', 'v')], speed: 99, allVoiceMode: 'x' } } }, 'abcdefgh1234');
  assert.deepStrictEqual(r.config.profiles.simplevoice.mappings, [mk('ok', 'v')]);
  assert.strictEqual(r.config.profiles.simplevoice.speed, 1.5);
  assert.strictEqual(r.config.profiles.simplevoice.allVoiceMode, 'fixed');
  assert.ok(r.warnings.some((w) => /SimpleVoice OBS/.test(w)));
});

test('voices: only voices that exist in VoiceStudio are offered (the 13 fixed names are not voices)', () => {
  const list = [
    { voice_id: 'alloy', id: 'alloy', name: 'Alloy', type: 'openai_alias' },
    { voice_id: 'nova', id: 'nova', name: 'Nova', type: 'openai_alias' },
    { voice_id: 'demo0001', id: 'demo0001', name: 'tits', type: 'profile' },
    { voice_id: 'p2', id: 'p2', name: 'Mao', type: 'profile' }];
  assert.deepStrictEqual(S.realVoices(list).map((v) => v.id), ['demo0001', 'p2']);
  // SimpleVoice OBS (no type), plain strings and an older VoiceStudio without types are kept
  assert.strictEqual(S.realVoices([{ id: 'Heart', name: 'Heart' }, 'x', { id: 'y' }]).length, 3);
  assert.deepStrictEqual(S.realVoices(null), []);
});

// ---- 0.3.0: voices for subscribers only (Rumble) ----------------------------------------------
const rumbleData = (over) => Object.assign({
  now: '2026-11-15T12:00:10Z', username: 'TheChannel',
  subscribers: { num_subscribers: 2, recent_subscribers: [{ username: 'SubOne' }, { username: 'subtwo' }] },
  livestreams: [{ chat: { recent_messages: [
    { text: '!hazed hello', username: 'SubOne', created_on: '2026-11-15T12:00:08Z' },
    { text: '!mao hi', username: 'Random', created_on: '2026-11-15T12:00:09Z' }] } }]
}, over || {});

test('subscribers: a mapping keeps its access, anything else becomes everyone', () => {
  const r = S.sanitizeConfig({ mappings: [{ command: 'a', voice: 'v', access: 'subs' }, { command: 'b', voice: 'v', access: 'weird' }, { command: 'c', voice: 'v' }] }, 'abcdefgh1234');
  assert.deepStrictEqual(r.config.mappings.map((m) => m.access), ['subs', 'everyone', 'everyone']);
  assert.strictEqual(S.needsSubscriber({ access: 'subs' }), true);
  assert.strictEqual(S.needsSubscriber({ access: 'everyone' }), false);
  assert.strictEqual(S.needsSubscriber({}), false);
});

test('subscribers: the key is cleaned, never exported, and an import keeps the browser\'s own key', () => {
  assert.strictEqual(S.cleanRumbleKey('https://rumble.com/-livestream-api/get-data?key=abcdEFGH1234'), 'abcdEFGH1234');
  assert.strictEqual(S.cleanRumbleKey('  abcdEFGH1234 '), 'abcdEFGH1234');
  assert.strictEqual(S.cleanRumbleKey('short'), '');
  assert.strictEqual(S.cleanRumbleKey('has space inside'), '');
  const doc = S.buildExport(Object.assign({}, S.DEFAULTS, { overlayId: 'abcdefgh1234', rumbleKey: 'abcdEFGH1234' }), '0.3.0');
  assert.strictEqual(JSON.stringify(doc).includes('abcdEFGH1234'), false);
  assert.strictEqual(S.parseImport(JSON.stringify(doc), 'x', 'ownKey12345').config.rumbleKey, 'ownKey12345');
  assert.strictEqual(S.parseImport(JSON.stringify(doc), 'x').config.rumbleKey, '');
  // a key inside a file is ignored too
  const sneaky = JSON.parse(JSON.stringify(doc)); sneaky.settings.rumbleKey = 'fileKey12345';
  assert.strictEqual(S.parseImport(JSON.stringify(sneaky), 'x', 'ownKey12345').config.rumbleKey, 'ownKey12345');
});

test('subscribers: groups: admin, subscriber, nobody', () => {
  const p = S.parseRumbleAnswer(rumbleData());
  assert.strictEqual(p.ok, true);
  assert.strictEqual(p.admin, 'thechannel');
  assert.strictEqual(S.rumbleGroup(p, 'TheChannel'), 'admin');
  assert.strictEqual(S.rumbleGroup(p, '@SubOne'), 'subscriber');
  assert.strictEqual(S.rumbleGroup(p, 'Random'), '');
  assert.strictEqual(S.rumbleGroup(p, ''), '');
  assert.strictEqual(S.rumbleGroup({ ok: false }, 'SubOne'), '');
  assert.strictEqual(S.parseRumbleAnswer({}).ok, false);
  assert.strictEqual(S.parseRumbleAnswer({ subscribers: { num_subscribers: 5 } }).ok, false);
  // only names are kept: nothing else of the answer (like the stream key) is in the result
  assert.deepStrictEqual(Object.keys(S.parseRumbleAnswer(Object.assign(rumbleData(), { stream_key: 'SECRET' }))).sort(), ['admin', 'error', 'listed', 'names', 'ok', 'total']);
});

// ---- 0.3.0: finding the relay -------------------------------------------------------------------
test('detect: only private networks, three numbers', () => {
  assert.strictEqual(S.parseNet('10.10.10'), '10.10.10');
  assert.strictEqual(S.parseNet('10.10.10.x'), '10.10.10');
  assert.strictEqual(S.parseNet(' 192.168.5.0 '), '192.168.5');
  assert.strictEqual(S.parseNet('172.16.3'), '172.16.3');
  assert.strictEqual(S.parseNet('172.31.3'), '172.31.3');
  assert.strictEqual(S.parseNet('172.32.3'), '');
  assert.strictEqual(S.parseNet('20.1.1'), '', '20.x is not a private range');
  assert.strictEqual(S.parseNet('8.8.8'), '');
  assert.strictEqual(S.parseNet('192.168.1.5'), '192.168.1', 'a full address gives its network');
  assert.strictEqual(S.parseNet('300.1.1'), '');
  assert.strictEqual(S.parseNet('banana'), '');
});

test('detect: the address lists', () => {
  const q = S.scanHosts('quick');
  assert.strictEqual(q[0], '127.0.0.1');
  assert.ok(q.includes('10.10.10.5') && q.includes('192.168.178.20') && q.includes('192.168.0.1'));
  assert.ok(!q.includes('10.10.10.0') && !q.includes('10.10.10.255'));
  assert.strictEqual(new Set(q).size, q.length, 'no address twice');
  const n = S.scanHosts('net', { net: '10.20.30' });
  assert.strictEqual(n.length, 1 + 254);
  assert.strictEqual(S.scanHosts('net', { net: '20.1.1' }).length, 1, 'a not-private network adds nothing');
  const w = S.scanHosts('wide');
  assert.ok(w.includes('192.168.77.9') && w.includes('10.0.200.1') && w.includes('172.16.9.9'));
  assert.ok(!w.includes('10.1.0.1') && !w.includes('172.20.0.1'));
  assert.strictEqual(S.scanHosts('quick', { first: '192.168.1.50' })[0], '192.168.1.50', 'the address used now goes first');
  S.scanHosts('wide').concat(q, n).forEach((h) => assert.ok(/^(127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h), h));
});

test('detect: finds relays by /info and ignores everything else', async () => {
  const answers = {
    '192.168.1.20': { ok: true, name: 'VoiceStudio OBS Connector Relay', version: '0.0.9', protocol: 2, listening: '192.168.1.20', adapter: 'Ethernet' },
    '192.168.1.21': { ok: true, version: '0.0.8', protocol: 2 },
    '192.168.1.22': { ok: true, version: '0.0.5' },
    '192.168.1.23': { hello: 'router login page' }
  };
  const asked = [];
  const fake = (url) => {
    const host = /http:\/\/([^:]+):(\d+)\/info$/.exec(url);
    asked.push(url);
    if (!host || host[2] !== '8787') return Promise.reject(new Error('bad url'));
    const d = answers[host[1]];
    return d ? Promise.resolve({ ok: true, json: () => Promise.resolve(d) }) : Promise.reject(new Error('refused'));
  };
  let progress = 0;
  const r = await S.scanForRelays(fake, S.scanHosts('net', { net: '192.168.1' }), 8787, { onProgress: () => { progress++; } });
  assert.strictEqual(r.done, 255);
  assert.strictEqual(progress, 255);
  assert.deepStrictEqual(r.found.map((f) => f.host).sort(), ['192.168.1.20', '192.168.1.21']);
  const f = r.found.find((x) => x.host === '192.168.1.20');
  assert.strictEqual(f.name, 'VoiceStudio OBS Connector Relay');
  assert.strictEqual(S.listeningText(f), '192.168.1.20 (Ethernet)');
  assert.strictEqual(r.found.find((x) => x.host === '192.168.1.21').name, 'Relay (older version)');
  assert.ok(asked.every((u) => u.endsWith(':8787/info')), 'only /info on the chosen port');
  // another port: not found
  assert.strictEqual((await S.scanForRelays(fake, ['192.168.1.20'], 9000, {})).found.length, 0);
});

test('detect: can be cancelled', async () => {
  let n = 0, cancel = false;
  const fake = () => { n++; if (n === 5) cancel = true; return Promise.reject(new Error('no')); };
  const r = await S.scanForRelays(fake, S.scanHosts('wide'), 8787, { concurrency: 2, isCancelled: () => cancel });
  assert.strictEqual(r.cancelled, true);
  assert.ok(n < 20, 'stopped soon after the cancel, asked ' + n);
});

test('detect: the listening text', () => {
  assert.strictEqual(S.listeningText({ listening: '127.0.0.1' }), 'this PC only (127.0.0.1)');
  assert.strictEqual(S.listeningText({ listening: '192.168.1.5', adapter: 'Wi-Fi' }), '192.168.1.5 (Wi-Fi)');
  assert.strictEqual(S.listeningText({}), '');
});

test('detect: the address used now is only added when it is private', () => {
  assert.ok(!S.scanHosts('quick', { first: '8.8.8.8' }).includes('8.8.8.8'));
  assert.ok(!S.scanHosts('quick', { first: '20.1.2.3' }).includes('20.1.2.3'));
});

test('relay gate: the standalone VoiceStudio relay while SimpleVoice OBS is selected says so; messages name the address and both programs', () => {
  const vsRelay = { ok: true, name: 'VoiceStudio OBS Connector Relay', version: '0.1.1', protocol: 2, voicestudio: 'http://127.0.0.1:3900' };
  const g = S.checkRelayInfo(vsRelay, 'simplevoice');
  assert.strictEqual(g.ok, false);
  assert.strictEqual(g.reason, 'other');
  assert.match(S.relayGateMessage(Object.assign({ engine: 'simplevoice', url: 'http://10.10.10.16:8787' }, g)), /VoiceStudio relay.*SimpleVoice OBS.*selected/);
  assert.strictEqual(S.checkRelayInfo(vsRelay, 'voicestudio').ok, true);
  assert.strictEqual(S.checkRelayInfo({ ok: true, name: 'SimpleVoice OBS Relay', version: '1.0.2', protocol: 2 }, 'simplevoice').ok, true);
  assert.strictEqual(S.checkRelayInfo(vsRelay).ok, true, 'no engine given: as before');
  const sv = S.relayGateMessage({ ok: false, reason: 'down', error: 'no answer', engine: 'simplevoice', url: 'http://127.0.0.1:8787' });
  assert.match(sv, /not reachable at http:\/\/127\.0\.0\.1:8787/);
  assert.match(sv, /Choose VoiceStudio/);
  assert.match(sv, /Detect relay/);
  const vs = S.relayGateMessage({ ok: false, reason: 'down', error: 'no answer', engine: 'voicestudio', url: 'http://10.10.10.16:8787' });
  assert.match(vs, /not reachable at http:\/\/10\.10\.10\.16:8787/);
  assert.match(vs, /SimpleVoice OBS instead/);
});

test('relay gate: with VoiceStudio selected the relay must be one that passes VoiceStudio through', () => {
  const oldRelay = { ok: true, name: 'VoiceStudio OBS Connector Relay', version: '0.0.9', protocol: 2, listening: '127.0.0.1' };
  const g = S.checkRelayInfo(oldRelay, 'voicestudio');
  assert.strictEqual(g.ok, false);
  assert.strictEqual(g.reason, 'old');
  assert.match(S.relayGateMessage(Object.assign({ engine: 'voicestudio' }, g)), /too old.*0\.1\.1/);
  assert.strictEqual(S.checkRelayInfo(Object.assign({}, oldRelay, { version: '0.1.1', voicestudio: 'http://127.0.0.1:3900' }), 'voicestudio').ok, true);
  assert.strictEqual(S.checkRelayInfo(oldRelay, 'simplevoice').reason, 'other', 'SimpleVoice OBS selected: the other message');
});

test('soundbites: a message of only known emotes is a soundbite message', () => {
  const names = ['choppa', 'Boom'];
  assert.strictEqual(S.soundbiteOnly(':choppa:', names), true);
  assert.strictEqual(S.soundbiteOnly('  :CHOPPA:   :boom: ', names), true);
  assert.strictEqual(S.soundbiteOnly(':choppa: hello', names), false);
  assert.strictEqual(S.soundbiteOnly(':unknown:', names), false);
  assert.strictEqual(S.soundbiteOnly(':choppa: :unknown:', names), false);
  assert.strictEqual(S.soundbiteOnly('', names), false);
  assert.strictEqual(S.soundbiteOnly(':choppa:', []), false);
  assert.strictEqual(S.soundbiteOnly('12:30:45', names), false);
});

test('soundbites: hasSoundbite finds a known emote inside a longer message', () => {
  assert.strictEqual(S.hasSoundbite('hello :choppa: friend', ['choppa']), true);
  assert.strictEqual(S.hasSoundbite('hello :other: friend', ['choppa']), false);
  assert.strictEqual(S.hasSoundbite('hello', ['choppa']), false);
  assert.strictEqual(S.hasSoundbite(':a: :choppa:', ['choppa']), true);
});
