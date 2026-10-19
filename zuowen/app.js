"use strict";
/* 作文背诵（考研英语二）：单词（带「记不住就用」的替换词）、句型（升级 / 保底）、模板、例文。
   内容在 data.json（改法见 README.md），进度只存在这台设备的浏览器里（localStorage）。
   页面：#/ 首页 · #/s 背诵（新内容先看一遍再测）· #/done 背完 · #/scene/<场景> · #/tpl/<模板> · #/essay/<例文>
         #/find 查 · #/weak 没记牢的 · #/guide 要点
   复习规则：记得 → 1、3、7、14、30、60 天后再背；模糊 → 明天再背（降一级）；忘了 → 明天再背（从头来）。
   「练一练」（板块、没记牢的、背完再练）只在忘了时改复习时间，记得不改——提前练对不算数。 */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const dots = s => esc(s).replace(/\.\.\./g, "…");
  const bar = $("#bar"), view = $("#view"), strip = $("#strip"), sheet = $("#sheet"), scrim = $("#scrim");
  const ICON = {
    back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>',
    undo: '<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
    find: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>',
    say: '<svg viewBox="0 0 24 24"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  };

  /* ───── 存储：只在这台设备上 ───── */
  const KEY = "zuowen-v1", SKEY = "zuowen-sess", LKEY = "zuowen-sessions-by-layer";
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };
  const DEFAULT_PREFS = { daily: 15, wmode: "type", pmode: "flip", layer: 1 };
  let ST = fresh(store.get(KEY, null));
  function fresh(s) {
    s = s && typeof s === "object" ? s : {};
    const prefs = { ...DEFAULT_PREFS, ...(s.prefs || {}) };
    if (![1, 2, 3].includes(prefs.layer)) prefs.layer = 1;
    return { ...s, items: s.items || {}, days: s.days || {}, extra: s.extra || {}, prefs };
  }
  let warned = false;
  function save() { if (!store.set(KEY, ST) && !warned) { warned = true; toast("这个浏览器存不了进度（无痕模式？），关掉网页就没了", 4200); } }
  let sess = store.get(SKEY, null);
  let layerSessions = store.get(LKEY, {}) || {};
  const saveSess = () => { layerSessions[ST.prefs.layer] = sess; store.set(SKEY, sess); store.set(LKEY, layerSessions); };

  /* ───── 日期：凌晨 4 点前算前一天 ───── */
  const ymd = t => t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
  const today = () => ymd(new Date(Date.now() - 4 * 3600e3));
  const addDays = (d, n) => { const t = new Date(d + "T00:00"); t.setDate(t.getDate() + n); return ymd(t); };
  const md = d => { const [, m, dd] = d.split("-"); return +m + "月" + +dd + "日"; };
  function dayLabel(d) {
    const n = Math.round((new Date(d + "T00:00") - new Date(today() + "T00:00")) / 864e5);
    return n <= 0 ? "今天" : n === 1 ? "明天" : n === 2 ? "后天" : n < 7 ? `${n} 天后` : md(d);
  }

  /* ───── 内容 ───── */
  let D = null, ITEMS = [], BY = {}, SC = {}, PARTS = {};
  const TYPE = { w: "单词", p: "句型", t: "模板" };
  function index() {
    PARTS = Object.fromEntries(D.parts.map(p => [p.id, p]));
    SC = Object.fromEntries(D.scenes.map(s => [s.id, { ...s, items: [] }]));
    ITEMS = [];
    for (const sid of D.order) {
      const add = (list, type) => list.filter(x => x.scene === sid).forEach(x => { const it = { ...x, type, part: SC[sid].part, level: x.level || (type === "w" ? 3 : ["t.letter", "t.static", "t.dynamic"].includes(x.id) ? 1 : 2) }; SC[sid].items.push(it); ITEMS.push(it); });
      add(D.words, "w"); add(D.patterns, "p"); add(D.templates, "t");
      // Upgrade variants get separate IDs; learning the base sentence never marks the upgrade as known.
      add(D.patterns.filter(p => p.upgradeId).map(p => ({ ...p, id: p.upgradeId, sourceId: p.id, level: 3, targetForm: "up", zh: p.zh + "（升级句）" })), "p");
    }
    ITEMS.forEach((it, i) => { it.i = i; });
    BY = Object.fromEntries(ITEMS.map(it => [it.id, it]));
    for (const t of D.templates) if (!BY[t.id]) BY[t.id] = { ...t, type: "t", part: t.part };
  }
  const rec = it => ST.items[it.id];
  const STATUS = { unlearned: "未背", memorized: "背熟", used: "用对过" };
  const layer = () => ST.prefs.layer;
  const inLayer = it => it.level === layer();
  const activeItems = () => ITEMS.filter(inLayer);
  const stateOf = it => {
    const r = rec(it);
    if (!r) return "unlearned";
    return STATUS[r.status] ? r.status : (r.r === 2 || r.b >= 5 ? "memorized" : "unlearned");
  };
  const errors = it => Math.max(0, Number(rec(it)?.x) || 0);
  const isNew = it => !rec(it) || (!rec(it).n && stateOf(it) === "unlearned");
  const isMastered = it => stateOf(it) !== "unlearned";
  const LEVELS = [{ id: 1, name: "先背模板", desc: "书信模板 · 静态图模板 · 动态图模板" }, { id: 2, name: "补齐功能", desc: "功能句型 · 通知 · 特殊图表表达" }, { id: 3, name: "升级表达", desc: "升级词汇 · 短语与替换表达" }];
  const layerInfo = () => (D.levels || LEVELS).find(x => x.id === layer());
  const recordControl = it => `<button class="record-control" data-act="record" data-id="${esc(it.id)}" aria-label="管理${esc(it.name || it.zh)}的记录">${STATUS[stateOf(it)]} · 答错 ${errors(it)} 次 <span>管理 ›</span></button>`;

  // Keep the old mixed session intact as a backup, then split it by layer.
  function restoreSessions() {
    if (sess?.ids && sess.ids.some(id => BY[id] && !inLayer(BY[id]))) {
      if (!store.get("zuowen-sess-before-layers", null)) store.set("zuowen-sess-before-layers", sess);
      for (const lv of [1, 2, 3]) {
        const belongs = id => BY[id]?.level === lv;
        const ids = sess.ids.filter(belongs);
        if (!ids.length || layerSessions[lv]) continue;
        layerSessions[lv] = { ...sess, ids, pos: sess.ids.slice(0, sess.pos || 0).filter(belongs).length,
          lpos: sess.ids.slice(0, sess.lpos || 0).filter(belongs).length, log: (sess.log || []).filter(e => belongs(e.id)), layer: lv };
      }
      sess = layerSessions[layer()] || null;
    } else if (!sess) sess = layerSessions[layer()] || null;
    if (sess?.ids) sess.ids = sess.ids.filter(id => BY[id] && inLayer(BY[id]));
    saveSess();
  }
  function switchLayer(next) {
    if (![1, 2, 3].includes(next) || next === layer()) return;
    saveSess(); ST.prefs.layer = next;
    sess = layerSessions[next] || null; saveSess(); save();
    go("#/"); toast(`已切到第 ${next} 层，原来的进度都保留了`);
  }
  function recordSheet(id) {
    const it = BY[id];
    if (!it || !inLayer(it)) return;
    openSheet(`<h3>${esc(it.name || it.zh)}</h3><p class="sub">未背：还不能独立回忆；背熟：能独立默出；用对过：在作文里正确用过。</p>
      <div class="status-options">${Object.entries(STATUS).map(([v, text]) => `<button class="btn${stateOf(it) === v ? " primary" : ""}" data-act="set-status" data-id="${esc(id)}" data-v="${v}" aria-pressed="${stateOf(it) === v}">${text}</button>`).join("")}</div>
      <p class="sub" style="margin-top:16px">累计答错 ${errors(it)} 次。默写答错或点「不会／忘了」会自动加 1，第一次答错也计数。</p>
      <div class="acts"><button class="btn small" data-act="add-error" data-id="${esc(id)}">作文里用错了 +1</button><button class="btn small" data-act="close">完成</button></div>`);
  }
  function editRecord(id, change) {
    const it = BY[id]; if (!it || !inLayer(it)) return;
    const before = rec(it) ? { ...rec(it) } : null;
    ST.items[id] = { ...(before || { b: 0, n: 0, f: today(), d: addDays(today(), 1), x: 0 }), ...change, t: Date.now() };
    save(); route(); recordSheet(id);
  }
  const isWeak = it => { const r = rec(it); return !!r && r.x > 0 && r.b <= 1; };
  const isDue = (it, d = today()) => { const r = rec(it); return !!r && r.d <= d; };
  function dueList() {
    const d = today();
    return activeItems().filter(it => !isNew(it) && isDue(it, d)).sort((a, b) => (rec(a).d < rec(b).d ? -1 : rec(a).d > rec(b).d ? 1 : 0) || (rec(b).x - rec(a).x) || a.i - b.i);
  }
  const learnedToday = () => { const d = today(); return activeItems().filter(it => !isNew(it) && rec(it).f === d).length; };
  const quota = () => (ST.prefs.daily || 15) + (ST.extra[today()] || 0);
  function newList(scene) {
    if (scene) return SC[scene].items.filter(inLayer).filter(isNew);
    const n = Math.max(0, quota() - learnedToday());
    return n ? activeItems().filter(isNew).slice(0, n) : [];
  }
  const weakList = () => activeItems().filter(isWeak);

  /* ───── 复习规则 ───── */
  const IV = [1, 3, 7, 14, 30, 60];
  function apply(prev, r, d) {
    const o = prev ? { ...prev } : { b: 0, f: d, n: 0, x: 0 };
    o.n = (o.n || 0) + 1; o.l = d; o.r = r; o.t = Date.now();
    o.status = r === 2 ? (prev?.status === "used" ? "used" : "memorized") : "unlearned";
    if (r === 2) { o.b = Math.min((o.b || 0) + 1, IV.length); o.d = addDays(d, IV[o.b - 1]); }
    else if (r === 1) { o.b = Math.max(1, (o.b || 0) - 1); o.d = addDays(d, 1); }
    else { o.x = (o.x || 0) + 1; o.b = 0; o.d = addDays(d, 1); }
    return o;
  }
  function streak() {
    let d = today(), n = 0;
    if (!ST.days[d]) d = addDays(d, -1);
    while (ST.days[d] && ST.days[d].n) { n++; d = addDays(d, -1); }
    return n;
  }

  /* ───── 判分 ───── */
  // 和 check.py 一样：ans 里「;」分开要写的几个词形，「|」分开任选；不写 ans 就用 en，括号里是说明，「 / 」当任选
  const clean = s => s.replace(/（[^）]*）|\([^)]*\)/g, "").replace(/\.\.\.|…/g, " ").replace(/\s*\/\s*/g, "|").trim();
  const groups = src => src.split(";").map(g => g.split("|").map(a => a.trim()).filter(Boolean)).filter(g => g.length);
  const mainParts = w => groups(w.ans || clean(w.en));
  const altList = w => (w.alt || w.altAns ? groups(w.altAns || clean(w.alt)).flat() : []);
  const norm = s => s.replace(/[’‘`]/g, "'").replace(/\.\.\.|…/g, " ").replace(/[.,!?;:，。；：！？]/g, "").replace(/\s+/g, " ").trim();
  function same(input, alt) {
    const a = norm(input), b = norm(alt);
    if (/[A-Z]/.test(b)) return a === b ? "ok" : a.toLowerCase() === b.toLowerCase() ? "case" : "no";
    return a.toLowerCase() === b.toLowerCase() ? "ok" : "no";
  }
  function lev(a, b) {
    const m = a.length, n = b.length, d = [];
    for (let i = 0; i <= m; i++) d[i] = [i];
    for (let j = 0; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }
  function gradeWord(w, inputs) {
    const ps = mainParts(w), used = [], cells = [];
    let all = inputs.length >= ps.length, caseOnly = false;
    for (const inp of inputs) {
      let hit = -1;
      for (let i = 0; i < ps.length && hit < 0; i++) {
        if (used[i]) continue;
        for (const a of ps[i]) { const r = same(inp, a); if (r === "ok") { hit = i; break; } if (r === "case") caseOnly = true; }
      }
      if (hit >= 0) { used[hit] = true; cells.push({ ok: true }); } else { all = false; cells.push({ ok: false }); }
    }
    if (all) return { r: 2, cells };
    if (ps.length === 1 && inputs[0].trim() && altList(w).some(a => same(inputs[0], a) === "ok")) return { r: 1, cells: [{ ok: false, mid: true }] };
    cells.forEach((c, k) => {
      if (c.ok) return;
      let best = null, bd = 1e9;
      ps.forEach((p, i) => { if (!used[i]) p.forEach(a => { const dd = lev(norm(inputs[k]).toLowerCase(), norm(a).toLowerCase()); if (dd < bd) { bd = dd; best = a; } }); });
      c.near = best; c.dist = bd;
    });
    return { r: 0, cells, caseOnly };
  }
  // 逐字母对比：<del> 多写或写错的，<ins> 漏掉的
  function diff(a, b) {
    const m = a.length, n = b.length, L = [];
    for (let i = 0; i <= m; i++) { L[i] = []; for (let j = 0; j <= n; j++) L[i][j] = 0; }
    for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let html = "", buf = "", tag = "";
    const flush = () => { if (buf) html += tag ? `<${tag}>${esc(buf)}</${tag}>` : esc(buf); buf = ""; };
    const push = (t, c) => { if (t !== tag) { flush(); tag = t; } buf += c; };
    let i = 0, j = 0;
    while (i < m && j < n) {
      if (a[i] === b[j]) { push("", a[i]); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) { push("del", a[i]); i++; }
      else { push("ins", b[j]); j++; }
    }
    while (i < m) { push("del", a[i]); i++; }
    while (j < n) { push("ins", b[j]); j++; }
    flush();
    return html;
  }

  // 句子：不分大小写、不管标点；I'd = I would 这类缩写算一样；(should) 写不写都行；... 可以写任何内容
  const CONTRACT = [[/\bi'm\b/g, "i am"], [/\bi'd\b/g, "i would"], [/\bi'll\b/g, "i will"], [/\bit's\b/g, "it is"], [/\bthat's\b/g, "that is"],
    [/\bdon't\b/g, "do not"], [/\bdoesn't\b/g, "does not"], [/\bdidn't\b/g, "did not"], [/\bcan't\b/g, "cannot"], [/\bcan not\b/g, "cannot"], [/\bwon't\b/g, "will not"],
    [/\bisn't\b/g, "is not"], [/\baren't\b/g, "are not"], [/\byou're\b/g, "you are"], [/\bwe're\b/g, "we are"], [/\bthey're\b/g, "they are"],
    [/\byou'll\b/g, "you will"], [/\bwe'll\b/g, "we will"], [/\blet's\b/g, "let us"], [/\bthere's\b/g, "there is"]];
  function toks(s, wild) {
    let t = s.toLowerCase().replace(/[’‘`]/g, "'");
    if (wild) t = t.replace(/\.\.\.|…/g, " \u0001 "); else t = t.replace(/\.\.\.|…/g, " ");
    t = t.replace(/(\d),(\d{3})/g, "$1$2");
    t = t.replace(/\b([ap])\.\s?m\b\.?/g, "$1m");
    for (const [re, to] of CONTRACT) t = t.replace(re, to);
    t = t.replace(/[^a-z0-9%'\u0001\s-]/g, " ").replace(/(^|\s)'|'(\s|$)/g, " ");
    return t.split(/\s+/).filter(Boolean);
  }
  const variants = s => [...new Set([s.replace(/\(([^)]*)\)/g, "$1"), s.replace(/\s*\([^)]*\)/g, "")])];
  function glob(t, u) {          // t 里的 \u0001 能匹配任意多个词
    const m = t.length, n = u.length, M = [];
    for (let i = 0; i <= m; i++) M[i] = new Array(n + 1).fill(false);
    M[m][n] = true;
    for (let i = m - 1; i >= 0; i--) for (let j = n; j >= 0; j--) {
      if (t[i] === "\u0001") M[i][j] = M[i + 1][j] || (j < n && M[i][j + 1]);
      else M[i][j] = j < n && t[i] === u[j] && M[i + 1][j + 1];
    }
    return M[0][0];
  }
  function lcsMarks(t, u) {      // 标出目标句里哪些词你写到了
    const m = t.length, n = u.length, L = [];
    for (let i = 0; i <= m; i++) L[i] = new Array(n + 1).fill(0);
    for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = t[i] === u[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const hit = new Array(m).fill(false);
    let i = 0, j = 0;
    while (i < m && j < n) { if (t[i] === u[j]) { hit[i] = true; i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++; }
    return { hit, score: L[0][0] };
  }
  function cmpSentence(p, typed) {
    const u = toks(typed, false);
    for (const key of (p.targetForm === "base" ? ["base"] : ["up", "base"])) for (const v of variants(p[key])) if (glob(toks(v, true), u)) return { match: key };
    let best = null;
    for (const key of (p.targetForm === "base" ? ["base"] : ["up", "base"])) for (const v of variants(p[key])) {
      const words = v.split(/\s+/).filter(Boolean), keys = words.map(w => toks(w, true).filter(x => x !== "\u0001"));
      const flat = keys.flat(), mk = lcsMarks(flat, u), ratio = mk.score / Math.max(1, flat.length);
      if (!best || ratio > best.ratio) {
        let k = 0;
        const html = words.map((w, wi) => {
          const n = keys[wi].length, miss = keys[wi].some((_, q) => !mk.hit[k + q]);
          k += n;
          return n && miss ? `<mark>${dots(w)}</mark>` : dots(w);
        }).join(" ");
        best = { key, ratio, html };
      }
    }
    return { match: null, best };
  }

  /* ───── 外壳：顶栏、进度条、弹层、提示 ───── */
  function setBar(left, title, right = "", small = false) {
    bar.innerHTML = `${left}<span class="title${small ? " small" : ""}">${esc(title)}</span><span class="sp"></span>${right}`;
  }
  const backBtn = to => `<a class="ib" href="${esc(to)}" aria-label="返回">${ICON.back}</a>`;
  const menuBtn = `<button class="ib" data-act="menu" aria-label="设置">${ICON.more}</button>`;
  function render(html, narrow) { view.className = "view" + (narrow ? " narrow" : ""); view.innerHTML = html; }
  function setStrip(parts) {
    if (!parts) { strip.hidden = true; return; }
    strip.hidden = false;
    strip.innerHTML = parts.map(([c, x]) => `<i class="${c}" style="width:${Math.max(0, x) * 100}%"></i>`).join("");
  }
  function openSheet(html) {
    sheet.innerHTML = `<div class="grip"></div>${html}`;
    sheet.hidden = false; scrim.hidden = false;
  }
  function closeSheet() { sheet.hidden = true; scrim.hidden = true; }
  scrim.addEventListener("click", closeSheet);
  let toastT;
  function toast(msg, ms = 2200) {
    const t = $("#toast");
    t.textContent = msg; t.classList.add("on");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), ms);
  }
  async function copyText(text) {
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* 走老办法 */ }
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }
  const copied = ok => toast(ok ? "复制好了，贴到 ChatGPT 对话里" : "复制不了，换个浏览器试试");

  // 朗读（浏览器自带的英文语音，没有就不显示按钮）
  const canSay = "speechSynthesis" in window && typeof SpeechSynthesisUtterance === "function";
  const sayText = s => s.replace(/[　-〿一-鿿＀-￯]+/g, " ").replace(/\bsb\./g, "somebody").replace(/\bsth\./g, "something")
    .replace(/\.\.\.|…/g, ", ").replace(/\s\/\s/g, ", ").replace(/\+/g, " ").replace(/\s+/g, " ").trim();
  function say(text) {
    if (!canSay) return;
    try {
      const u = new SpeechSynthesisUtterance(sayText(text)), vs = speechSynthesis.getVoices();
      u.lang = "en-US"; u.rate = 0.9;
      const v = vs.find(x => /^en[-_]US/i.test(x.lang)) || vs.find(x => /^en/i.test(x.lang));
      if (v) u.voice = v;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch (e) { /* 读不了就算了 */ }
  }
  const sayBtn = t => (canSay ? `<button class="say" data-act="say" data-t="${esc(t)}" aria-label="读一遍">${ICON.say}</button>` : "");

  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

  /* ───── 首页 ───── */
  function home() {
    setBar(`<a class="pill" href="../" title="回讲义网站">${ICON.back}讲义</a>`, "作文背诵", `<a class="ib" href="#/find" aria-label="搜索">${ICON.find}</a>${menuBtn}`);
    const d = today(), due = dueList(), nw = newList(), items = activeItems(), lv = layerInfo();
    const mastered = items.filter(isMastered).length, used = items.filter(it => stateOf(it) === "used").length;
    const next = items.find(isNew), weak = weakList(), day = ST.days[d] || { n: 0, ok: 0 }, sk = streak();
    const resume = sess && !sessDone() ? `<div class="resume"><span>本层还有未完成的「${esc(sess.title)}」</span><a class="btn small primary" href="#/s">接着背</a></div>` : "";
    const groups = D.parts.map(p => {
      const scenes = D.order.filter(sid => SC[sid].part === p.id && SC[sid].items.some(it => inLayer(it) && it.type !== "t"));
      return scenes.length ? `<section class="part"><div class="part-h"><h2>${esc(p.name)}</h2></div>${scenes.map(sid => {
        const sc = SC[sid], list = sc.items.filter(inLayer), n = list.length, m = list.filter(isMastered).length;
        return `<a class="srow" href="#/scene/${sid}"><span class="nm">${esc(sc.name)}</span><span class="ct">${m} / ${n} 背熟</span><span class="prog"><i class="g" style="width:${m / n * 100}%"></i></span></a>`;
      }).join("")}</section>` : "";
    }).join("");
    render(`<section class="layer-card"><div class="layer-steps" aria-label="学习层级">${(D.levels || LEVELS).map(x => `<button data-act="layer" data-v="${x.id}" aria-pressed="${x.id === layer()}"><b>第${x.id}层</b><span>${esc(x.name)}</span></button>`).join("")}</div>
      <div class="layer-summary"><div><h1>第 ${layer()} 层 · ${esc(lv.name)}</h1><p>${esc(lv.desc)}</p></div>
        ${layer() < 3 ? `<button class="btn" data-act="layer" data-v="${layer() + 1}">进入下一层 →</button>` : `<span class="note">已到第3层，可随时回前层</span>`}</div>
      <p class="note">只安排当前层的学习和复习。准备好了再手动进下一层，随时可以回来。</p></section>
      <div class="home"><div class="side">${resume}
      <section class="hero"><div class="band"><span class="eyebrow">今天 · ${md(d)} · 第${layer()}层</span>
        <span class="what">${due.length || nw.length ? `复习 ${due.length} 条 · 新学 ${nw.length} 条` : "今天的都背完了 ✓"}</span>
        <span class="where">${due.length ? "先巩固到期内容，再学新的" : nw.length ? "新内容先看一遍，再试着默出来" : next ? "本层今天的新学额度已完成" : "本层都学过了，可以巩固或手动进下一层"}</span></div>
        <div class="go">${due.length ? `<button class="btn primary" data-act="review">开始复习 <small>${due.length}</small></button>` : ""}
          ${nw.length ? `<button class="btn${due.length ? "" : " primary"}" data-act="learn">学新的 <small>${nw.length}</small></button>` : ""}
          ${!nw.length && next ? `<button class="btn" data-act="more">再学 5 条</button>` : ""}
          ${!due.length && !next ? `<button class="btn" data-act="practice-layer">巩固本层</button>` : ""}</div></section>
      <p class="stats">今天背了 <b>${day.n}</b> 次${sk ? ` · 连续 <b>${sk}</b> 天` : ""}</p>
      <div class="card ai-card"><h3>写完作文，让 AI 帮你改</h3><div class="line">带上已背熟的模板原文、可用句子和本层最易错的5条。先查任务，再查模板，最后查语法。</div>
        <div class="acts"><button class="btn primary" data-act="copy-ai">复制给AI</button><button class="btn small" data-act="preview-ai">查看内容</button></div><p class="note">复制后贴给 AI，再附上作文题目和你的作文。</p></div>
      ${weak.length ? `<a class="searchbox" href="#/weak">没记牢的 ${weak.length} 条 →</a>` : ""}
      <a class="searchbox" href="#/find">${ICON.find}查本层的中文或英文</a>
      <p class="note">进度自动保存在这个浏览器。右上角「⋯」可复制备份或导入旧进度。</p>
      </div><div class="main"><div class="card"><h3>本层进度 <b>${mastered}</b><small>/ ${items.length} 条背熟（含用对过）</small></h3>
        <div class="prog" role="progressbar" aria-label="本层背熟进度" aria-valuenow="${mastered}" aria-valuemin="0" aria-valuemax="${items.length}"><i class="g" style="width:${mastered / Math.max(1, items.length) * 100}%"></i></div>
        <div class="status-counts"><span>未背 <b>${items.length - mastered}</b></span><span>背熟 <b>${mastered - used}</b></span><span>用对过 <b>${used}</b></span></div>
        <p class="note">「用对过」在作文中正确使用后，点记录的「管理」标记。</p></div>
      ${D.templates.some(t => inLayer(BY[t.id])) ? `<section class="part"><div class="part-h"><h2>本层模板</h2><small>点开就能看、背和标记</small></div>${D.templates.filter(t => inLayer(BY[t.id])).map(t => `<div class="template-row"><a class="lrow" href="#/tpl/${encodeURIComponent(t.id)}"><span class="t">${esc(t.name)}</span><span class="m">打开 →</span></a>${recordControl(BY[t.id])}</div>`).join("")}</section>` : ""}
      ${groups}
      <details class="extras"><summary>例文与写作要点</summary><p class="note">供写作时查阅，不加入复习队列。</p>${D.essays.map(e => `<a class="lrow" href="#/essay/${encodeURIComponent(e.id)}"><span class="t">${esc(e.name)}</span></a>`).join("")}<a class="lrow" href="#/guide"><span class="t">审题、读图与写完检查 →</span></a></details>
      </div></div>`);
  }
  function tplState(t) {
    const r = ST.items[t.id];
    if (!r) return "未背 · 答错 0 次";
    return `${STATUS[stateOf(t)]} · 答错 ${errors(t)} 次 · ${r.d <= today() ? "今天该复习" : `${dayLabel(r.d)}复习`}`;
  }
  const sessDone = () => !sess || !sess.ids.length || (sess.phase !== "learn" && sess.pos >= sess.ids.length);

  /* ───── 背诵 ───── */
  function start(kind, ids, title, back) {
    ids = (ids || []).filter(id => BY[id] && inLayer(BY[id]));
    if (!ids.length) { toast("没有要背的"); return; }
    sess = { kind, title, layer: layer(), ids, pos: 0, lpos: 0, phase: kind === "new" ? "learn" : "quiz", log: [], back: back || "#/" };
    saveSess();
    go("#/s");
  }
  const startReview = () => start("review", dueList().map(it => it.id), "复习");
  const startNew = (scene) => start("new", newList(scene).map(it => it.id), scene ? `学新的 · ${SC[scene].name}` : "学新的", scene ? `#/scene/${scene}` : "#/");

  let stage = "", timer = null, onKey = null, onSwipe = null;
  function sessPage() {
    if (!sess || !sess.ids.length) { go("#/"); return; }
    if (sess.phase === "learn") { learnCard(); return; }
    if (sess.pos >= sess.ids.length) { go("#/done"); return; }
    const it = BY[sess.ids[sess.pos]];
    if (!it || !inLayer(it)) { sess.ids.splice(sess.pos, 1); saveSess(); sessPage(); return; }
    stage = "input";
    const n = sess.ids.length, c = [0, 0, 0];
    sess.log.forEach(e => c[e.r]++);
    setBar(backBtn(sess.back), sess.title, `${sess.log.length ? `<button class="ib" data-act="undo" aria-label="撤销上一张" title="撤销上一张">${ICON.undo}</button>` : ""}<span class="count">${sess.pos + 1} / ${n}</span>`, true);
    setStrip([["g", c[2] / n], ["y", c[1] / n], ["r", c[0] / n]]);
    if (it.type === "t") tplQuiz(it);
    else if (it.type === "w" && ST.prefs.wmode === "type") typedWord(it);
    else if (it.type === "p" && ST.prefs.pmode === "type") typedPattern(it);
    else flipCard(it);
  }
  const tagOf = it => `第${layer()}层 · ${STATUS[stateOf(it)]} · 答错${errors(it)}次 · ${TYPE[it.type]} · ${SC[it.scene].name}${it.type === "p" ? ` · ${it.use}` : ""}`;
  const zhCls = s => (s.length > 15 ? "zh long" : "zh");
  const rateBtns = (labels = ["忘了", "模糊", "记得"]) => `<div class="rate">${labels.map((l, r) => `<button class="r${r}" data-act="rate" data-r="${r}">${l}<small>${r + 1}</small></button>`).join("")}</div>`;
  function wordAnswer(w, withEn = true) {
    return `${withEn ? `<p class="en-big"><span class="en">${esc(w.en)}</span>${sayBtn(w.en)}</p>` : ""}
      <dl class="kv">${w.alt ? `<dt class="lo">记不住就用</dt><dd class="en">${esc(w.alt)}</dd>` : ""}${w.ex ? `<dt class="ex">例</dt><dd class="ex">${esc(w.ex)}</dd>` : ""}</dl>
      ${w.tip ? `<p class="tip">${esc(w.tip)}</p>` : ""}`;
  }
  function patAnswer(p) {
    if (p.targetForm === "base") return `<dl class="kv"><dt>功能句</dt><dd class="up">${dots(p.base)}${sayBtn(p.base)}</dd></dl>${p.tip ? `<p class="tip">${esc(p.tip)}</p>` : ""}`;
    return `<dl class="kv"><dt>升级</dt><dd class="up">${dots(p.up)}${sayBtn(p.up)}</dd><dt class="lo">保底</dt><dd class="base">${dots(p.base)}</dd></dl>
      ${p.tip ? `<p class="tip">${esc(p.tip)}</p>` : ""}`;
  }

  // 新内容先看一遍
  function learnCard() {
    const ids = sess.ids, n = ids.length;
    sess.lpos = Math.max(0, Math.min(sess.lpos, n - 1));
    const it = BY[ids[sess.lpos]], last = sess.lpos === n - 1;
    setBar(backBtn(sess.back), "先看一遍", `<span class="count">${sess.lpos + 1} / ${n}</span>`, true);
    setStrip([["a", (sess.lpos + 1) / n]]);
    let body;
    if (it.type === "w") body = wordAnswer(it);
    else if (it.type === "p") body = patAnswer(it);
    else body = `<p class="when">${esc(it.when)}</p><div class="tpl">${tplHTML(it, "show")}</div>`;
    render(`<article class="fc"><div class="band"><span class="tag">${esc(tagOf(it))}</span>
        ${it.type === "t" ? `<p class="name">${esc(it.name)}</p>` : `<p class="${zhCls(it.zh)}">${esc(it.zh)}</p>`}</div>
      <div class="body">${body}</div></article>
      <div class="next" style="margin-top:16px"><button class="btn" data-act="lprev"${sess.lpos ? "" : " disabled"} aria-label="上一个">←</button>
        ${last ? `<button class="btn primary wide" data-act="lgo">看完了，测一下这 ${n} 条 →</button>` : `<button class="btn primary wide" data-act="lnext">下一个 →</button>`}</div>
      <p class="keys"><kbd>←</kbd> <kbd>→</kbd> 翻 · <kbd>Enter</kbd> 下一个 · 手机上左右滑</p>`, true);
    onSwipe = dir => { if (dir > 0 && !last) lmove(1); else if (dir < 0 && sess.lpos) lmove(-1); };
    onKey = e => {
      if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); if (last) lgo(); else lmove(1); }
      else if (e.key === "ArrowLeft" && sess.lpos) { e.preventDefault(); lmove(-1); }
    };
  }
  function lmove(k) { sess.lpos += k; saveSess(); learnCard(); window.scrollTo(0, 0); }
  function lgo() { sess.phase = "quiz"; sess.pos = 0; saveSess(); sessPage(); window.scrollTo(0, 0); }

  // 翻卡：先想，再看答案，自己评
  function flipCard(it) {
    const hint = it.type === "w" ? "先在心里拼一遍（最好写在纸上），再看答案" : "先说出（或写出）本层英文句子，再看答案";
    render(`<article class="fc"><div class="band"><span class="tag">${esc(tagOf(it))}</span><p class="${zhCls(it.zh)}">${esc(it.zh)}</p></div>
      <div class="body" id="fb"><p class="hint">${hint}</p><button class="btn primary wide" data-act="flip">看答案</button></div></article>
      <p class="keys"><kbd>空格</kbd> 看答案 · <kbd>1</kbd> 忘了 <kbd>2</kbd> 模糊 <kbd>3</kbd> 记得 · <kbd>Ctrl</kbd>+<kbd>Z</kbd> 撤销</p>`, true);
    onKey = e => {
      if ((e.key === " " || e.key === "Enter") && stage === "input") { e.preventDefault(); flip(); }
      else if (stage === "shown" && /^[123]$/.test(e.key)) { e.preventDefault(); rateNext(+e.key - 1); }
    };
  }
  function flip() {
    const it = BY[sess.ids[sess.pos]];
    stage = "shown";
    $("#fb").innerHTML = `${it.type === "w" ? wordAnswer(it) : patAnswer(it)}<p class="hint" style="margin-top:4px">刚才想得出来吗？</p>${rateBtns()}`;
    if (document.activeElement) document.activeElement.blur();
  }

  // 记下一次评分（练一练时只有「忘了」改复习时间）
  function rate(it, r, typed) {
    const d = today(), prev = ST.items[it.id] ? { ...ST.items[it.id] } : null;
    const changed = true;
    const scored = apply(prev, r, d);
    if (sess.kind === "practice" && r !== 0 && prev) {
      ST.items[it.id] = { ...prev, status: scored.status, t: scored.t };
    } else ST.items[it.id] = scored;
    if (it.type === "p" && r === 2) ST.items[it.id].knownForm = typed ? (cmpSentence(it, typed).match || "up") : (it.targetForm || "up");
    const day = ST.days[d] || (ST.days[d] = { n: 0, ok: 0 });
    day.n++; if (r === 2) day.ok++;
    sess.log.push({ id: it.id, r, prev, typed: typed || "", changed, d });
    save(); saveSess();
    return sess.log[sess.log.length - 1];
  }
  function rateNext(r) { const it = BY[sess.ids[sess.pos]]; rate(it, r); nextCard(); }
  function nextCard() { clearTimeout(timer); stage = "moving"; sess.pos++; saveSess(); sessPage(); window.scrollTo(0, 0); }
  function unrate(e) {
    if (e.changed) { if (e.prev) ST.items[e.id] = e.prev; else delete ST.items[e.id]; }
    const day = ST.days[e.d];
    if (day) { day.n = Math.max(0, day.n - 1); if (e.r === 2) day.ok = Math.max(0, day.ok - 1); }
  }
  function undo() {
    const e = sess && sess.log.pop();
    if (!e) return;
    clearTimeout(timer);
    unrate(e);
    sess.pos = Math.max(0, sess.pos - 1);
    if (sess.ids[sess.pos] !== e.id) { const k = sess.ids.indexOf(e.id); if (k >= 0) sess.pos = k; }
    save(); saveSess();
    toast("撤销了上一张");
    if (cur === "#/s") sessPage(); else go("#/s");
  }
  function accept() {          // 「我写的也对」：上一张改成记得
    const e = sess.log[sess.log.length - 1];
    if (!e) return;
    sess.log.pop(); unrate(e);
    const it = BY[e.id];
    rate(it, 2, e.typed);
    toast("算记得了");
    nextCard();
  }

  // 单词：打字默写
  function typedWord(w) {
    const n = mainParts(w).length;
    render(`<article class="fc"><div class="band"><span class="tag">${esc(tagOf(w))}</span><p class="${zhCls(w.zh)}">${esc(w.zh)}</p></div>
      <div class="body">${n > 1 ? `<p class="hint">要写 ${n} 个，每格一个，顺序不限</p>` : w.alt ? `<p class="hint">写不出就写简单的替换词，也算保底</p>` : ""}
        <div class="inputs">${Array.from({ length: n }, (_, k) => `<input type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" aria-label="第 ${k + 1} 个">`).join("")}</div>
        <div class="acts" id="wa"><button class="btn primary" data-act="wsubmit">提交</button><button class="link" data-act="wgiveup">不会，看答案</button></div>
        <div id="wv"></div></div></article>
      <p class="keys"><kbd>Enter</kbd> 提交 / 下一个 · <kbd>Esc</kbd> 不会</p>`, true);
    const first = $(".inputs input");
    if (first) first.focus({ preventScroll: true });
    onKey = e => {
      if (e.key === "Enter") { e.preventDefault(); if (stage === "input") wsubmit(false); else if (stage === "shown") nextCard(); }
      else if (e.key === "Escape" && stage === "input") { e.preventDefault(); wsubmit(true); }
    };
  }
  function wsubmit(giveUp) {
    if (stage !== "input") return;
    const w = BY[sess.ids[sess.pos]], ins = $$(".inputs input"), vals = ins.map(x => x.value);
    if (!giveUp && vals.every(v => !v.trim())) { ins[0].focus(); toast("先写一下，不会就点「不会」"); return; }
    const g = giveUp ? { r: 0, cells: vals.map(() => ({ ok: false })) } : gradeWord(w, vals);
    const typed = vals.filter(v => v.trim()).join(" / ");
    const e = rate(w, g.r, giveUp ? "" : typed);
    ins.forEach((x, k) => { x.readOnly = true; const c = g.cells[k] || {}; x.classList.add(c.ok ? "ok" : c.mid ? "mid" : "bad"); });
    const c = [0, 0, 0], n = sess.ids.length;
    sess.log.forEach(x => c[x.r]++);
    setStrip([["g", c[2] / n], ["y", c[1] / n], ["r", c[0] / n]]);
    if (document.activeElement) document.activeElement.blur();
    if (g.r === 2) {
      stage = "flash";
      $("#wa").innerHTML = `<span class="res ok">✓ 对</span>${w.alt ? `<span class="mine">记不住时也可以用 <b>${esc(w.alt)}</b></span>` : ""}`;
      timer = setTimeout(() => { if (stage === "flash" && sess.log[sess.log.length - 1] === e) nextCard(); }, w.alt ? 1100 : 650);
      return;
    }
    stage = "shown";
    $("#wa").hidden = true;
    let d = "";
    if (g.r === 0 && !giveUp) g.cells.forEach((cell, k) => {
      if (!cell.ok && cell.near && vals[k].trim() && cell.dist <= Math.max(2, Math.ceil(cell.near.length * 0.4))) d += `<p class="diff">${diff(norm(vals[k]), cell.near)}</p>`;
    });
    const head = g.r === 1 ? `<p class="res mid">✓ 保底词写对了<small>考场上这样写不扣分，再记一下升级写法</small></p>`
      : `<p class="res bad">${giveUp ? "不会" : g.caseOnly ? "大小写不对" : "✗ 错了"}${g.caseOnly ? "<small>注意首字母大写</small>" : giveUp ? "<small>明天再背</small>" : ""}</p>`;
    $("#wv").innerHTML = `<div class="verdict">${head}${d}${wordAnswer(w)}
      <div class="next"><button class="btn primary wide" data-act="next">${sess.pos + 1 < sess.ids.length ? "下一个" : "看结果"} →</button>
        ${g.r === 0 && !giveUp ? `<button class="link" data-act="accept">我写的也对，算记得</button>` : ""}</div></div>`;
  }

  // 句型：打字默写
  function typedPattern(p) {
    render(`<article class="fc"><div class="band"><span class="tag">${esc(tagOf(p))}</span><p class="${zhCls(p.zh)}">${esc(p.zh)}</p></div>
      <div class="body"><p class="hint">${p.targetForm === "base" ? "写出本层功能句，先把基础句用对；… 的地方可以不写" : "写出升级句。写不出就写保底句；… 的地方可以不写"}</p>
        <textarea class="typed" id="pt" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" aria-label="写英文句子"></textarea>
        <div class="acts" id="pa"><button class="btn primary" data-act="psubmit">对答案</button><button class="link" data-act="pgiveup">不会，看答案</button></div>
        <div id="pv"></div></div></article>
      <p class="keys"><kbd>Enter</kbd> 对答案 · <kbd>Esc</kbd> 不会 · 之后 <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> 自己评</p>`, true);
    const ta = $("#pt");
    ta.focus({ preventScroll: true });
    onKey = e => {
      if (e.key === "Enter" && stage === "input") { e.preventDefault(); psubmit(false); }
      else if (e.key === "Escape" && stage === "input") { e.preventDefault(); psubmit(true); }
      else if (e.key === "Enter" && stage === "next") { e.preventDefault(); nextCard(); }
      else if (stage === "shown" && /^[123]$/.test(e.key) && e.target.tagName !== "TEXTAREA") { e.preventDefault(); rateNext(+e.key - 1); }
    };
  }
  function psubmit(giveUp) {
    if (stage !== "input") return;
    const p = BY[sess.ids[sess.pos]], ta = $("#pt"), typed = ta.value.trim();
    if (!giveUp && !typed) { ta.focus(); toast("先写一下，不会就点「不会」"); return; }
    ta.readOnly = true;
    if (document.activeElement) document.activeElement.blur();
    $("#pa").hidden = true;
    const nextBtn = `<div class="next"><button class="btn primary wide" data-act="next">${sess.pos + 1 < sess.ids.length ? "下一个" : "看结果"} →</button></div>`;
    if (giveUp) {
      rate(p, 0, "");
      stage = "next";
      $("#pv").innerHTML = `<div class="verdict"><p class="res bad">不会<small>明天再背</small></p>${patAnswer(p)}${nextBtn}</div>`;
      return;
    }
    const c = cmpSentence(p, typed);
    if (c.match === "up" || (c.match === "base" && p.targetForm === "base")) {
      const e = rate(p, 2, typed);
      stage = "flash";
      $("#pv").innerHTML = `<div class="verdict"><p class="res ok">✓ 完全正确</p><p class="cmp">${dots(p[c.match])}</p></div>`;
      timer = setTimeout(() => { if (stage === "flash" && sess.log[sess.log.length - 1] === e) nextCard(); }, 1200);
      return;
    }
    if (c.match === "base") {
      rate(p, 1, typed);
      stage = "next";
      $("#pv").innerHTML = `<div class="verdict"><p class="res mid">✓ 保底句写对了<small>考场上这样写不扣分，再看一眼升级写法</small></p>${patAnswer(p)}${nextBtn}</div>`;
      return;
    }
    ta.classList.add("bad");
    stage = "shown";
    $("#pv").innerHTML = `<div class="verdict"><p class="res bad">和答案有出入<small>对照${c.best.key === "up" ? "升级句" : "保底句"}，红色是没写出来或写得不一样的词</small></p>
      <p class="cmp">${c.best.html}</p>
      ${patAnswer(p)}<p class="hint">意思对、只是写法不同也可以算记得。自己评：</p>${rateBtns()}</div>`;
  }

  // 模板：盖住固定句，一处一处回想
  function tplQuiz(t) {
    render(`<article class="fc"><div class="band"><span class="tag">${esc(tagOf(t))}</span><p class="name">${esc(t.name)}</p></div>
      <div class="body"><p class="hint">灰块是要背的固定句，先说出来再点开；黄框是考场上自己填的内容</p>
        <div class="tpl" id="tq">${tplHTML(t, "mask")}</div>
        <div class="tplbar"><span class="cnt" id="tcnt"></span><span class="sp"></span><button class="btn small" data-act="tall">全部揭开</button></div>
        <p class="hint">这次能默出来吗？</p>${rateBtns(["不会", "还差点", "能默出来"])}</div></article>
      <p class="keys"><kbd>空格</kbd> 全部揭开 · <kbd>1</kbd> 不会 <kbd>2</kbd> 还差点 <kbd>3</kbd> 能默出来</p>`, true);
    stage = "shown";
    tcount();
    onKey = e => {
      if (e.key === " ") { e.preventDefault(); tall(); }
      else if (/^[123]$/.test(e.key)) { e.preventDefault(); rateNext(+e.key - 1); }
    };
  }
  function tcount() {
    const el = $("#tcnt");
    if (!el) return;
    const all = $$(".mask"), on = all.filter(m => m.classList.contains("on")).length;
    el.textContent = `揭开了 ${on} / ${all.length} 处`;
  }
  function tall() {
    const all = $$(".mask"), shut = all.some(m => !m.classList.contains("on"));
    all.forEach(m => m.classList.toggle("on", shut));
    const b = $('[data-act="tall"]');
    if (b) b.textContent = shut ? "重新盖住" : "全部揭开";
    tcount();
  }

  /* ───── 背完 ───── */
  function donePage() {
    if (!sess || !sess.log.length) { go("#/"); return; }
    setBar(backBtn(sess.back), sess.title, `<button class="ib" data-act="undo" aria-label="撤销最后一张" title="撤销最后一张">${ICON.undo}</button>`, true);
    const c = [0, 0, 0];
    sess.log.forEach(e => c[e.r]++);
    const miss = sess.log.filter(e => e.r < 2), missIds = [...new Set(miss.map(e => e.id))];
    const nw = sess.kind !== "new" ? newList() : [];
    const line = it => (it.type === "w" ? it.en + (it.alt ? `（记不住就用 ${it.alt}）` : "") : it.type === "p" ? (it.targetForm === "base" ? it.base : it.up) : "（模板）");
    render(`<div class="done"><h2>${esc(sess.title)} · 背完了</h2>
      <div class="score">${c[2]}<small> / ${sess.log.length} 记得</small></div>
      <div class="kpis"><span class="ok">记得<b>${c[2]}</b></span><span class="mid">模糊<b>${c[1]}</b></span><span class="bad">忘了<b>${c[0]}</b></span></div>
      ${sess.kind === "practice" ? `<p class="note">这是练一练：忘了的明天会再出现，记得的不改复习时间。</p>`
        : `<p class="note">${sess.kind === "new" ? "学过的内容明天开始按间隔复习。" : ""}忘了和模糊的明天再背；记得的隔几天再来，越熟隔得越久。</p>`}
      ${miss.length ? `<div class="blist">${missIds.map(id => {
        const it = BY[id], e = miss.filter(x => x.id === id).pop();
        return it ? `<div class="brow"><span class="zh">${esc(it.type === "t" ? it.name : it.zh)}</span><span class="en">${dots(line(it))}</span>
          <span class="m"><span class="r${e.r}">${e.r ? "模糊" : "忘了"}</span>${e.typed ? ` · 你写的 <s>${esc(e.typed)}</s>` : ""}</span></div>` : "";
      }).join("")}</div>` : ""}
      <div class="acts">${missIds.length ? `<button class="btn primary" data-act="again">再练没记住的 ${missIds.length} 条</button>` : ""}
        ${nw.length ? `<button class="btn${missIds.length ? "" : " primary"}" data-act="learn">学新的 ${nw.length} 条</button>` : ""}
        <a class="btn${missIds.length || nw.length ? "" : " primary"}" href="${esc(sess.back)}">${sess.back === "#/" ? "回首页" : "回板块"}</a>
        ${missIds.length ? `<button class="btn" data-act="copy-miss">复制给 GPT</button>` : ""}</div></div>`, true);
  }

  /* ───── 板块 ───── */
  let cover = false;
  function scenePage(sid) {
    const s = SC[sid];
    if (!s) { go("#/"); return; }
    setBar(backBtn("#/"), `${PARTS[s.part].name} · ${s.name}`, menuBtn, true);
    const list = s.items.filter(inLayer);
    const ws = list.filter(it => it.type === "w"), ps = list.filter(it => it.type === "p"), ts = list.filter(it => it.type === "t");
    const nw = list.filter(isNew), learned = list.filter(it => !isNew(it));
    const dot = it => { const r = rec(it); return !r ? "" : isWeak(it) ? "w" : isMastered(it) ? "m" : "l"; };
    const hide = cover ? " hide" : "";
    render(`<section class="shead"><div class="band"><span class="eyebrow">${esc(PARTS[s.part].name)} · 第${layer()}层 · ${list.length} 条 · 学过 ${learned.length}</span><p>${esc(s.note)}</p></div>
      <div class="go">${nw.length ? `<button class="btn primary" data-act="scene-learn" data-s="${sid}">学这里的新内容 <small>${nw.length}</small></button>` : ""}
        ${learned.length ? `<button class="btn${nw.length ? "" : " primary"}" data-act="scene-practice" data-s="${sid}">练一练 <small>${learned.length}</small></button>` : ""}
        <span class="sp"></span><button class="btn small" data-act="cover">${cover ? "显示英文" : "盖住英文"}</button></div></section>
      ${!list.length ? `<p class="placeholder">这一板块在当前层没有内容。回首页切换层级后再查看。</p>` : ""}<div class="${cover ? "cover" : ""}" id="sl">
      ${ws.length ? `<h2 class="sec">单词 <small>${ws.length}</small></h2><div class="wl">${ws.map(w => `<div class="wr"><i class="dot ${dot(w)}"></i><span class="zh">${esc(w.zh)}</span>
        <span class="row2"><span class="en${hide}" data-act="peek">${esc(w.en)}</span>${w.alt ? `<span class="alt${hide}" data-act="peek"><b>记不住</b>${esc(w.alt)}</span>` : ""}</span>
        <span class="more">${esc(w.ex)}${w.tip ? ` · <span class="w">${esc(w.tip)}</span>` : ""}</span>${recordControl(w)}</div>`).join("")}</div>` : ""}
      ${ps.length ? `<h2 class="sec">句型 <small>${ps.length}</small></h2><div class="pl">${ps.map(p => `<div class="pr"><i class="dot ${dot(p)}"></i><span class="use">${esc(p.use)}</span>
        <span class="zh">${esc(p.zh)}</span><span class="up${hide}" data-act="peek"><span class="lab">${p.targetForm === "base" ? "功能句" : "升级"}</span>${dots(p.targetForm === "base" ? p.base : p.up)}</span>
        ${p.targetForm === "base" ? "" : `<span class="base${hide}" data-act="peek"><span class="lab">保底</span>${dots(p.base)}</span>`}${p.tip ? `<span class="w">${esc(p.tip)}</span>` : ""}${recordControl(p)}</div>`).join("")}</div>` : ""}
      ${ts.length ? `<h2 class="sec">模板</h2>${ts.map(t => `<a class="lrow" href="#/tpl/${encodeURIComponent(t.id)}"><span class="t">${esc(t.name)}</span><span class="m">${tplState(t)}</span></a>`).join("")}` : ""}
      </div>
      <p class="note">每条记录可点「管理」修改状态。圆点：<span style="color:var(--acc)">●</span> 学过 · <span style="color:var(--ok)">●</span> 背熟 · <span style="color:var(--bad)">●</span> 背过又忘了。「练一练」只在忘了时改复习时间。</p>`, true);
  }

  /* ───── 模板 ───── */
  function splitFix(s) {      // 固定句按句子切开，有字母的才盖住（不用后行断言，老 iPhone 也能用）
    const out = [], re = /[.!?]\s+/g;
    let last = 0, m;
    while ((m = re.exec(s))) { out.push(s.slice(last, m.index + 1), m[0].slice(1)); last = m.index + m[0].length; }
    out.push(s.slice(last));
    return out;
  }
  function tplHTML(t, mode) {
    return t.paras.map(p => {
      const txt = typeof p === "string" ? p : p.t, a = typeof p === "string" ? "" : p.a;
      let html = "", last = 0, m;
      const re = /\{([^}]*)\}/g, fix = s => {
        if (mode !== "mask") return esc(s);
        return splitFix(s).map(ch => {
          const mm = ch.match(/^(\s*)([\s\S]*?)(\s*)$/);
          return /[A-Za-z]{2,}/.test(mm[2]) ? `${mm[1]}<span class="mask" role="button" tabindex="0" data-act="tpeek">${esc(mm[2])}</span>${mm[3]}` : esc(ch);
        }).join("");
      };
      while ((m = re.exec(txt))) { html += fix(txt.slice(last, m.index)) + `<span class="slot">${esc(m[1])}</span>`; last = re.lastIndex; }
      html += fix(txt.slice(last));
      return `<p${a ? ` class="${a}"` : ""}>${html}</p>`;
    }).join("");
  }
  const tplPlain = t => t.paras.map(p => (typeof p === "string" ? p : p.t).replace(/\{([^}]*)\}/g, "____（$1）")).join("\n");
  let tmode = "看";
  function tplPage(id) {
    const t = BY[id];
    if (!t || t.type !== "t" || !inLayer(t)) { go("#/"); return; }
    setBar(backBtn("#/"), t.name, "", true);
    const r = ST.items[t.id];
    render(`<div class="tplbar" style="margin-bottom:12px"><div class="seg">${["看", "背"].map(x => `<button data-act="tmode" data-v="${x}" aria-pressed="${tmode === x}">${x}</button>`).join("")}</div>
        <span class="sp"></span><button class="btn small" data-act="copy-tpl" data-id="${esc(t.id)}">复制模板</button></div>
      <article class="fc"><div class="band"><span class="tag">模板 · ${esc(PARTS[t.part].name)}</span><p class="name">${esc(t.name)}</p></div>
      <div class="body">${recordControl(t)}<p class="when">${esc(t.when)}</p>
        ${tmode === "背" ? `<p class="hint">灰块是要背的固定句：先说出来，再点开对照；黄框是考场上按题目填的内容</p>` : `<p class="hint">黄框是考场上按题目填的内容，其余是要背下来的固定句</p>`}
        <div class="tpl">${tplHTML(t, tmode === "背" ? "mask" : "show")}</div>
        ${tmode === "背" ? `<div class="tplbar"><span class="cnt" id="tcnt"></span><span class="sp"></span><button class="btn small" data-act="tall">全部揭开</button></div>
          <p class="hint">这次能默出来吗？${r ? `（${tplState(t)}）` : "评一下就加进每天的复习"}</p>${rateBtns(["不会", "还差点", "能默出来"]).replace(/data-act="rate"/g, 'data-act="trate"')}` : ""}
      </div></article>`, true);
    tcount();
    onKey = tmode === "背" ? e => { if (e.key === " ") { e.preventDefault(); tall(); } } : null;
  }
  function trate(id, r) {
    const t = BY[id]; if (!t || !inLayer(t)) return;
    const d = today(), prev = ST.items[id] ? { ...ST.items[id] } : null;
    ST.items[id] = apply(prev, r, d);
    const day = ST.days[d] || (ST.days[d] = { n: 0, ok: 0 });
    day.n++; if (r === 2) day.ok++;
    save();
    toast(`记下了 · ${dayLabel(ST.items[id].d)}再背「${t.name}」`);
    tplPage(id);
  }

  /* ───── 例文 ───── */
  let labels = true;
  function essayPage(id) {
    const e = D.essays.find(x => x.id === id);
    if (!e) { go("#/"); return; }
    setBar(backBtn("#/"), e.name, "", true);
    render(`<div class="tplbar" style="margin-bottom:12px"><button class="btn small" data-act="labels">${labels ? "隐藏标注" : "显示标注"}</button>
        <span class="sp"></span><button class="btn small" data-act="copy-essay" data-id="${esc(e.id)}">复制例文</button></div>
      <p class="prompt"><b>题目</b>　${esc(e.prompt)}</p>
      <div class="es${labels ? "" : " nolab"}" style="margin-top:16px">${e.paras.map(p => `<p>${p.map(([s, l]) => `<span class="s">${esc(s)}</span>${l ? `<span class="lb">${esc(l)}</span>` : ""}`).join(" ")}</p>`).join("")}</div>
      <p class="note" style="margin-top:18px">例文是按真题风格自己编的，用来看句型怎么拼成整篇。别整篇背——背模板和句型，内容按题目自己写。</p>`, true);
  }

  /* ───── 查 ───── */
  let q = "";
  function findPage() {
    setBar(backBtn("#/"), "查", "", true);
    render(`<input class="findbox" id="fq" type="search" placeholder="输入中文或英文，比如：参加、建议、increase" value="${esc(q)}" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
      <div id="fr"></div>`, true);
    const inp = $("#fq");
    inp.addEventListener("input", () => { q = inp.value; findResults(); });
    inp.focus({ preventScroll: true });
    findResults();
  }
  function findResults() {
    const box = $("#fr"), s = q.trim().toLowerCase();
    if (!s) { box.innerHTML = `<p class="placeholder">只搜索当前第${layer()}层。写作文时想不起某个词或句子，在这里查。<br>每个词都附了「记不住就用」的简单说法。</p>`; return; }
    const mark = t => { const i = t.toLowerCase().indexOf(s); return i < 0 ? dots(t) : dots(t.slice(0, i)) + `<mark>${dots(t.slice(i, i + s.length))}</mark>` + dots(t.slice(i + s.length)); };
    const hits = activeItems().filter(it => [it.zh, it.en, it.alt, it.targetForm === "base" ? null : it.up, it.base, it.use, it.name, it.when].some(x => x && x.toLowerCase().includes(s)));
    box.innerHTML = hits.length ? `<p class="note">${hits.length} 条</p>` + hits.slice(0, 80).map(it => it.type === "t" ? `<div class="hit"><a href="#/tpl/${encodeURIComponent(it.id)}">${mark(it.name)}</a><span class="m">${mark(it.when)}</span>${recordControl(it)}</div>` : it.type === "w"
      ? `<div class="hit"><span class="zh">${mark(it.zh)}</span><span class="en">${mark(it.en)}</span>${it.alt ? `<span class="alt"><b>记不住就用</b>${mark(it.alt)}</span>` : ""}
        <span class="m">${esc(it.ex)} · <a href="#/scene/${it.scene}">${esc(SC[it.scene].name)}</a></span>${recordControl(it)}</div>`
      : `<div class="hit"><span class="zh">${mark(it.zh)}</span><span class="en">${mark(it.targetForm === "base" ? it.base : it.up)}</span>${it.targetForm === "base" ? "" : `<span class="alt"><b>保底</b>${mark(it.base)}</span>`}
        <span class="m">句型 · ${esc(it.use)} · <a href="#/scene/${it.scene}">${esc(SC[it.scene].name)}</a></span>${recordControl(it)}</div>`).join("")
      : `<p class="placeholder">没找到「${esc(q.trim())}」。换个说法试试，比如只输两个字。</p>`;
  }

  /* ───── 没记牢的 ───── */
  function weakPage() {
    setBar(backBtn("#/"), "没记牢的", "", true);
    const ws = weakList();
    render(`<div class="card"><h3>没记牢的 <b>${ws.length}</b></h3><div class="line">背过之后又忘了的。连续记得两次就会从这里消失。</div>
      <div class="acts"><button class="btn primary small" data-act="practice-weak"${ws.length ? "" : " disabled"}>练一遍</button>
        <button class="btn small" data-act="copy-weak"${ws.length ? "" : " disabled"}>复制给 GPT 出题</button></div></div>
      ${ws.length ? `<div class="blist" style="margin-top:10px">${ws.map(it => { const r = rec(it); return `<div class="brow"><span class="zh">${esc(it.type === "t" ? it.name : it.zh)}</span>
        <span class="en">${dots(it.type === "w" ? it.en : it.type === "p" ? (it.targetForm === "base" ? it.base : it.up) : "")}</span>
        <span class="m">答错 ${errors(it)} 次 · ${esc(SC[it.scene].name)} · ${r.d <= today() ? "今天该复习" : `${dayLabel(r.d)}复习`}</span>${recordControl(it)}</div>`; }).join("")}</div>`
      : `<p class="placeholder">现在没有。背过又忘了的会出现在这里。</p>`}`, true);
  }

  /* ───── 要点 ───── */
  function guidePage(id) {
    setBar(backBtn("#/"), "要点", "", true);
    render(`<div class="guide">${D.guide.map(g => `<div class="card" id="${esc(g.id)}"><h3>${esc(g.title)}</h3><ul>${g.lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul></div>`).join("")}</div>`, true);
    const el = id && document.getElementById(id);
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: "start" }));
  }

  /* ───── 给 GPT 的文字 ───── */
  function gptProgress() {
    const known = ITEMS.filter(isMastered), templates = known.filter(it => it.type === "t");
    const weak = activeItems().filter(it => errors(it) > 0).sort((a, b) => errors(b) - errors(a) || (rec(b)?.t || 0) - (rec(a)?.t || 0) || a.i - b.i).slice(0, 5);
    const L = ["请帮我批改考研英语二作文。以下是我的实际背诵进度，请严格遵守。", "", `【当前层】第${layer()}层：${layerInfo().name}（${layerInfo().desc}）。只安排当前层的复习。`, "", "【批改规则：严格按顺序】",
      "1. 先查漏任务：请先读取题目和我的作文；缺少任一项就先向我要。逐项核对题目任务及每个子任务、对象、格式、图表数据与单位。漏了什么先用中文列出来。",
      "2. 再查模板用法：检查书信/通知格式、语气、静态/动态图选择、段落作用、填空是否切题。只用下方已背熟的模板和句子修改，不能引入未背过的句式、升级词句或整篇新范文。模板里的示例不等于题目事实，填空只用题目内容和简单词；允许必要的人称、时态、主谓一致调整。",
      "3. 最后查语法：逐句检查谓语、时态、主谓一致、单复数、冠词、介词和拼写，做最小必要修改。按「原句 → 修改 → 中文原因 → 使用的已背素材ID」说明。",
      "4. 只用我背过的句子改。下方最易错条目仅用于提醒，不代表我已背熟；不要把它们当成可用素材。没有可用的已背句子时，用中文指出缺口，不替我写陌生英文。没有已背熟模板时也不要自行补模板。",
      "5. 最后列出本次确实用对的素材ID，方便我回网站手动标「用对过」；不要把只出现过或被你改好的句子算作我已用对。", "", "【已背熟的模板原文（含用对过；花括号为待填内容）】"];
    if (!templates.length) L.push("暂无。请不要假定我背过任何完整模板。");
    templates.forEach(t => L.push(`\n■ ${t.name} [${t.id}] · ${STATUS[stateOf(t)]}`, ...t.paras.map(p => typeof p === "string" ? p : p.t)));
    L.push("", "【已背熟的句子/词汇：唯一可用素材清单（也含此前层级）】");
    const other = known.filter(it => it.type !== "t");
    if (!other.length) L.push("暂无独立句型或词汇。仅可使用上面的已背熟模板固定句。");
    other.forEach(it => {
      if (it.type === "w") L.push(`- [${it.id}] ${it.zh}：${it.en}`);
      else {
        const form = rec(it)?.knownForm || "up";
        L.push(`- [${it.id}] ${it.zh}：${form === "base" ? it.base : form === "both" ? `${it.up} / ${it.base}` : it.up}`);
      }
    });
    L.push("", `【当前层最易错的${weak.length}条（最多5条，按累计答错次数排序）】`);
    if (!weak.length) L.push("暂无答错记录。不虚构错题。");
    weak.forEach((it, i) => L.push(`${i + 1}. [${it.id}] ${it.name || it.zh} · 答错${errors(it)}次 · ${STATUS[stateOf(it)]}${!isMastered(it) ? "（未背熟，不可作为改写素材）" : ""}`));
    L.push("", "【作文题目】", "（在这里粘贴题目；图表题请附图或完整数据）", "", "【我的作文】", "（在这里粘贴作文）");
    return L.join("\n");
  }
  function previewAI() {
    openSheet(`<h3>复制给AI的内容</h3><p class="sub">这份资料随你的背诵进度更新。复制后附上题目和作文即可。</p><textarea id="ai-text" readonly aria-label="AI批改资料">${esc(gptProgress())}</textarea><div class="acts" style="margin-top:12px"><button class="btn primary" data-act="copy-ai">复制给AI</button><button class="btn" data-act="close">关闭</button></div>`);
  }
  function gptList(ids, what) {
    const L = [`下面是我背考研英语作文素材时${what}的 ${ids.length} 条。请用它们给我出中译英小练习：一次只出一句，等我答完再批改；批改时指出错在哪，并告诉我记不住时可以用哪个简单说法。`, ""];
    ids.forEach(id => {
      const it = BY[id];
      if (!it) return;
      if (it.type === "w") L.push(`- 单词：${it.zh} → ${it.en}${it.alt ? `（记不住就用 ${it.alt}）` : ""}`);
      else if (it.type === "p") L.push(`- 句型：${it.zh} → ${it.targetForm === "base" ? it.base : it.up}`);
      else L.push(`- 模板：${it.name}`, tplPlain(it));
    });
    return L.join("\n");
  }

  /* ───── 设置 ───── */
  function menu() {
    const p = ST.prefs, th = (() => { try { return localStorage.getItem("xuexi-theme") || ""; } catch (e) { return ""; } })();
    const seg = (act, cur, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-act="${act}" data-v="${v}" aria-pressed="${String(cur) === String(v)}">${l}</button>`).join("")}</div>`;
    openSheet(`<h3>设置</h3>
      <div class="setrow"><span>每天学新的</span>${seg("pref-daily", p.daily, [[10, "10"], [15, "15"], [20, "20"], [30, "30"]])}</div>
      <div class="setrow"><span>单词怎么背</span>${seg("pref-w", p.wmode, [["type", "打字默写"], ["flip", "看了翻卡"]])}</div>
      <div class="setrow"><span>句型怎么背</span>${seg("pref-p", p.pmode, [["flip", "看了翻卡"], ["type", "打字默写"]])}</div>
      <div class="setrow"><span>外观</span>${seg("theme", th, [["", "跟随系统"], ["light", "日间"], ["dark", "夜间"]])}</div>
      <h3>进度</h3>
      <p class="sub">进度只存在这台设备的浏览器里。换手机或换浏览器前，先「复制进度」发给自己，到新设备上「粘贴进度」。</p>
      <div class="acts"><button class="btn small" data-act="export">复制进度</button><button class="btn small" data-act="import">粘贴进度</button><button class="link danger" data-act="reset">清空进度</button></div>
      <h3>怎么背</h3>
      <p class="sub">新内容先看一遍再测。测完自己评：记得 → 1、3、7、14、30、60 天后再背；模糊 → 明天再背；忘了 → 明天从头来。单词写出「记不住就用」的替换词算模糊——考场上能用，但还要记升级写法。点「记得／能默出来」会标成背熟；忘了会回到未背并累计答错次数。作文里正确用过后，在「管理」里手动标「用对过」。只复习当前层，点击层级可切换，进度保留。</p>
      <div class="acts"><button class="btn wide" data-act="close">好了</button></div>`);
  }
  function importSheet() {
    openSheet(`<h3>粘贴进度</h3><p class="sub">把在别的设备上「复制进度」得到的那段文字贴进来。两边都背过的，以最近背的那次为准。</p>
      <textarea id="imp" placeholder="粘贴到这里"></textarea>
      <div class="acts" style="margin-top:10px"><button class="btn primary" data-act="import-ok">合并进来</button><button class="link" data-act="close">取消</button></div>`);
    $("#imp").focus();
  }
  function importOk() {
    let o;
    try { o = JSON.parse($("#imp").value.trim()); } catch (e) { toast("这段文字不对，要整段复制过来"); return; }
    if (!o || o.app !== "zuowen" || !o.items || typeof o.items !== "object" || Array.isArray(o.items)) { toast("这不是作文背诵的进度"); return; }
    let n = 0;
    for (const [id, r] of Object.entries(o.items)) {
      if (!r || typeof r !== "object" || !r.d) continue;
      const mine = ST.items[id];
      if (!mine || (r.t || 0) > (mine.t || 0)) { ST.items[id] = r; n++; }
    }
    for (const [d, v] of Object.entries(o.days || {})) {
      const mine = ST.days[d];
      if (!mine || (v.n || 0) > mine.n) ST.days[d] = { n: v.n || 0, ok: v.ok || 0 };
    }
    if (o.prefs && [1, 2, 3].includes(o.prefs.layer) && o.prefs.layer !== layer()) {
      saveSess(); ST.prefs.layer = o.prefs.layer; sess = layerSessions[layer()] || null; saveSess();
    }
    save(); closeSheet();
    toast(`合并好了，更新了 ${n} 条`);
    route();
  }
  let resetArm = 0;

  /* ───── 点击 ───── */
  const ACT = {
    menu,
    layer: el => switchLayer(+el.dataset.v),
    record: el => recordSheet(el.dataset.id),
    "set-status": el => { const v = el.dataset.v; if (STATUS[v]) { const it = BY[el.dataset.id]; editRecord(el.dataset.id, { status: v, ...(it?.type === "p" && v !== "unlearned" ? { knownForm: it.targetForm || "up" } : {}) }); } },
    "add-error": el => { const it = BY[el.dataset.id]; if (it) editRecord(it.id, { x: errors(it) + 1, status: "unlearned", b: 0, d: addDays(today(), 1) }); },
    "practice-layer": () => start("practice", activeItems().filter(it => !isNew(it)).map(it => it.id), "巩固本层"),
    "copy-ai": async () => { if (await copyText(gptProgress())) toast("已复制，贴给 AI 后附上题目和作文"); else previewAI(); },
    "preview-ai": previewAI,
    close: closeSheet,
    review: startReview,
    learn: () => startNew(),
    more: () => { const d = today(); ST.extra[d] = (ST.extra[d] || 0) + 5; save(); home(); },
    drop: () => { sess = null; saveSess(); home(); },
    "scene-learn": el => startNew(el.dataset.s),
    "scene-practice": el => start("practice", SC[el.dataset.s].items.filter(inLayer).filter(it => !isNew(it)).map(it => it.id), `练一练 · ${SC[el.dataset.s].name}`, `#/scene/${el.dataset.s}`),
    "practice-weak": () => start("practice", weakList().map(it => it.id), "练没记牢的", "#/weak"),
    again: () => { const ids = [...new Set(sess.log.filter(e => e.r < 2).map(e => e.id))]; start("practice", ids, "再练没记住的", sess.back); },
    lnext: () => lmove(1), lprev: () => lmove(-1), lgo,
    flip, rate: el => rateNext(+el.dataset.r), next: nextCard, undo, accept,
    wsubmit: () => wsubmit(false), wgiveup: () => wsubmit(true),
    psubmit: () => psubmit(false), pgiveup: () => psubmit(true),
    tpeek: el => { el.classList.toggle("on"); tcount(); }, tall,
    tmode: el => { tmode = el.dataset.v; tplPage(cur.split("/").slice(2).map(decodeURIComponent).join("/")); },
    trate: el => trate(cur.split("/").slice(2).map(decodeURIComponent).join("/"), +el.dataset.r),
    cover: () => { cover = !cover; route(); },
    peek: el => { if ($("#sl.cover")) el.classList.toggle("hide"); },
    labels: () => { labels = !labels; route(); },
    say: el => say(el.dataset.t),
    "copy-weak": async () => copied(await copyText(gptList(weakList().map(it => it.id), "背过又忘了"))),
    "copy-miss": async () => copied(await copyText(gptList([...new Set(sess.log.filter(e => e.r < 2).map(e => e.id))], "这一轮没记住"))),
    "copy-tpl": async el => toast(await copyText(tplPlain(BY[el.dataset.id])) ? "模板复制好了" : "复制不了"),
    "copy-essay": async el => { const e = D.essays.find(x => x.id === el.dataset.id); toast(await copyText(`${e.prompt}\n\n${e.paras.map(p => p.map(x => x[0]).join(" ")).join("\n")}`) ? "例文复制好了" : "复制不了"); },
    "pref-daily": el => { ST.prefs.daily = +el.dataset.v; save(); menu(); route(); },
    "pref-w": el => { ST.prefs.wmode = el.dataset.v; save(); menu(); if (cur === "#/s") sessPage(); },
    "pref-p": el => { ST.prefs.pmode = el.dataset.v; save(); menu(); if (cur === "#/s") sessPage(); },
    theme: el => {
      const t = el.dataset.v;
      if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
      try { if (t) localStorage.setItem("xuexi-theme", t); else localStorage.removeItem("xuexi-theme"); } catch (e) { /* */ }
      menu();
    },
    export: async () => toast(await copyText(JSON.stringify({ ...ST, app: "zuowen", version: 2, at: new Date().toISOString() })) ? "进度复制好了，发给自己，到新设备上粘贴" : "复制不了"),
    import: importSheet,
    "import-ok": importOk,
    reset: el => {
      if (Date.now() - resetArm > 3000) { resetArm = Date.now(); el.textContent = "再点一次确认清空"; return; }
      ST = fresh({ prefs: ST.prefs }); save(); sess = null; layerSessions = {}; saveSess(); closeSheet(); toast("进度清空了"); go("#/");
    },
  };
  document.addEventListener("click", e => {
    const el = e.target.closest("[data-act]");
    if (!el || el.disabled) return;
    const fn = ACT[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el, e); }
  });
  document.addEventListener("keydown", e => {
    if (!sheet.hidden) { if (e.key === "Escape") closeSheet(); return; }
    if ((e.key === "Enter" || e.key === " ") && e.target.getAttribute && e.target.getAttribute("role") === "button") { e.preventDefault(); e.target.click(); return; }
    if (e.altKey || e.metaKey) return;
    if (e.ctrlKey) { if (e.key === "z" && (cur === "#/s" || cur === "#/done") && sess && sess.log.length && !/INPUT|TEXTAREA/.test(e.target.tagName)) { e.preventDefault(); undo(); } return; }
    if (onKey) onKey(e);
  });
  let tx = 0, ty = 0, tt = 0;
  view.addEventListener("touchstart", e => { const t = e.touches[0]; tx = t.clientX; ty = t.clientY; tt = Date.now(); }, { passive: true });
  view.addEventListener("touchend", e => {
    if (!onSwipe) return;
    const t = e.changedTouches[0], dx = t.clientX - tx, dy = t.clientY - ty;
    if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.6 && Date.now() - tt < 700) onSwipe(dx < 0 ? 1 : -1);
  }, { passive: true });

  /* ───── 路由 ───── */
  const PAGES = { "": home, s: sessPage, done: donePage, scene: scenePage, tpl: tplPage, essay: essayPage, find: findPage, weak: weakPage, guide: guidePage };
  let cur = "";
  function route() {
    clearTimeout(timer); onKey = null; onSwipe = null; stage = "";
    closeSheet(); setStrip(null);
    const m = location.hash.match(/^#\/([a-z]*)(?:\/(.*))?$/);
    const page = m ? m[1] : "", arg = m && m[2] ? decodeURIComponent(m[2]) : "";
    const changed = cur !== location.hash;
    cur = location.hash;
    if (changed) window.scrollTo(0, 0);
    (PAGES[page] || home)(arg);
  }
  window.addEventListener("hashchange", route);
  window.addEventListener("storage", e => { if (e.key === KEY) { ST = fresh(store.get(KEY, null)); sess = store.get(SKEY, null); layerSessions = store.get(LKEY, {}) || {}; restoreSessions(); route(); } });   // 另一个标签页背过了
  document.addEventListener("visibilitychange", () => { if (!document.hidden && D && (cur === "" || cur === "#/" || cur === "#")) home(); });   // 隔夜回来，「今天」要换

  async function boot() {
    try {
      const r = await fetch("data.json", { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      D = await r.json();
      index();
    } catch (e) {
      setBar("", "作文背诵");
      render(`<p class="placeholder">内容没读出来${navigator.onLine === false ? "（没网，这台设备上还没存过）" : ""}。<br><button class="btn" onclick="location.reload()">再试一次</button></p>`);
      return;
    }
    // Preserve an exact, one-time copy before adding any new progress fields.
    if (!store.get("zuowen-v1-before-layers", null)) {
      const old = store.get(KEY, null); if (old) store.set("zuowen-v1-before-layers", old);
    }
    restoreSessions();
    route();
    if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("../sw.js").catch(() => {});   // 讲义网站的离线缓存，看过一次没网也能背
  }
  boot();
})();
