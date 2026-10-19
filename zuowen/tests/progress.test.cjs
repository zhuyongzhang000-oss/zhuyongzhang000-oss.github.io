/* Run with: node zuowen/tests/progress.test.cjs (no dependencies). */
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data.json')));
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const plain = v => JSON.parse(JSON.stringify(v));
async function app(progress, session) {
  const storage = new Map();
  if (progress) storage.set('zuowen-v1', JSON.stringify(progress));
  if (session) storage.set('zuowen-sess', JSON.stringify(session));
  const nodes = new Map();
  function node(key) {
    if (!nodes.has(key)) nodes.set(key, { innerHTML: '', hidden: true, className: '', value: '',
      classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, focus() {}, blur() {},
      setAttribute() {}, select() {}, setSelectionRange() {}, remove() {}, querySelector: s => node(s), querySelectorAll: () => [] });
    return nodes.get(key);
  }
  const listeners = {};
  const ctx = { console, Date, setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame: fn => fn(),
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    location: { hash: '#/', protocol: 'http:' }, navigator: {},
    fetch: async () => ({ ok: true, json: async () => plain(data) }),
    document: { querySelector: s => node(s), querySelectorAll: () => [], addEventListener: (k, f) => listeners[k] = f,
      getElementById: () => null, documentElement: { dataset: {} }, body: { appendChild() {} }, createElement: () => node('textarea'), execCommand: () => true },
    window: { scrollTo() {}, addEventListener() {} } };
  vm.createContext(ctx);
  const instrumented = source.replace('  boot();', `  globalThis.TEST = { get ST() { return ST; }, get sess() { return sess; }, get sessions() { return layerSessions; }, get ITEMS() { return ITEMS; }, get BY() { return BY; }, setState: v => ST = fresh(v), setSession: v => sess = v, layer, stateOf, errors, inLayer, activeItems, isNew, dueList, newList, weakList, apply, rate, unrate, start, switchLayer, restoreSessions, gptProgress, recordSheet, editRecord, importOk, ACT, route, home, scenePage, tplPage, findPage, weakPage, donePage, today, addDays, cmpSentence, patAnswer, previewAI, boot }; boot();`);
  vm.runInContext(instrumented, ctx);
  await new Promise(resolve => setImmediate(resolve));
  // The real route runs on hashchange; the test DOM dispatches it explicitly.
  const t = ctx.TEST;
  const switchTo = lv => { t.switchLayer(lv); t.route(); };
  return { t, nodes, storage, ctx, switchTo };
}
(async () => {
  const legacy = { items: {
    't.letter': { b: 5, d: '2020-01-01', f: '2019-01-01', n: 8, x: 4, r: 2, t: 100, custom: 'keep' },
    'p.frame.open-invite': { b: 2, d: '2020-01-01', f: '2019-01-01', n: 3, x: 1, r: 2, t: 200 },
    'w.frame.dear': { b: 1, d: '2020-01-01', f: '2019-01-01', n: 2, x: 7, r: 0, t: 300 },
    'old-unknown-id': { b: 3, d: '2030-01-01', n: 4, x: 2, t: 50 }
  }, days: { '2020-01-01': { n: 30, ok: 22 } }, extra: { '2020-01-01': 5 }, prefs: { daily: 10, wmode: 'flip', pmode: 'type' }, customRoot: { keep: true } };
  const session = { kind: 'review', title: '复习', ids: ['t.letter', 'p.frame.open-invite', 'w.frame.dear'], pos: 1, lpos: 0, phase: 'quiz', log: [{ id: 't.letter', r: 2, prev: legacy.items['t.letter'], changed: true, d: '2020-01-01' }], back: '#/' };
  const { t, storage, nodes, switchTo, ctx } = await app(legacy, session);
  assert.deepEqual(JSON.parse(storage.get('zuowen-v1')), legacy, 'boot must not rewrite original progress');
  assert.deepEqual(JSON.parse(storage.get('zuowen-v1-before-layers')), legacy, 'one-time backup is exact');
  assert.deepEqual(plain(t.ST.items), legacy.items);
  assert.equal(t.activeItems().length, 3);
  assert.deepEqual(plain(t.sess.ids), ['t.letter']);
  assert.equal(t.sess.pos, 1);
  assert.equal(t.dueList().length, 1);
  switchTo(2);
  assert.deepEqual(plain(t.sess.ids), ['p.frame.open-invite']);
  assert.equal(t.sess.pos, 0);
  assert(t.dueList().every(x => x.level === 2));
  t.start('review', ['t.letter', 'p.frame.open-invite', 'w.frame.dear'], 'test');
  assert.deepEqual(plain(t.sess.ids), ['p.frame.open-invite']);
  switchTo(3);
  assert.deepEqual(plain(t.sess.ids), ['w.frame.dear']);
  assert(t.newList().every(x => x.level === 3));
  assert(t.weakList().every(x => x.level === 3));
  switchTo(1);
  assert.equal(t.sess.pos, 1, 'switching back retains completed position');
  assert.deepEqual(plain(t.ST.items), legacy.items, 'layer switches do not touch item records');
  assert.deepEqual(plain(t.ST.days), legacy.days);
  assert.deepEqual(plain(t.ST.customRoot), legacy.customRoot);
  const before = plain(t.ST.items['t.letter']);
  t.setSession({ kind: 'practice', ids: ['t.letter'], pos: 0, log: [], phase: 'quiz' });
  let event = t.rate(t.BY['t.letter'], 2);
  assert.equal(t.ST.items['t.letter'].d, before.d, 'early practice cannot advance due date');
  assert.equal(t.ST.items['t.letter'].b, before.b);
  t.unrate(event);
  assert.deepEqual(plain(t.ST.items['t.letter']), before, 'undo restores all fields');
  t.setSession({ kind: 'new', ids: ['t.static'], pos: 0, log: [], phase: 'quiz' });
  event = t.rate(t.BY['t.static'], 0);
  assert.equal(t.ST.items['t.static'].x, 1, 'first failure must count');
  assert.equal(t.stateOf(t.BY['t.static']), 'unlearned');
  t.unrate(event);
  assert.equal(t.ST.items['t.static'], undefined, 'undo first failure removes its new record');
  t.editRecord('t.static', { status: 'used' });
  assert.equal(t.stateOf(t.BY['t.static']), 'used');
  const ai = t.gptProgress();
  assert(ai.includes('【当前层】第1层'));
  for (const para of data.templates.find(x => x.id === 't.letter').paras) assert(ai.includes(typeof para === 'string' ? para : para.t));
  assert(!ai.includes('■ 动态图模板'), 'unlearned template must be excluded');
  assert(ai.indexOf('1. 先查漏任务') < ai.indexOf('2. 再查模板用法'));
  assert(ai.indexOf('2. 再查模板用法') < ai.indexOf('3. 最后查语法'));
  assert(ai.includes('只用我背过的句子改'));
  switchTo(2);
  const ids = t.activeItems().slice(0, 7).map(x => x.id);
  const state = plain(t.ST);
  ids.forEach((id, i) => state.items[id] = { b: 0, n: 1, d: '2020-01-01', x: i + 1, status: 'unlearned', t: i });
  t.setState(state);
  const mistakes = t.gptProgress().split('【当前层最易错的')[1].split('【作文题目】')[0];
  assert.equal((mistakes.match(/^\d+\. /gm) || []).length, 5);
  assert(mistakes.indexOf(ids[6]) < mistakes.indexOf(ids[5]));
  assert(!mistakes.includes(ids[0]) && !mistakes.includes('w.frame.dear'));
  assert(mistakes.includes('未背熟，不可作为改写素材'));
  const pat = t.BY['p.frame.open-invite'];
  assert.equal(t.cmpSentence(pat, pat.base).match, 'base');
  assert(!t.cmpSentence(pat, pat.up).match, 'layer 2 targets base sentences');
  assert(!t.patAnswer(pat).includes(pat.up));
  t.setSession({ kind: 'review', ids: [pat.id], pos: 0, log: [], phase: 'quiz' });
  t.rate(pat, 2, pat.base);
  assert.equal(t.ST.items[pat.id].knownForm, 'base');
  assert(!t.ST.items[pat.upgradeId], 'base success must not mark upgrade as memorized');
  const available = t.gptProgress().split('【已背熟的句子/词汇')[1].split('【当前层最易错的')[0];
  assert(available.includes(pat.base));
  assert(!available.includes(pat.up));
  // Legacy and current exports both import without clearing newer records or unknown IDs.
  nodes.get('#imp') || ctx.document.querySelector('#imp');
  nodes.get('#imp').value = JSON.stringify({ app: 'zuowen', items: { 't.dynamic': { b: 2, n: 2, d: '2030-01-01', x: 3, r: 2, t: Date.now() } }, days: {} });
  t.importOk();
  assert.equal(t.ST.items['t.dynamic'].x, 3);
  assert.equal(t.ST.items['old-unknown-id'].x, 2);
  assert.equal(t.ST.items[pat.id].knownForm, 'base');
  // Render all routes/layers to catch errors in template literals and absent controls.
  for (const lv of [1, 2, 3]) {
    switchTo(lv); t.home(); t.previewAI(); t.findPage(); t.weakPage();
    for (const sc of data.scenes) t.scenePage(sc.id);
    for (const template of data.templates.filter(x => x.level === lv)) t.tplPage(template.id);
  }
  assert.equal(new Set(t.ITEMS.map(x => x.id)).size, t.ITEMS.length, 'IDs must remain unique');
  console.log(`PASS: old progress and unknown fields preserved; ${t.ITEMS.length} unique records; layer isolation, paused sessions, first errors, undo, AI limits, target forms, import and all routes verified.`);
})().catch(err => { console.error(err); process.exitCode = 1; });
