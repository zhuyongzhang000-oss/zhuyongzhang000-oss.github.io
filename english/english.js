"use strict";
/* 英语 · 写作词：看中文写英文。词库是 data/english/words.js（GPT 维护），记录存在电脑上。
   首页「今天」= 要复习的错词 + 按批次往后的新词（先看一遍，再听写）；错词规则和政治一样。
   页面：#/english · learn 看新词 · dict 听写 · done 听写完 · words 词表 · wrong 错词本 · read 阅读会认 */
(() => {
  const { $, esc, pct } = K;
  const SID = "english";
  const TONE = { "小作文": "毛中特", "大作文": "史纲", "基础": "新思想", "阅读": "思修" };
  let WORDS = [], BYID = {}, ORDER = [], READ = [], wordsSrc = "";
  let S = null;            // today、wrong、answers、stats、prefs
  let sess = null;         // 当前一组听写：{kind, title, ids, pos, log:[{id, ok, typed, aid, ev}]}
  let learnPos = 0, revealAll = false, query = "";

  /* ───── 读数据 ───── */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("词库 words.js 读不出来"));
      document.head.appendChild(s);
    });
  }
  async function init() {
    const st = await K.get("/api/english/state");
    if (!st.ok) throw new Error(st.why || "没找到词库");
    if (!WORDS.length || st.words !== wordsSrc) { window.WORDS = undefined; await loadScript(st.words); wordsSrc = st.words; index(); }
    S = { today: st.today, wrong: st.review, answers: st.answers, stats: st.stats, prefs: st.prefs };
    sess = sess || K.store.get("xuexi-en-sess", null);
  }
  const idOf = w => w.kind + "|" + w.en;
  function index() {
    WORDS = (window.WORDS || []).filter(w => w && w.en && w.zh).map((w, i) => ({ ...w, i, id: idOf(w) }));
    BYID = Object.fromEntries(WORDS.map(w => [w.id, w]));
    // 学习顺序：按批次（第 0 批是插队的），同一批按词库里的顺序
    ORDER = WORDS.filter(w => w.kind !== "认").sort((a, b) => ((a.batch ?? 999) - (b.batch ?? 999)) || a.i - b.i);
    READ = WORDS.filter(w => w.kind === "认");
  }
  const learned = w => !!S.answers[w.id];
  const learnedToday = () => ORDER.filter(w => S.answers[w.id] && S.answers[w.id][4] === S.today).length;
  function todayNew() {
    const quota = Math.max(0, (S.prefs.daily ?? 20) - learnedToday());
    if (!quota) return [];
    const out = [];
    for (const w of ORDER) {
      if (learned(w)) continue;
      const last = out[out.length - 1];
      if (out.length >= quota && (!last || w.batch !== last.batch || out.length >= quota + 4)) break;   // 尽量把一批凑完整
      out.push(w);
    }
    return out;
  }
  const dueReview = () => K.rules.due(S.wrong, S.today).filter(id => BYID[id] && BYID[id].kind !== "认");
  const activeWrong = () => Object.entries(S.wrong).filter(([id, w]) => BYID[id] && w.state === "active").map(([id]) => id);
  function batchLabel(ws) {
    const bs = [...new Set(ws.map(w => w.batch).filter(b => b != null))];
    if (!bs.length) return "";
    return bs.length === 1 ? `第 ${bs[0]} 批` : `第 ${bs[0]}–${bs[bs.length - 1]} 批`;
  }

  /* ───── 判分（沿用原来的单词本） ─────
     答案：ans（或 en）里「;」分开要写的几个词形，「|」分开任选的写法；答案里有大写就要求大小写一致 */
  function parts(w) {
    const src = w.ans || w.en.replace(/（[^）]*）|\([^)]*\)/g, "").replace(/\s*\/\s*/g, "|");
    return src.split(";").map(p => p.split("|").map(a => a.trim()).filter(Boolean)).filter(p => p.length);
  }
  const norm = s => s.replace(/[’‘`]/g, "'").replace(/[.,!?;:，。；：！？]/g, "").replace(/\s+/g, " ").trim();
  function same(input, alt) {
    const a = norm(input), b = norm(alt);
    if (/[A-Z]/.test(b)) return a === b ? "ok" : (a.toLowerCase() === b.toLowerCase() ? "case" : "no");
    return a.toLowerCase() === b.toLowerCase() ? "ok" : "no";
  }
  function lev(a, b) {
    const m = a.length, n = b.length, d = [];
    for (let i = 0; i <= m; i++) d[i] = [i];
    for (let j = 0; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }
  function grade(w, inputs) {
    const ps = parts(w), used = [], out = [];
    let allOk = inputs.length >= ps.length, caseOnly = false;
    for (const inp of inputs) {
      let hit = -1, why = "no";
      for (let i = 0; i < ps.length && hit < 0; i++) {
        if (used[i]) continue;
        for (const alt of ps[i]) { const r = same(inp, alt); if (r === "ok") { hit = i; break; } if (r === "case") why = "case"; }
      }
      if (hit >= 0) { used[hit] = true; out.push({ ok: true }); } else { allOk = false; if (why === "case") caseOnly = true; out.push({ ok: false }); }
    }
    out.forEach((o, k) => {
      if (o.ok) return;
      let best = null, bd = 1e9;
      ps.forEach((p, i) => { if (used[i]) return; p.forEach(alt => { const d = lev(norm(inputs[k]).toLowerCase(), norm(alt).toLowerCase()); if (d < bd) { bd = d; best = alt; } }); });
      o.near = best;
    });
    return { ok: allOk, cells: out, caseOnly: caseOnly && !allOk };
  }
  // 逐字母对比：<del> 是多写或写错的字母，<ins> 是漏掉的字母
  function diff(mine, right) {
    const a = mine, b = right, m = a.length, n = b.length, L = [];
    for (let i = 0; i <= m; i++) { L[i] = []; for (let j = 0; j <= n; j++) L[i][j] = 0; }
    for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let html = "", buf = "", tag = "";
    const flush = () => { if (!buf) return; html += tag ? `<${tag}>${esc(buf)}</${tag}>` : esc(buf); buf = ""; };
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

  /* ───── 记录：这边先记、马上显示，同时送到电脑上（连不上就排队） ───── */
  function record(w, ok, typed, mode, flags = []) {
    const d = S.today, prev = S.wrong[w.id] ? { ...S.wrong[w.id] } : null;
    const [row, ev] = K.rules.transition(prev, ok, d);
    if (row) S.wrong[w.id] = row;
    const a = S.answers[w.id] || [null, 0, "", 0, d];
    S.answers[w.id] = [typed, ok ? 1 : 0, flags.join(","), a[3] + 1, a[4]];
    S.stats.n++;
    if (ok) S.stats.ok++;
    const entry = { id: w.id, ok, typed, ev };
    K.send("/api/english/answer", { id: w.id, typed, correct: ok, flags, mode }).then(r => {
      if (r.review) S.wrong[w.id] = r.review; else delete S.wrong[w.id];
      entry.aid = r.id;
      saveSess();
    }).catch(e => K.toast(e.message));
    return entry;
  }
  const saveSess = () => K.store.set("xuexi-en-sess", sess);

  /* ───── 首页 ───── */
  function home() {
    K.setTone(null);
    K.setBar(K.titleBar({ name: "英语 · 写作词" }));
    const rev = dueReview(), nw = todayNew(), act = activeWrong();
    const total = ORDER.length, done = ORDER.filter(learned).length;
    const next = ORDER.find(w => !learned(w));
    const waitN = act.filter(id => !rev.includes(id)).length;
    const daily = S.prefs.daily ?? 20;
    const what = rev.length || nw.length ? [rev.length ? `复习 ${rev.length} 个` : "", nw.length ? `新词 ${nw.length} 个` : ""].filter(Boolean).join(" · ") : "今天的都做完了 ✓";
    const where = nw.length ? `新词：${batchLabel(nw)} · ${[...new Set(nw.map(w => w.scene))].slice(0, 3).join("、")}`
      : next ? `明天接着学${next.batch != null ? `第 ${next.batch} 批` : ""}` : "词库里的词都学过了";
    let html = `<div class="e-home"><div class="side">
      <div class="cont" data-b="毛中特"><div class="band"><span class="eyebrow">今天</span><span class="what">${esc(what)}</span><span class="where">${esc(where)}</span></div>
      <div class="go e-go">
        ${rev.length ? `<button class="btn primary" data-act="e:start" data-k="review">复习 <small>${rev.length}</small></button>` : ""}
        ${nw.length ? `<button class="btn${rev.length ? "" : " primary"}" data-act="e:learn">先看一遍新词</button><button class="btn" data-act="e:start" data-k="new">直接听写新词</button>` : ""}
        ${!rev.length && !nw.length && next ? `<button class="btn" data-act="e:more">再学 10 个</button>` : ""}
      </div></div>
      <div class="card"><h3>错词本 <b>${act.length}</b></h3>
        <div class="line">${act.length ? ([rev.length ? `今天能清 ${rev.length} 个（就是上面的复习）` : "", waitN ? `今天错的 ${waitN} 个明天再清` : ""].filter(Boolean).join(" · ") || "都在抽查期") : "听写错的词会自动放进来"}</div>
        <div class="row"><a class="btn" href="#/english/wrong">看错词本</a></div></div>
      <p class="today">${S.stats.n ? `今天听写了<b>${S.stats.n}</b>个 · 对<b>${pct(S.stats.ok / S.stats.n)}</b>` : "今天还没听写"}</p>
      <div class="row e-daily"><span class="faint">每天新词</span><div class="seg">${[10, 20, 30].map(n => `<button data-act="e:daily" data-v="${n}" aria-pressed="${daily === n}">${n}</button>`).join("")}</div></div>
      </div><div class="main">
      <div class="card"><h3>进度 <b>${done}</b><span class="faint">/ ${total} 个会写词</span></h3>
        <div class="prog"><i class="g" style="width:${(done / Math.max(1, total)) * 100}%"></i></div>
        <div class="line">${next ? `下一个：${esc(next.zh)}（${next.batch != null ? `第 ${next.batch} 批 · ` : ""}${esc(next.cat)} · ${esc(next.scene)}）` : "全部学过了"}</div>
        <div class="row"><a class="btn" href="#/english/words">词表</a></div></div>
      ${READ.length ? `<div class="card"><h3>阅读 · 会认 <b>${READ.length}</b></h3><div class="line">看英文想意思，认不出的也进错词本</div>
        <div class="row"><a class="btn" href="#/english/read">过一遍</a></div></div>` : ""}
      <p class="note">词库由 GPT 按 Notion 会写词库更新（data/english/words.js）。在设置里点「更新」就换上新词，记录不受影响。</p>
      </div></div>`;
    K.render(html);
  }

  /* ───── 看新词：一个一屏，看完马上听写这一批 ───── */
  function learnPage() {
    const ws = todayNew();
    if (!ws.length) { K.go("#/english"); return; }
    learnPos = Math.max(0, Math.min(learnPos, ws.length - 1));
    const w = ws[learnPos], last = learnPos === ws.length - 1;
    K.setTone(TONE[w.cat] || "毛中特");
    K.setBar(K.backBar("看新词", "#/english", `<span class="count">${learnPos + 1} / ${ws.length}</span>`));
    K.setStrip((learnPos + 1) / ws.length, 0);
    K.render(`<article class="wcard">
        <div class="band"><span class="tag">${esc(w.cat)} · ${esc(w.scene)}${w.batch != null ? ` · 第 ${w.batch} 批` : ""}</span><p class="zh">${esc(w.zh)}</p></div>
        <div class="body"><p class="en-big">${esc(w.en)}</p>${w.note ? `<p class="wnote">${esc(w.note)}</p>` : ""}</div></article>
      <div class="next" style="margin-top:16px">
        <button class="btn" data-act="e:lprev"${learnPos ? "" : " disabled"}>←</button>
        ${last ? `<button class="btn primary wide" data-act="e:start" data-k="new">记住了，听写这 ${ws.length} 个 →</button>` : `<button class="btn primary wide" data-act="e:lnext">下一个 →</button>`}</div>
      <p class="keys"><kbd>←</kbd> <kbd>→</kbd> 翻 · <kbd>Enter</kbd> 下一个 · 手机上左右滑</p>`, true);
    K.onSwipe = d => { if (d > 0 && !last) { learnPos++; learnPage(); } else if (d < 0 && learnPos) { learnPos--; learnPage(); } };
    K.onKey = e => {
      if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); if (last) startSession("new"); else { learnPos++; learnPage(); } }
      if (e.key === "ArrowLeft" && learnPos) { e.preventDefault(); learnPos--; learnPage(); }
    };
  }

  /* ───── 听写：一个一屏，写对直接下一个 ───── */
  const TITLE = { review: "复习", new: "新词", wrong: "清错词", again: "再听写错的" };
  function startSession(kind, ids) {
    if (!ids) ids = kind === "new" ? todayNew().map(w => w.id) : dueReview();
    ids = (ids || []).filter(id => BYID[id]);
    if (!ids.length) { K.toast("没有要听写的词"); return; }
    sess = { kind, title: TITLE[kind] || "听写", ids, pos: 0, log: [] };
    saveSess();
    K.go("#/english/dict");
  }
  let stage = "input", lastEntry = null;
  function dictPage() {
    if (!sess || !sess.ids.length) { K.go("#/english"); return; }
    if (sess.pos >= sess.ids.length) { K.go("#/english/done"); return; }
    const w = BYID[sess.ids[sess.pos]];
    if (!w) { sess.ids.splice(sess.pos, 1); saveSess(); dictPage(); return; }
    const n = parts(w).length;
    stage = "input";
    K.setTone(TONE[w.cat] || "毛中特");
    K.setBar(K.backBar(sess.title, "#/english", `<span class="count">${sess.pos + 1} / ${sess.ids.length}</span>`));
    const ok = sess.log.filter(x => x.ok).length;
    K.setStrip(ok / sess.ids.length, (sess.log.length - ok) / sess.ids.length);
    K.render(`<article class="wcard">
        <div class="band"><span class="tag">${esc(w.cat)} · ${esc(w.scene)}</span><p class="zh">${esc(w.zh)}</p></div>
        <div class="body">${n > 1 ? `<p class="hint">要写 ${n} 个词形，每格一个，顺序不限</p>` : ""}
          <div class="inputs">${Array.from({ length: n }, (_, k) => `<input type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="第 ${k + 1} 个" enterkeyhint="done">`).join("")}</div>
          <div class="acts" id="e-acts" style="margin-top:14px"><button class="btn primary" data-act="e:submit">提交</button><button class="link" data-act="e:giveup">不会，看答案</button></div>
          <div id="e-v"></div></div></article>
      <p class="keys"><kbd>Enter</kbd> 提交 / 下一个 · <kbd>Esc</kbd> 不会</p>`, true);
    const first = $(".inputs input");
    if (first) first.focus();
    K.onKey = e => {
      if (e.key === "Enter") { e.preventDefault(); if (stage === "input") submit(false); else if (stage === "shown") nextWord(); }
      else if (e.key === "Escape" && stage === "input") { e.preventDefault(); submit(true); }
    };
  }
  function submit(giveUp) {
    if (stage !== "input") return;
    const w = BYID[sess.ids[sess.pos]];
    const ins = K.$$(".inputs input"), vals = ins.map(x => x.value);
    if (!giveUp && vals.every(v => !v.trim())) { ins[0].focus(); return; }
    const g = giveUp ? { ok: false, cells: vals.map(() => ({ ok: false })) } : grade(w, vals);
    const typed = vals.filter(v => v.trim()).join(" / ");
    const entry = record(w, g.ok, giveUp ? "" : typed, sess.kind, giveUp ? ["dunno"] : []);
    sess.log.push(entry);
    lastEntry = entry;
    saveSess();
    stage = g.ok ? "flash" : "shown";
    ins.forEach((x, k) => { x.readOnly = true; x.classList.add(g.cells[k] && g.cells[k].ok ? "ok" : "bad"); });
    const okN = sess.log.filter(x => x.ok).length;
    K.setStrip(okN / sess.ids.length, (sess.log.length - okN) / sess.ids.length);
    if (g.ok) {
      $("#e-acts").innerHTML = `<span class="res ok">✓ 对</span>`;
      if (entry.ev === "移出" || entry.ev === "掌握") K.toast(K.rules.event(entry.ev, S.wrong[w.id], false, "错词本")[1]);
      setTimeout(() => { if (K.cur.page === "dict" && stage === "flash" && lastEntry === entry) nextWord(); }, 550);
      return;
    }
    let d = "";
    if (!giveUp) g.cells.forEach((c, k) => {
      if (!c.ok && c.near && vals[k].trim() && lev(norm(vals[k]).toLowerCase(), norm(c.near).toLowerCase()) <= Math.max(2, Math.ceil(c.near.length * 0.4)))
        d += `<p class="diff">${diff(norm(vals[k]), c.near)}</p>`;
    });
    const ev = K.rules.event(entry.ev, S.wrong[w.id], false, "错词本");
    $("#e-acts").hidden = true;
    $("#e-v").innerHTML = `<div class="verdict"><p class="res bad">${giveUp ? "不会" : g.caseOnly ? "大小写不对" : "✗ 错了"}</p>
      <p class="ans">${esc(w.en)}</p>${d}${w.note ? `<p class="wnote">${esc(w.note)}</p>` : ""}
      ${ev ? `<p class="ev ${ev[0]}">${esc(ev[1])}</p>` : ""}
      <div class="next"><button class="btn primary wide" data-act="e:next">${sess.pos + 1 < sess.ids.length ? "下一个" : "看结果"} →</button>
        ${!giveUp ? `<button class="link" data-act="e:mine">我写的也对，算对</button>` : ""}</div></div>`;
    if (document.activeElement) document.activeElement.blur();
  }
  function nextWord() { stage = "moving"; sess.pos++; saveSess(); dictPage(); window.scrollTo(0, 0); }
  async function mine() {
    const e = lastEntry;
    if (!e) return;
    if (!e.aid) await K.flush();
    if (!e.aid) { K.toast("还没存到电脑上，连上以后再改"); return; }
    try {
      await K.post("/api/english/undo", { id: e.aid });
      const r = await K.post("/api/english/answer", { id: e.id, typed: e.typed, correct: true, flags: ["accepted"], mode: sess.kind });
      if (r.review) S.wrong[e.id] = r.review; else delete S.wrong[e.id];
      e.ok = true; e.aid = r.id; S.stats.ok++;
      if (S.answers[e.id]) S.answers[e.id][1] = 1;
      saveSess();
      K.toast("算对了");
      nextWord();
    } catch (err) { K.toast(err.message); }
  }

  /* ───── 听写完 ───── */
  function donePage() {
    if (!sess) { K.go("#/english"); return; }
    K.setTone("毛中特");
    K.setBar(K.backBar(sess.title, "#/english"));
    const ok = sess.log.filter(x => x.ok).length, bad = sess.log.filter(x => !x.ok);
    const moved = sess.log.filter(x => x.ok && (x.ev === "移出" || x.ev === "掌握")).length;
    K.render(`<div class="done"><h2>${esc(sess.title)} · 做完了</h2>
      <div class="score">${ok}<small> / ${sess.log.length}</small></div>
      <div class="kpis"><span>对<b>${ok}</b></span><span class="bad">错<b>${bad.length}</b></span>${moved ? `<span>移出错词本<b>${moved}</b></span>` : ""}</div>
      ${bad.length ? `<div class="wlist">${bad.map(x => { const w = BYID[x.id]; return w ? `<div class="wrow"><span class="zh">${esc(w.zh)}</span><span class="en on">${esc(w.en)}</span>${x.typed ? `<span class="sc"><s>${esc(x.typed)}</s></span>` : `<span class="sc">不会</span>`}</div>` : ""; }).join("")}</div>` : ""}
      <div class="acts">${bad.length ? `<button class="btn primary" data-act="e:again">再听写错的 ${bad.length} 个</button>` : ""}
        <a class="btn${bad.length ? "" : " primary"}" href="#/english">回首页</a>
        ${bad.length ? `<button class="btn" data-act="e:copy-bad">复制给 GPT</button>` : ""}</div>
      ${bad.length ? `<p class="note">错的词已经在错词本里，隔天写对就移出。现在马上再写一遍是练手，不算移出。</p>` : ""}</div>`, true);
  }

  /* ───── 词表：按学习顺序，英文默认盖住（讲义网站上英语只有这一页） ───── */
  function wordsPage() {
    K.setTone(null);
    K.setBar(K.STATIC ? K.titleBar({ name: "英语 · 写作词" }) : K.backBar("词表", "#/english"));
    const q = query.trim().toLowerCase();
    const match = w => !q || w.zh.toLowerCase().includes(q) || w.en.toLowerCase().includes(q) || String(w.scene || "").includes(q);
    const groups = new Map();
    for (const w of ORDER) { if (!match(w)) continue; const k = w.batch ?? "未分批"; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(w); }
    const dot = w => (K.STATIC ? "none" : S.wrong[w.id] && S.wrong[w.id].state === "active" ? "bad" : learned(w) ? "ok" : "");
    let html = `<div class="row" style="margin-bottom:6px"><input id="e-q" class="search" type="search" placeholder="搜中文或英文" value="${esc(query)}" autocomplete="off">
      <button class="btn small" data-act="e:reveal">${revealAll ? "盖住英文" : "显示英文"}</button></div>
      <p class="faint" style="margin:0 0 6px">${K.STATIC ? "按学习顺序排。英文默认盖住，先自己想，点一下揭开；「显示英文」一次全部揭开。最后的「阅读 · 会认」盖的是中文。"
        : "按学习顺序排。英文默认盖住，点一下揭开。绿点学过，红点在错词本里。"}</p>`;
    for (const [b, ws] of groups) {
      html += `<div class="group"><div class="ghead"><span>${b === "未分批" ? "未分批" : b === 0 ? "第 0 批（插队）" : `第 ${b} 批`}</span><small>${ws.length}</small></div>`
        + ws.map(w => `<div class="wrow"><i class="dot ${dot(w)}"></i><span class="zh">${esc(w.zh)}</span>
          <button class="en${revealAll ? " on" : ""}" data-act="e:peek">${esc(w.en)}</button><span class="sc">${esc(w.cat)} · ${esc(w.scene)}</span></div>`).join("") + `</div>`;
    }
    const rd = READ.filter(match);
    if (rd.length) {
      html += `<div class="group"><div class="ghead"><span>阅读 · 会认</span><small>${rd.length}</small></div>${rd.map(w =>
        `<div class="wrow"><i class="dot ${dot(w)}"></i><span class="zh">${esc(w.en)}</span><button class="en${revealAll ? " on" : ""}" data-act="e:peek">${esc(w.zh)}</button><span class="sc">${esc(w.scene || "")}</span></div>`).join("")}</div>`;
    }
    if (!groups.size && !rd.length) html += `<p class="placeholder">没有符合的词</p>`;
    K.render(html, true);
    const inp = $("#e-q");
    inp.addEventListener("input", () => { query = inp.value; const pos = inp.selectionStart; wordsPage(); const ni = $("#e-q"); ni.focus(); ni.setSelectionRange(pos, pos); });
  }

  /* ───── 错词本 ───── */
  function wrongPage() {
    K.setTone(null);
    K.setBar(K.backBar("错词本", "#/english"));
    const act = activeWrong().sort((a, b) => ORDER.indexOf(BYID[a]) - ORDER.indexOf(BYID[b]));
    const due = dueReview();
    const pro = Object.entries(S.wrong).filter(([id, w]) => BYID[id] && w.state === "probation").length;
    let html = `<div class="card"><h3>错词本 <b>${act.length}</b></h3><div class="line">今天能清 ${due.length} 个 · 抽查中 ${pro} 个</div>
      <div class="row"><button class="btn primary" data-act="e:start" data-k="wrong"${due.length ? "" : " disabled"}>清错词${due.length ? ` <small>${due.length}</small>` : ""}</button>
      <button class="btn" data-act="e:copy-wrong"${act.length ? "" : " disabled"}>复制给 GPT</button></div></div>
      <p class="note">听写错自动进来。隔天写对一次就移出，7 天后再抽查一次；抽查对了算掌握。当天错当天又写对不算。</p>`;
    html += act.length ? `<div class="wlist" style="margin-top:12px">${act.map(id => {
      const w = BYID[id], r = S.wrong[id], a = S.answers[id];
      return `<div class="wrow"><span class="zh">${esc(w.zh)}</span><span class="en on">${esc(w.en)}</span>
        <span class="sc">错 ${r.n} 次${a && a[0] && !a[1] ? ` · 上次写 <s>${esc(a[0])}</s>` : ""} · ${r.due <= S.today ? "今天能清" : "明天能清"}</span></div>`;
    }).join("")}</div>` : `<p class="placeholder">错词本是空的。</p>`;
    K.render(html, true);
  }
  function gptText(ids, title) {
    const lines = [`下面是我考研英语写作词听写${title}的 ${ids.length} 个词。请帮我：① 按 Notion 会写词库更新错词记录；② 每个词给一句写作里能直接用的短例句，并指出我拼错的地方怎么记。`, ""];
    ids.forEach(id => { const w = BYID[id], a = S.answers[id]; if (w) lines.push(`- ${w.zh} → ${w.en}${a && a[0] && !a[1] ? `（我写成 ${a[0]}）` : ""}`); });
    return lines.join("\n");
  }

  /* ───── 阅读 · 会认 ───── */
  let readPos = 0, readShown = false;
  function readPage() {
    if (!READ.length) { K.go("#/english"); return; }
    K.setTone("思修");
    if (readPos >= READ.length) {
      K.setBar(K.backBar("阅读 · 会认", "#/english"));
      K.render(`<div class="done"><h2>过完一遍</h2><div class="acts"><button class="btn primary" data-act="e:read-again">再过一遍</button><a class="btn" href="#/english">回首页</a></div></div>`, true);
      return;
    }
    const w = READ[readPos];
    K.setBar(K.backBar("阅读 · 会认", "#/english", `<span class="count">${readPos + 1} / ${READ.length}</span>`));
    K.setStrip(readPos / READ.length, 0);
    K.render(`<article class="wcard"><div class="band"><span class="tag">${esc(w.scene || "看英文想意思")}</span><p class="en-q">${esc(w.en)}</p></div>
      <div class="body">${readShown ? `<p class="zh-a">${esc(w.zh)}</p>${w.note ? `<p class="wnote">${esc(w.note)}</p>` : ""}
        <div class="acts" style="margin-top:12px"><button class="btn primary" data-act="e:read-ok">认识</button><button class="btn" data-act="e:read-no">不认识</button></div>`
      : `<div class="acts"><button class="btn primary" data-act="e:read-show">看意思</button></div>`}</div></article>`, true);
    K.onKey = e => { if (e.key === "Enter" && !readShown) { e.preventDefault(); readShown = true; readPage(); } };
  }
  function readMark(ok) {
    const w = READ[readPos];
    const entry = record(w, ok, ok ? "认识" : "不认识", "会认");
    if (!ok) { const ev = K.rules.event(entry.ev, S.wrong[w.id], false, "错词本"); if (ev) K.toast(ev[1]); }
    readPos++;
    readShown = false;
    readPage();
  }

  /* ───── 点击 ───── */
  K.acts({
    "e:start": el => startSession(el.dataset.k),
    "e:learn": () => { learnPos = 0; K.go("#/english/learn"); },
    "e:lnext": () => { learnPos++; learnPage(); },
    "e:lprev": () => { learnPos = Math.max(0, learnPos - 1); learnPage(); },
    "e:more": async () => { S.prefs.daily = (S.prefs.daily ?? 20) + 10; await K.post("/api/english/prefs", { daily: S.prefs.daily }).catch(() => {}); home(); },
    "e:daily": async el => { S.prefs.daily = +el.dataset.v; try { await K.post("/api/english/prefs", { daily: S.prefs.daily }); } catch (e) { K.toast(e.message); } home(); },
    "e:submit": () => submit(false),
    "e:giveup": () => submit(true),
    "e:next": () => nextWord(),
    "e:mine": () => mine(),
    "e:again": () => startSession("again", sess.log.filter(x => !x.ok).map(x => x.id)),
    "e:copy-bad": async () => { const ids = sess.log.filter(x => !x.ok).map(x => x.id); K.toast(await K.copyText(gptText(ids, "这一轮写错")) ? "复制好了，贴到 GPT 对话里" : "复制不了，手动选中"); },
    "e:copy-wrong": async () => { K.toast(await K.copyText(gptText(activeWrong(), "错词本里")) ? "复制好了，贴到 GPT 对话里" : "复制不了，手动选中"); },
    "e:reveal": () => { revealAll = !revealAll; wordsPage(); },
    "e:peek": el => el.classList.toggle("on"),
    "e:read-show": () => { readShown = true; readPage(); },
    "e:read-ok": () => readMark(true),
    "e:read-no": () => readMark(false),
    "e:read-again": () => { readPos = 0; readShown = false; readPage(); },
  });

  K.subject({
    id: SID, name: "英语 · 写作词", tone: "毛中特",
    init,
    async onVisible() {
      if (K.cur.page === "dict" || K.cur.page === "learn") return;
      try { await init(); K.route(); } catch (e) { /* 离线时等恢复 */ }
    },
    pages: { home: K.STATIC ? wordsPage : home, learn: learnPage, dict: dictPage, done: donePage, words: wordsPage, wrong: wrongPage, read: () => { readPos = 0; readShown = false; readPage(); } },
  });
})();
