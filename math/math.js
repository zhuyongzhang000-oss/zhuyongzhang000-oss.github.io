"use strict";
/* 数学：讲义（自学用，真题导向）+ 公式本。内容是 data/math/*.md，服务端解析成块，这里负责显示和做题。
   页面：#/math 首页 · #/math/book/<讲义> 目录 · #/math/sec/<讲义>/<节>[/<锚点>] 读一节
        #/math/f/<公式本> 公式本 · #/math/wrong 错题本 · #/math/q/<讲义>/<题> 单独重做一道题
   做题：提示一层层给；对答案后自己判对错（选择题直接判）；真题做错或看了第 2 层提示才做对 → 进错题本。 */
(() => {
  const { $, $$, esc } = K;
  const SID = "math", TONE = "数学";
  let S = null;                        // state：books 书目、review 错题本、answers 每题最近一次、done 学完的节、last 上次读到哪
  const BOOK = {};                     // 讲义 id → 全文
  const QS = {};                       // 这次打开以来每道题的状态：hints 看了几层、open 对过答案、sol 先看了解答、res 结果
  const ICON = {
    list: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>',
  };

  /* ───── 公式组件（KaTeX，第一次进数学时才加载） ───── */
  let katexP = null;
  function loadKatex() {
    if (window.katex) return Promise.resolve();
    if (!katexP) katexP = new Promise((resolve, reject) => {
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.href = "vendor/katex/katex.min.css";
      document.head.appendChild(l);
      const s = document.createElement("script");
      s.src = "vendor/katex/katex.min.js";
      s.onload = resolve;
      s.onerror = () => { katexP = null; reject(new Error("公式显示组件没加载上，刷新一下")); };
      document.head.appendChild(s);
    });
    return katexP;
  }
  const texCache = new Map();
  function tex(src, display) {
    const key = (display ? "D" : "I") + src;
    let h = texCache.get(key);
    if (h == null) {
      try { h = katex.renderToString(src, { displayMode: !!display, throwOnError: false, strict: "ignore", output: "html" }); }
      catch (e) { h = `<code>${esc(src)}</code>`; }
      texCache.set(key, h);
    }
    return h;
  }

  function texGlue(src, punct) {
    const h = tex(src), end = "</span></span></span>";
    return h.endsWith(end) ? h.slice(0, -end.length) + `<span class="kp">${esc(punct)}</span>` + end : h + esc(punct);
  }

  /* ───── 行内：$公式$、**加粗**、[[泰勒:ex]] 公式链接、[[节3]] 跳到本讲某一节 ───── */
  const INL = /\$([^$]+)\$|\*\*(.+?)\*\*|\[\[([^\]]+)\]\]/g;
  function inl(s, ctx) {
    s = String(s || "");
    let out = "", last = 0, m;
    const re = new RegExp(INL.source, "g");      // 每次新建：加粗里还会递归调用 inl
    while ((m = re.exec(s))) {
      out += esc(s.slice(last, m.index));
      if (m[1] != null) {
        // 公式后面紧跟的标点，塞进公式最后一段（KaTeX 的 .base 不折行），免得「。」单独掉到下一行；前面照样能在 = + 处折行
        const pm = s.slice(re.lastIndex).match(/^[。，、；：！？）」』”]+/);
        if (pm) { out += texGlue(m[1], pm[0]); re.lastIndex += pm[0].length; last = re.lastIndex; continue; }
        out += tex(m[1]);
      }
      else if (m[2] != null) out += `<b>${inl(m[2], ctx)}</b>`;
      else out += link(m[3], ctx);
      last = re.lastIndex;
    }
    return out + esc(s.slice(last));
  }
  function formulaRef(name, fid) {
    const b = (S.books || []).find(x => x.类型 === "公式本" && x.简称 === name);
    return b ? { book: b.id, fid } : null;
  }
  function link(body, ctx) {
    const [target, text] = body.split("|");
    const fm = target.match(/^([^:：]+)[:：](.+)$/);
    if (fm) {
      const ref = formulaRef(fm[1].trim(), fm[2].trim());
      const label = text || fm[2].trim();
      if (!ref) return esc(label);
      return `<button class="fref" data-act="m:fpop" data-book="${esc(ref.book)}" data-fid="${esc(ref.fid)}">${inl(label, ctx)}</button>`;
    }
    const sm = target.match(/^节\s*(\w+)$/);
    if (sm && ctx && ctx.book) return `<a class="sref" href="#/math/sec/${esc(ctx.book)}/${esc(sm[1])}">${esc(text || target)}</a>`;
    return esc(text || target);
  }

  /* ───── 块 ───── */
  function blocks(arr, ctx) { return (arr || []).map(b => block(b, ctx)).join(""); }
  function block(b, ctx) {
    switch (b.t) {
      case "p": return `<p>${inl(b.text, ctx)}</p>`;
      case "h": { const id = `h-${ctx.h = (ctx.h || 0) + 1}`; return `<h3 class="mh" id="${id}" data-at="${id}">${inl(b.text, ctx)}</h3>`; }
      case "goal": return `<p class="goal">${inl(b.text, ctx)}</p>`;
      case "ul": return `<ul>${b.items.map(x => `<li>${inl(x, ctx)}</li>`).join("")}</ul>`;
      case "ol": return `<ol>${b.items.map(x => `<li>${inl(x, ctx)}</li>`).join("")}</ol>`;
      case "math": return `<div class="mx">${tex(b.tex, true)}</div>`;
      case "table": return `<div class="tw"><table>${b.rows.map((r, i) => `<tr>${r.map(c => i ? `<td>${inl(c, ctx)}</td>` : `<th>${inl(c, ctx)}</th>`).join("")}</tr>`).join("")}</table></div>`;
      case "box": return `<div class="mbox ${b.kind}"><div class="ml">${esc(b.label)}${b.title ? ` · ${inl(b.title, ctx)}` : ""}</div>${blocks(b.body, ctx)}</div>`;
      case "ex": return example(b, ctx);
      case "q": return problem(b, ctx);
      case "recap": return `<div class="recap" id="recap" data-at="recap"><div class="ml">收口</div><p class="ask">合上讲义想一想：这类题怎么认？第一步做什么？</p>
        <details><summary>对照一下</summary>${blocks(b.body, ctx)}</details></div>`;
      case "plot": return `<figure class="plot" data-spec="${esc(b.spec)}" data-lines="${esc(JSON.stringify(b.lines))}"></figure>`;
      case "later": return `<p class="later">${inl(b.text, ctx)}</p>`;
      case "f": return frow(b, ctx.fbook, false);
      case "cards": return cardsHtml(b.items, ctx);
      default: return "";
    }
  }

  /* 长的单独公式：放不下就整体缩小（最多缩到 62%），平板上保持一行，手机上不用左右拖 */
  function fitMath(root) {
    $$(".mx, .opt .t", root || $("#view")).forEach(el => {
      el.style.fontSize = "";
      const cw = el.clientWidth;
      if (!cw || el.scrollWidth <= cw + 1) return;
      let f = Math.max(0.62, cw / el.scrollWidth * 0.98);
      el.style.fontSize = (f * 100).toFixed(1) + "%";
      for (let i = 0; i < 5 && el.scrollWidth > el.clientWidth + 1 && f > 0.62; i++) {
        f = Math.max(0.62, f - 0.03);
        el.style.fontSize = (f * 100).toFixed(1) + "%";
      }
    });
  }
  let fitT = null;
  window.addEventListener("resize", () => { clearTimeout(fitT); fitT = setTimeout(() => { if (K.cur.sid === SID) fitMath(); }, 150); });
  document.addEventListener("toggle", e => { if (K.cur.sid === SID && e.target.tagName === "DETAILS" && e.target.open) fitMath(e.target); }, true);
  // KaTeX 字体是后加载的：第一次量宽度时还是替代字体，字体到了公式会变宽，再量一次
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", () => { if (K.cur.sid === SID) fitMath(); });

  /* 反应卡：左边题眼，右边盖着（盖板叠在答案上面，翻开时页面不动） */
  function cardsHtml(items, ctx) {
    return `<div class="zcards">${items.map(c => `<div class="zcard" data-act="m:zflip" role="button" tabindex="0">
      <div class="zq">${inl(c[0], ctx)}</div><div class="za"><div class="zc-ans">${inl(c[1], ctx)}</div><span class="zc-cover">想好了，点开对照</span></div></div>`).join("")}</div>`;
  }

  /* 例题：先想，再一步步看 */
  function example(b, ctx) {
    const id = `ex-${ctx.ex = (ctx.ex || 0) + 1}`;
    const n = b.steps.length;
    return `<div class="ex" id="${id}" data-at="${id}" data-n="${n}" data-shown="0">
      <div class="ml">例题${b.title ? ` · ${inl(b.title, ctx)}` : ""}</div>${blocks(b.q, ctx)}
      ${b.steps.map((s, i) => `<div class="step" data-i="${i}" hidden><span class="sn">${i + 1}</span><div>${blocks(s, ctx)}</div></div>`).join("")}
      ${n ? `<div class="exacts"><button class="btn small" data-act="m:step" data-ex="${id}">先想第一步，想好了点这里</button><button class="link" data-act="m:allsteps" data-ex="${id}">全部展开</button></div>` : ""}</div>`;
  }

  /* —— 题：诊断 / 练习 / 真题（总复习里的练习叫「综合」） —— */
  const itemOf = (ctx, q) => `${ctx.book}/${q.id}`;
  function qTag(q) {
    if (q.kind === "真题") return `真题 · ${q.src.year} 第${q.src.no}题`;
    if (q.id.startsWith("zf-")) return q._n ? `综合 ${q._n}` : "综合";
    return q._n ? `${q.kind} ${q._n}` : q.kind;
  }
  function secOf(bid, sid) { const b = BOOK[bid] || (S.books || []).find(x => x.id === bid); return b && b.sections.find(s => s.id === sid); }
  function numberQs(sec) {        // 同一节里的练习、诊断按出现顺序编号
    const n = {};
    sec.blocks.forEach(b => { if (b.t === "q" && b.kind !== "真题") b._n = n[b.kind] = (n[b.kind] || 0) + 1; });
  }
  function lastOf(item) { return (S.answers || {})[item]; }
  function reviewOf(item) { return (S.review || {})[item]; }
  function statusChip(item) {
    const w = reviewOf(item), a = lastOf(item);
    if (w && (w.state === "active" || w.state === "probation")) {
      const due = w.due && w.due <= S.today;
      return `<span class="qst bad">${w.state === "probation" ? "抽查" : "错题本"}${due ? " · 今天" : w.due ? " · " + K.dayLabel(w.due, S.today) : ""}</span>`;
    }
    if (!a) return "";
    return a[1] ? `<span class="qst ok">上次做对</span>` : `<span class="qst bad">上次没做对</span>`;
  }
  function problem(q, ctx) {
    const item = itemOf(ctx, q);
    const st = QS[item] || {};
    const choice = q.type === "选择" && Object.keys(q.options).length;
    const meta = [q.type, q.src && q.src.score ? `${q.src.score} 分` : ""].filter(Boolean).join(" · ");
    let html = `<section class="mq${st.res ? " " + st.res : ""}" id="q-${esc(q.id)}" data-at="q-${esc(q.id)}" data-item="${esc(item)}">
      <header class="qh"><span class="qtag${q.kind === "真题" ? " zt" : ""}">${esc(qTag(q))}</span>${meta ? `<span class="qmeta">${esc(meta)}</span>` : ""}<span class="sp"></span>${statusChip(item)}</header>
      <div class="qb">${blocks(q.q, ctx)}</div>`;
    if (choice) {
      html += `<div class="opts">${Object.entries(q.options).map(([k, v]) => {
        let cls = "";
        if (st.res) cls = k === q.answer ? " ok" : (k === st.choice ? " bad" : " dim");
        return `<button class="opt${cls}${st.res ? " done" : ""}" data-act="m:opt" data-k="${k}"${st.res ? " disabled" : ""}><span class="k">${k}</span><span class="t">${inl(v, ctx)}</span></button>`;
      }).join("")}</div>`;
    }
    const nh = q.hints.length, seen = st.hints || 0;
    if (seen) html += `<div class="mhints">${q.hints.slice(0, seen).map((h, i) => `<div class="mhint"><span class="hl">提示 ${i + 1}</span>${blocks(h, ctx)}</div>`).join("")}</div>`;
    const showAns = st.open || st.res;
    if (!showAns) {
      html += `<div class="qacts">${seen < nh ? `<button class="btn small" data-act="m:hint">${seen ? "再给一点提示" : "给点提示"}</button>` : ""}
        ${choice ? `<span class="faint">选一个就判</span>` : `<button class="btn small primary" data-act="m:check">对答案</button>`}</div>`;
    } else {
      html += `<div class="mans">`;
      if (!choice && q.answer) html += `<p class="mkey"><b>答案</b>${inl(q.answer, ctx)}</p>`;
      if ((q.idea || []).length) html += `<div class="midea"><span class="il">思路</span>${blocks(q.idea, ctx)}</div>`;
      const note = (q.note || []).length ? `<div class="mnote"><span class="il">点评</span>${blocks(q.note, ctx)}</div>` : "";
      if (q.sol.length || note) {
        const openSol = !choice || (st.res === "bad");
        html += `<details class="sol"${openSol ? " open" : ""}><summary>${choice ? "看详细解析" : "详细解答"}</summary>${blocks(q.sol, ctx)}${note}</details>`;
      }
      if (q.of && st.res) {
        const s = secOf(ctx.book, q.of);
        if (s) html += `<p class="mof">这题考的是 <a href="#/math/sec/${esc(ctx.book)}/${esc(s.id)}">${esc(s.label)} ${esc(s.title)}</a></p>`;
      }
      if (!st.res) {
        html += `<div class="mark"><span class="mute">和答案一对：</span><button class="btn small ok" data-act="m:mark" data-v="1">做对了</button><button class="btn small bad" data-act="m:mark" data-v="0">没做对</button></div>`;
      } else {
        html += `<div class="mres">${resultLine(q, item, st)}</div>`;
      }
      html += `<div class="qfoot"><button class="link" data-act="m:gpt">问 GPT</button>${st.res ? `<button class="link" data-act="m:redo">重做这题</button>` : ""}</div></div>`;
    }
    return html + `</section>`;
  }
  function resultLine(q, item, st) {
    let msg;
    if (K.STATIC && q.kind === "真题") {         // 讲义网站：没有错题本，只说结果
      msg = st.res === "ok" && !st.unsure ? ["out", st.hintsUsed ? "做对了（看了 1 层提示）✓" : "独立做对 ✓"] : ["in", "没独立做出来 · 过几天再做一遍"];
    } else if (q.kind === "真题") {
      if (st.unsure) msg = ["in", "看了第 2 层提示或解答才做出来，先放进错题本 · 隔天自己再独立做一遍"];
      else if (st.res === "ok") msg = (st.event && K.rules.event(st.event, reviewOf(item), false, "错题本")) || ["out", st.hintsUsed ? "做对了（看了 1 层提示）✓" : "独立做对 ✓"];
      else msg = (st.event && K.rules.event(st.event, reviewOf(item), false, "错题本")) || ["in", "进了错题本 · 隔天做对就移出"];
    } else {
      msg = st.res === "ok" ? ["out", st.hintsUsed ? "记下了：看提示后做对" : "记下了：做对 ✓"] : ["in", q.kind === "诊断" ? "这一块从讲解开始学" : "记下了：没做对 · 看看提示和解答，弄懂了再做下一道"];
    }
    const undo = st.aid ? `<button class="link" data-act="m:undo">点错了，撤销</button>` : "";
    return `<span class="ev ${msg[0]}">${esc(msg[1])}</span>${undo}`;
  }

  /* ───── 首页 ───── */
  function bookProgress(b) {
    const secs = b.sections.filter(s => s.kind !== "review"), done = secs.filter(s => (S.done || {})[`${b.id}/${s.id}`]).length;
    const zt = secs.flatMap(s => s.zt), ok = zt.filter(z => { const a = lastOf(`${b.id}/${z}`); return a && a[1]; }).length;
    return { done, total: secs.length, ztOk: ok, zt: zt.length };
  }
  function dueItems() {
    return Object.entries(S.review || {}).filter(([, w]) => (w.state === "active" || w.state === "probation") && w.due && w.due <= S.today).map(([k]) => k);
  }
  function home() {
    K.setTone(TONE);
    K.setBar(K.titleBar({ name: "数学" }));
    const books = (S.books || []).filter(b => b.类型 === "讲义");
    const fbooks = (S.books || []).filter(b => b.类型 === "公式本");
    let html = `<div class="m-home">`;
    const last = S.last && books.find(b => b.id === S.last.book);
    const lastSec = last && last.sections.find(s => s.id === S.last.sec);
    if (lastSec) {
      html += `<div class="cont"><div class="band"><span class="eyebrow">接着学</span><span class="what">${esc(last.科目)}第${esc(last.讲)}讲 · ${esc(lastSec.label)} ${esc(lastSec.title)}</span>
        <span class="where">${esc(last.名称)}</span></div>
        <div class="go"><span class="mute"></span><a class="btn primary" href="#/math/sec/${last.id}/${lastSec.id}${S.last.at ? "/" + esc(S.last.at) : ""}">继续 →</a></div></div>`;
    }
    const due = dueItems();
    if (due.length) html += `<a class="m-row wrong" href="#/math/wrong"><span class="t">错题本</span><span class="m">今天该重做 <b>${due.length}</b> 道</span><span class="go">→</span></a>`;
    const groups = {};
    books.forEach(b => (groups[b.科目] = groups[b.科目] || []).push(b));
    for (const [subj, list] of Object.entries(groups)) {
      html += `<h2 class="sec">${esc(subj)}</h2><div class="m-books">`;
      html += list.map(b => {
        const p = bookProgress(b);
        return `<a class="m-book" href="#/math/book/${b.id}"><span class="no">${esc(b.讲)}</span><span class="nm">${esc(b.名称)}</span>
          <span class="st">学完 ${p.done}/${p.total} 节 · 真题做对 ${p.ztOk}/${p.zt}</span>
          <span class="prog"><i class="g" style="width:${p.done / Math.max(1, p.total) * 100}%"></i></span></a>`;
      }).join("") + `</div>`;
    }
    if (fbooks.length) {
      const fg = {};
      fbooks.forEach(b => (fg[b.科目 || "高数"] = fg[b.科目 || "高数"] || []).push(b));
      html += `<h2 class="sec">公式本</h2>`;
      for (const [subj, list] of Object.entries(fg)) {
        if (Object.keys(fg).length > 1) html += `<div class="fgroup">${esc(subj)}</div>`;
        html += `<div class="m-books">` + list.map(b => {
          const n = b.formulas.length + b.sections.reduce((a, s) => a + s.formulas.length, 0);
          const bad = Object.keys(S.review || {}).filter(k => k.startsWith(b.id + "/") && ["active", "probation"].includes(S.review[k].state)).length;
          return `<a class="m-book f" href="#/math/f/${b.id}"><span class="no">ƒ</span><span class="nm">${esc(b.名称)}</span><span class="st">${n} 条${bad ? ` · 没记牢 ${bad} 条` : ""}</span></a>`;
        }).join("") + `</div>`;
      }
    }
    if (!books.length && !fbooks.length) html += `<p class="placeholder">data/math 里还没有讲义。</p>`;
    if ((S.problems || []).length) html += `<details class="more" style="margin-top:18px"><summary>讲义文件有 ${S.problems.length} 处写法问题（给维护的人看）</summary><ul>${S.problems.map(x => `<li>${esc(x)}</li>`).join("")}</ul></details>`;
    html += `<p class="note">讲义按真题来写：每节先测两道，会了直接做真题；不会就看讲解、例题，做练习。卡住先看提示，提示一层层给。</p></div>`;
    K.render(html, true);
  }

  /* ───── 一本讲义的目录 ───── */
  async function getBook(id) {
    if (!BOOK[id]) {
      const r = await fetch(`/api/math/book/${encodeURIComponent(id)}`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.错误 || "讲义没读到");
      BOOK[id] = data;
    }
    return BOOK[id];
  }
  async function bookPage(arg) {
    K.setTone(TONE);
    const meta = (S.books || []).find(b => b.id === arg);
    if (!meta) { K.setBar(K.backBar("讲义", "#/math")); K.render(`<p class="placeholder">没有这本讲义。</p>`); return; }
    K.setBar(K.backBar(`${meta.科目}第${meta.讲}讲`, "#/math"));
    const p = bookProgress(meta);
    let html = `<div class="m-toc"><h1>${esc(meta.名称)}</h1>${meta.简介 ? `<p class="mute">${inl(meta.简介, {})}</p>` : ""}
      <p class="faint">学完 ${p.done}/${p.total} 节 · 真题做对 ${p.ztOk}/${p.zt}</p><ol class="secs">`;
    html += meta.sections.map(s => {
      const k = `${meta.id}/${s.id}`, done = (S.done || {})[k];
      if (s.kind === "review") {
        const left = p.zt - p.ztOk;
        return `<li><a class="sec-row zf${done ? " done" : ""}" href="#/math/sec/${meta.id}/${s.id}">
          <span class="lb">总复习</span><span class="tt">${esc(s.title)}</span>
          <span class="mt">学完各节再做 · 综合题 ${s.qs} 道${s.minutes ? ` · 约 ${s.minutes} 分钟` : ""}${left ? ` · 还有 ${left} 道真题没做对` : ""}</span>
          <span class="ck">${done ? "✓ 做完" : ""}</span></a></li>`;
      }
      const ok = s.zt.filter(z => { const a = lastOf(`${meta.id}/${z}`); return a && a[1]; }).length;
      const bad = s.zt.filter(z => { const w = reviewOf(`${meta.id}/${z}`); return w && w.state === "active"; }).length;
      const isLast = S.last && S.last.book === meta.id && S.last.sec === s.id;
      return `<li><a class="sec-row${done ? " done" : ""}" href="#/math/sec/${meta.id}/${s.id}">
        <span class="lb">${esc(s.label)}</span><span class="tt">${esc(s.title)}</span>
        <span class="mt">${s.zt.length ? `真题 ${s.zt.length} 道 · ${s.score} 分` : "无单独真题"}${s.minutes ? ` · 约 ${s.minutes} 分钟` : ""}${isLast ? " · 上次读到这" : ""}</span>
        <span class="ck">${done ? "✓ 学完" : s.zt.length ? `${ok}/${s.zt.length}${bad ? ` <i>错 ${bad}</i>` : ""}` : ""}</span></a></li>`;
    }).join("");
    html += `</ol></div>`;
    K.render(html, true);
  }

  /* ───── 读一节 ───── */
  let secCur = null, atT = null, io = null;
  async function secPage(arg) {
    K.setTone(TONE);
    const [bid, sid, at] = arg.split("/");
    let book;
    try { book = await getBook(bid); } catch (e) { K.setBar(K.backBar("讲义", "#/math")); K.render(`<p class="placeholder">${esc(e.message)}</p>`); return; }
    if (K.cur.page !== "sec" || !K.cur.arg.startsWith(bid + "/" + sid)) return;
    const idx = book.sections.findIndex(s => s.id === sid);
    const sec = book.sections[idx];
    if (!sec) { K.go(`#/math/book/${bid}`); return; }
    secCur = { book: bid, sec: sid };
    numberQs(sec);
    K.setBar(K.backBar(`${book.科目}${book.讲} · ${sec.label}`, `#/math/book/${bid}`,
      `<button class="ib" data-act="m:outline" aria-label="本节目录" title="本节目录">${ICON.list}</button>`));
    const ctx = { book: bid, sec: sid };
    const review = sec.kind === "review";
    const zts = sec.blocks.filter(b => b.t === "q" && b.kind === "真题");
    const ok = zts.filter(q => { const a = lastOf(`${bid}/${q.id}`); return a && a[1]; }).length;
    let body = review ? reviewBody(book, sec, ctx) : "";
    // 连在一起的诊断题包成「先测一下」
    for (let i = 0; i < (review ? 0 : sec.blocks.length); i++) {
      const b = sec.blocks[i];
      if (b.t === "q" && b.kind === "诊断") {
        const group = [];
        while (i < sec.blocks.length && sec.blocks[i].t === "q" && sec.blocks[i].kind === "诊断") group.push(sec.blocks[i++]);
        i--;
        body += `<div class="diag" data-at="diag"><div class="dh"><b>先测一下</b><span class="mute">${group.length} 题，几分钟。都做对就可以跳过讲解，直接去做真题。</span></div>
          ${group.map(q => problem(q, ctx)).join("")}<div class="dfoot" hidden></div></div>`;
        continue;
      }
      body += block(b, ctx);
    }
    const done = (S.done || {})[`${bid}/${sid}`];
    const prev = book.sections[idx - 1], next = book.sections[idx + 1];
    const doneTxt = review ? ["✓ 总复习做完了", "总复习做完了"] : ["✓ 本节学完了", "这一节学完了"];
    const smeta = review
      ? `学完各节以后做 · 综合题 ${sec.blocks.filter(b => b.t === "q").length} 道${sec.minutes ? ` · 约 ${sec.minutes} 分钟` : ""}`
      : `${zts.length ? `真题 ${zts.length} 道 · ${zts.reduce((a, q) => a + (q.src.score || 0), 0)} 分 · 做对 ${ok}/${zts.length}` : "本节没有单独成题的真题"}${sec.minutes ? ` · 约 ${sec.minutes} 分钟` : ""}`;
    K.render(`<article class="mlec${review ? " zf" : ""}" data-book="${esc(bid)}" data-sec="${esc(sid)}">
      <header class="sh"><div class="crumb">${esc(book.科目)}第${esc(book.讲)}讲 · ${esc(book.名称)}</div>
        <h1>${review ? "" : `<span class="lb">${esc(sec.label)}</span>`}${esc(review ? "总复习" : sec.title)}</h1>
        <div class="smeta">${smeta}</div>
        <button class="link mpack" data-act="m:pack">复制学习包（整节讲义 + 我的作答，粘贴给 GPT）</button></header>
      ${body}
      <footer class="sf">
        <button class="btn${done ? "" : " primary"}" data-act="m:secdone" data-txt="${esc(doneTxt.join("|"))}">${done ? doneTxt[0] : doneTxt[1]}</button>
        <button class="link mpack" data-act="m:pack">复制学习包，粘贴给 GPT 带着学</button>
        <div class="nav">${prev ? `<a class="link" href="#/math/sec/${bid}/${prev.id}">← ${esc(prev.label)}</a>` : "<span></span>"}
        ${next ? `<a class="btn" href="#/math/sec/${bid}/${next.id}">${next.kind === "review" ? "本讲总复习" : `${esc(next.label)} ${esc(next.title)}`} →</a>` : `<a class="btn" href="#/math/book/${bid}">回目录</a>`}</div>
      </footer></article>`, true);
    hydrate($("#view"));
    fitMath();
    updateDiag();
    prefetchFormulaBooks(sec);
    if (at) { const el = document.getElementById(at); if (el) { el.scrollIntoView({ block: "start" }); window.scrollBy(0, -70); } }
    watchPosition(bid, sid);
    if (!(S.last && S.last.book === bid && S.last.sec === sid)) saveLast(bid, sid, "");
  }
  function saveLast(book, sec, at) {
    S.last = { book, sec, at };
    keepLocal();
    K.send("/api/math/last", S.last, "math-last").catch(() => {});
  }
  function watchPosition(bid, sid) {
    if (io) io.disconnect();
    if (!("IntersectionObserver" in window)) return;
    const seen = new Map();
    io = new IntersectionObserver(es => {
      es.forEach(e => seen.set(e.target, e.isIntersecting ? e.boundingClientRect.top : null));
      clearTimeout(atT);
      atT = setTimeout(() => {
        let best = null, top = Infinity;
        seen.forEach((t, el) => { if (t != null && t < top && el.isConnected) { top = t; best = el; } });
        if (best && secCur && secCur.book === bid && secCur.sec === sid) saveLast(bid, sid, best.dataset.at || "");
      }, 1500);
    }, { rootMargin: "-60px 0px -50% 0px" });
    $$("#view [data-at]").forEach(el => io.observe(el));
    K.onLeave = () => { if (io) io.disconnect(); io = null; clearTimeout(atT); };
  }
  function updateDiag() {
    $$("#view .diag").forEach(d => {
      const qs = $$(".mq", d), res = qs.map(q => (QS[q.dataset.item] || {}).res);
      const foot = $(".dfoot", d);
      if (res.some(r => !r)) { foot.hidden = true; return; }
      foot.hidden = false;
      const firstZt = $("#view .mq .qtag.zt");
      foot.innerHTML = res.every(r => r === "ok")
        ? `<span class="ev out">都做对了。</span>${firstZt ? `<button class="btn small primary" data-act="m:jump" data-to="${firstZt.closest(".mq").id}">直接去做真题 ↓</button>` : ""}<span class="mute">也可以往下快速翻一遍讲解。</span>`
        : `<span class="ev in">有没做对的，从下面的讲解开始，这一块别跳。</span>`;
    });
  }

  /* ───── 总复习：方法地图 → 反应卡 → 混合自测 → 没做对的真题 → 易错 → 留整卷 ───── */
  function ztNotOk(book) {
    const out = [];
    book.sections.filter(s => s.kind !== "review").forEach(s => s.blocks.forEach(b => {
      if (b.t !== "q" || b.kind !== "真题") return;
      const it = `${book.id}/${b.id}`, a = lastOf(it), w = reviewOf(it);
      const inBook = w && (w.state === "active" || w.state === "probation");
      if (!a || !a[1] || inBook) out.push({ q: b, s, st: inBook ? "错题本" : a ? "上次没做对" : "还没做" });
    }));
    return out;
  }
  function reviewBody(book, sec, ctx) {
    const normal = book.sections.filter(s => s.kind !== "review");
    const n = { i: 0 };
    const head = (id, t) => `<h3 class="mh" id="${id}" data-at="${id}"><span class="zn">${"一二三四五六七"[n.i++]}</span>${t}</h3>`;
    let h = blocks(sec.blocks.filter(b => b.t !== "q" && b.t !== "cards"), ctx);
    h += head("zf-map", "每节的方法：先自己说，再点开对照") +
      `<p class="zhint">对着节名，说出这类题怎么认、第一步做什么。说不出来的那一节，回去把方法框和例题再看一遍。</p><div class="zmap">` +
      normal.map(s => {
        const rc = s.blocks.find(b => b.t === "recap");
        return `<details class="zrow"><summary><span class="lb">${esc(s.label)}</span><span class="tt">${esc(s.title)}</span></summary>
          <div class="zbody">${rc ? blocks(rc.body, { book: book.id, sec: s.id }) : `<p class="faint">这一节没有写收口。</p>`}
          <a class="link" href="#/math/sec/${esc(book.id)}/${esc(s.id)}">回到${esc(s.label)} →</a></div></details>`;
      }).join("") + `</div>`;
    const cards = sec.blocks.filter(b => b.t === "cards").flatMap(b => b.items);
    if (cards.length) h += head("zf-cards", "看到这个，第一步做什么") + `<p class="zhint">${cards.length} 张。先说出右边，再点开。考场上就是靠这一下反应。</p>` + cardsHtml(cards, ctx);
    const qs = sec.blocks.filter(b => b.t === "q");
    if (qs.length) h += head("zf-mix", "混合自测：不告诉你考哪一节") +
      `<p class="zhint">${qs.length} 道，像考试一样做：先判断用哪一节的方法，再动笔。做完才显示它考的是哪一节。</p>` + qs.map(q => problem(q, ctx)).join("");
    const pend = ztNotOk(book), bad = pend.filter(x => x.st !== "还没做"), fresh = pend.filter(x => x.st === "还没做");
    const zrow = ({ q, s, st }) => `<a class="litem" href="#/math/q/${esc(book.id)}/${esc(q.id)}/zf"><span class="t">${q.src.year} 第${q.src.no}题 <small>${esc(q.type || "")}${q.src.score ? ` · ${q.src.score} 分` : ""}</small></span>
      <span class="m">${esc(s.label)} ${esc(s.title)}${st === "还没做" ? "" : ` · <i class="bad">${st}</i>`}</span></a>`;
    h += head("zf-zt", "本讲真题：还没做对的");
    if (!pend.length) h += `<p class="zhint ok">本讲 2010–2019 年的真题都做对过了 ✓</p>`;
    if (bad.length) h += `<p class="zhint">做错过、还没改对的 ${bad.length} 道。一道接一道重做，做对了就从这里消失。</p><div class="zlist">${bad.map(zrow).join("")}</div>`;
    if (fresh.length) h += `<details class="zfresh"${bad.length ? "" : " open"}><summary>还没做过的 ${fresh.length} 道${bad.length ? "" : "（先回各节做，或者在这里直接做）"}</summary><div class="zlist">${fresh.map(zrow).join("")}</div></details>`;
    const traps = normal.map(s => ({ s, boxes: s.blocks.filter(b => b.t === "box" && b.label === "易错") })).filter(x => x.boxes.length);
    if (traps.length) h += head("zf-trap", "易错汇总") + `<details class="ztraps"><summary>${traps.length} 节的易错点，考前过一遍</summary>${traps.map(({ s, boxes }) =>
      `<div class="ztrap"><div class="zt-h">${esc(s.label)} ${esc(s.title)}</div>${boxes.map(b => blocks(b.body, { book: book.id, sec: s.id })).join("")}</div>`).join("")}</details>`;
    const later = normal.flatMap(s => s.blocks.filter(b => b.t === "later").map(b => ({ s, b })));
    if (later.length) h += head("zf-later", "2020 年以后的真题：留给 11 月做整卷") +
      `<ul class="zlater">${later.map(({ s, b }) => `<li><span class="lb">${esc(s.label)}</span>${inl(b.text.replace(/^2020 年以后本节(还)?考过：/, ""), ctx)}</li>`).join("")}</ul>`;
    return h;
  }

  /* 图：y = 表达式、参数曲线、点、竖线 —— 画成 SVG，跟着日间夜间变色 */
  function hydrate(root) {
    $$("figure.plot", root).forEach(fig => { try { fig.innerHTML = plot(fig.dataset.spec, JSON.parse(fig.dataset.lines || "[]")); } catch (e) { fig.innerHTML = `<figcaption class="faint">图没画出来：${esc(e.message)}</figcaption>`; } });
  }
  function compile(expr) {
    const src = expr.replace(/\^/g, "**").replace(/\bln\b/g, "log").replace(/\bpi\b/g, "PI").replace(/(\d)\s*([a-zA-Z(])/g, "$1*$2");
    // eslint-disable-next-line no-new-func
    return new Function("x", "t", `const {sin,cos,tan,asin,acos,atan,exp,log,sqrt,abs,PI,cbrt,sinh,cosh,sign}=Math;const e=Math.E;return (${src});`);
  }
  function plot(spec, lines) {
    const rng = k => { const m = spec.match(new RegExp(k + "\\s*=\\s*(-?[\\d.]+)\\s*\\.\\.\\s*(-?[\\d.]+)")); return m ? [+m[1], +m[2]] : null; };
    const [x0, x1] = rng("x") || [-3, 3], [y0, y1] = rng("y") || [-3, 3];
    const W = 560, H = Math.round(W * Math.min(0.75, Math.max(0.42, (y1 - y0) / (x1 - x0) * 0.75)));
    const X = x => (x - x0) / (x1 - x0) * W, Y = y => H - (y - y0) / (y1 - y0) * H;
    let svg = "", labels = "";
    const tick = (a, b) => { const span = b - a, step = span <= 8 ? 1 : span <= 20 ? 2 : 5; const out = []; for (let v = Math.ceil(a / step) * step; v <= b; v += step) out.push(v); return out; };
    if (y0 < 0 && y1 > 0) svg += `<line class="ax" x1="0" y1="${Y(0)}" x2="${W}" y2="${Y(0)}"/>`;
    if (x0 < 0 && x1 > 0) svg += `<line class="ax" x1="${X(0)}" y1="0" x2="${X(0)}" y2="${H}"/>`;
    tick(x0, x1).forEach(v => { if (v) labels += `<text class="tk" x="${X(v)}" y="${Math.min(H - 4, Math.max(12, Y(0) + 14))}" text-anchor="middle">${v}</text>`; });
    tick(y0, y1).forEach(v => { if (v) labels += `<text class="tk" x="${Math.min(W - 4, Math.max(14, X(0) - 6))}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`; });
    let series = 0;
    for (const raw of lines) {
      const [main, ...opts] = raw.split("|").map(s => s.trim());
      const dash = opts.includes("虚线"), label = opts.find(o => o !== "虚线") || "";
      const cls = dash ? "c dash" : `c s${series++ % 3}`;
      let m;
      if ((m = main.match(/^点\s*([^,，]+)[,，]\s*([^\s]+)\s*(.*)$/))) {
        const px = compile(m[1])(0), py = compile(m[2])(0);
        svg += `<circle class="pt" cx="${X(px)}" cy="${Y(py)}" r="4.5"/>`;
        if (m[3]) labels += `<text class="pl" x="${X(px) + 7}" y="${Y(py) - 7}">${esc(m[3])}</text>`;
        continue;
      }
      if ((m = main.match(/^竖线\s*x\s*=\s*(.+)$/))) {
        const vx = compile(m[1])(0);
        svg += `<line class="c dash" x1="${X(vx)}" y1="0" x2="${X(vx)}" y2="${H}"/>`;
        if (label) labels += `<text class="pl" x="${X(vx) + 5}" y="14">${esc(label)}</text>`;
        continue;
      }
      let pts = [];
      if ((m = main.match(/^参数\s*t\s*=\s*([^.]+)\.\.([^:：]+)[:：]\s*x\s*=\s*([^;；]+)[;；]\s*y\s*=\s*(.+)$/))) {
        const ta = compile(m[1])(0), tb = compile(m[2])(0), fx = compile(m[3]), fy = compile(m[4]);
        for (let i = 0; i <= 400; i++) { const t = ta + (tb - ta) * i / 400; pts.push([fx(0, t), fy(0, t)]); }
      } else if ((m = main.match(/^y\s*=\s*(.+)$/))) {
        const f = compile(m[1]);
        for (let i = 0; i <= 600; i++) { const x = x0 + (x1 - x0) * i / 600; pts.push([x, f(x, 0)]); }
      } else continue;
      let d = "", pen = false;
      const lim = (y1 - y0) * 3;
      pts.forEach(([x, y], i) => {
        const okp = Number.isFinite(x) && Number.isFinite(y) && y > y0 - lim && y < y1 + lim;
        const prev = pts[i - 1];
        const jump = prev && Number.isFinite(prev[1]) && Math.abs(y - prev[1]) > (y1 - y0) * 1.5;
        if (!okp || jump) { pen = false; if (!okp) return; }
        d += (pen ? "L" : "M") + X(x).toFixed(1) + " " + Y(y).toFixed(1);
        pen = true;
      });
      svg += `<path class="${cls}" d="${d}"/>`;
      if (label) {
        const vis = pts.filter(([x, y]) => Number.isFinite(y) && y >= y0 && y <= y1);
        const lp = vis[Math.floor(vis.length * 0.86)] || vis[vis.length - 1];
        if (lp) labels += `<text class="pl ${cls}" x="${Math.min(W - 6, X(lp[0]) + 4)}" y="${Math.max(14, Y(lp[1]) - 8)}" text-anchor="end">${esc(label)}</text>`;
      }
    }
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img"><defs><clipPath id="cp"><rect width="${W}" height="${H}"/></clipPath></defs><g clip-path="url(#cp)">${svg}</g>${labels}</svg>`;
  }

  /* ───── 做题的动作 ───── */
  function qOf(el) {
    const sec = el.closest(".mq"), item = sec.dataset.item;
    const [bid, qid] = item.split("/");
    const book = BOOK[bid];
    let q = null;
    if (book) for (const s of book.sections) { q = s.blocks.find(b => b.t === "q" && b.id === qid); if (q) break; }
    return { sec, item, q, book: bid };
  }
  function redraw(el) {
    const { sec, q, book, item } = qOf(el);
    if (!q) return;
    const ctx = { book, sec: secCur ? secCur.sec : "" };
    sec.outerHTML = problem(q, ctx);
    const fresh = $(`#view .mq[data-item="${CSS.escape(item)}"]`);
    if (fresh) { hydrate(fresh); fitMath(fresh); }
    updateDiag();
    return fresh;
  }
  function modeOf(q) { return q.kind === "真题" ? "zt" : q.kind === "诊断" ? "zd" : "lx"; }
  async function submit(el, correct, choice) {
    const { q, item } = qOf(el);
    const st = QS[item] = QS[item] || {};
    const hints = st.hints || 0, peek = !!st.solFirst;
    st.res = correct ? "ok" : "bad"; st.choice = choice; st.hintsUsed = hints;
    st.unsure = q.kind === "真题" && correct && (hints >= 2 || peek);
    redraw(el);
    try {
      const r = await K.send("/api/math/answer", { item, correct, hints, sol: peek, choice: choice || "", mode: modeOf(q) });
      st.aid = r.id; st.event = r.event; st.unsure = r.unsure;
      if (r.review) S.review[item] = r.review; else delete S.review[item];
      S.answers[item] = [choice || "", correct ? 1 : 0, "", ((S.answers[item] || [])[3] || 0) + 1, (S.answers[item] || [])[4] || S.today];
      keepLocal();
      const fresh = $(`#view .mq[data-item="${CSS.escape(item)}"]`);
      if (fresh) redraw(fresh);
    } catch (e) { K.toast(e.message); }
  }
  function plainBlocks(arr) {
    return (arr || []).map(b => {
      if (b.t === "p" || b.t === "goal" || b.t === "later") return b.text;
      if (b.t === "h") return b.text;
      if (b.t === "math") return `$$${b.tex}$$`;
      if (b.t === "ul" || b.t === "ol") return b.items.map((x, i) => (b.t === "ol" ? `${i + 1}. ` : "- ") + x).join("\n");
      if (b.t === "table") return b.rows.map(r => r.join(" | ")).join("\n");
      if (b.t === "box" || b.t === "recap") return plainBlocks(b.body);
      return "";
    }).filter(Boolean).join("\n");
  }
  /* 「问 GPT」复制的内容：题目 + 我这次的作答和看过的提示 + 参考解答，GPT 一看就知道卡在哪 */
  function gptText(q, book, item) {
    const meta = (S.books || []).find(b => b.id === book);
    const opts = Object.entries(q.options || {}).map(([k, v]) => `${k}. ${v}`).join("\n");
    const st = QS[item] || {}, hints = st.hints || 0, last = (S.answers || {})[item];
    const mine = [];
    if (st.res) mine.push(st.choice ? `选了 ${st.choice}（${st.res === "ok" ? "对" : "错"}）` : st.res === "ok" ? "对完答案，自己判做对了" : "对完答案，自己判没做对");
    else mine.push("对过答案，还没判对错");
    if (!st.res && last) mine.push(`上次${last[0] ? `选了 ${last[0]}，` : ""}${last[1] ? "做对了" : "没做对"}`);
    mine.push(hints ? `看了 ${hints} 层提示` : "没看提示");
    if (st.solFirst) mine.push("先看了解答");
    const seen = (q.hints || []).slice(0, hints).map((h, i) => `${i + 1}. ${plainBlocks(h)}`).join("\n");
    return `请当我的考研数学（数二）老师。下面这道题我卡住了：先问我卡在哪一步，再一步一步讲清楚为什么这样做，讲完再出一道同类题让我做。\n\n` +
      `【出处】${meta ? `${meta.科目}第${meta.讲}讲 ${meta.名称}` : ""} · ${q.kind === "真题" ? `${q.src.year} 年数二第 ${q.src.no} 题` : q.kind}\n` +
      `【题目】\n${plainBlocks(q.q)}${opts ? "\n" + opts : ""}\n\n` +
      `【我的情况】${mine.join("；")}\n${seen ? `【我看过的提示】\n${seen}\n` : ""}\n` +
      `【参考答案】${q.answer || ""}\n${(q.idea || []).length ? `【思路】${plainBlocks(q.idea)}\n` : ""}【参考解答】\n${plainBlocks(q.sol)}\n\n【我卡在】（在这里写）`;
  }

  /* ───── 复制学习包：整节讲义转成 Markdown（公式保留 $…$）+ 我在这一节的作答，粘贴给 GPT 就能按这一节带着学 ───── */
  function fbookOf(name) { return (S.books || []).find(x => x.类型 === "公式本" && x.简称 === name); }
  function mdInl(s, refs) {
    return String(s || "").replace(/\[\[([^\]]+)\]\]/g, (_, body) => {
      const [target, text] = body.split("|");
      const fm = target.match(/^([^:：]+)[:：](.+)$/);
      if (!fm) return text || target;                     // [[节3]]
      const name = fm[1].trim(), fid = fm[2].trim(), fb = fbookOf(name);
      if (refs) refs.add(`${name}:${fid}`);
      const f = fb && BOOK[fb.id] && allFormulas(BOOK[fb.id]).find(x => x.id === fid);
      return text || (f && f.name) || fid;                // 公式本身附在学习包最后
    });
  }
  function qLabel(q) {
    if (q.kind === "真题") return `真题 ${q.src.year}-${q.src.no}`;
    if (q.id.startsWith("zf-")) return `综合题 ${q.id}`;
    return `${q.kind} ${q.id}`;
  }
  function mdQ(q, refs) {
    const meta = [q.type, q.src && q.src.score ? `${q.src.score} 分` : ""].filter(Boolean).join("，");
    const L = [`#### ${qLabel(q)}${meta ? `（${meta}）` : ""}`, mdBlocks(q.q, refs)];
    const opts = Object.entries(q.options || {});
    if (opts.length) L.push(opts.map(([k, v]) => `${k}. ${mdInl(v, refs)}`).join("\n"));
    (q.hints || []).forEach((h, i) => L.push(`提示 ${i + 1}：${mdBlocks(h, refs)}`));
    if (q.answer) L.push(`答案：${mdInl(q.answer, refs)}`);
    if ((q.idea || []).length) L.push(`思路：${mdBlocks(q.idea, refs)}`);
    if ((q.sol || []).length) L.push(`解答：\n${mdBlocks(q.sol, refs)}`);
    if ((q.note || []).length) L.push(`点评：${mdBlocks(q.note, refs)}`);
    return L.filter(Boolean).join("\n");
  }
  function mdBlocks(arr, refs) {
    return (arr || []).map(b => {
      switch (b.t) {
        case "p": return mdInl(b.text, refs);
        case "h": return `### ${mdInl(b.text, refs)}`;
        case "goal": return `> ${mdInl(b.text, refs)}`;
        case "later": return `留整卷：${mdInl(b.text, refs)}`;
        case "math": return `$$\n${b.tex}\n$$`;
        case "ul": case "ol": return b.items.map((x, i) => (b.t === "ol" ? `${i + 1}. ` : "- ") + mdInl(x, refs)).join("\n");
        case "table": return b.rows.map((r, i) => `| ${r.map(c => mdInl(c, refs)).join(" | ")} |` + (i ? "" : `\n|${r.map(() => " --- |").join("")}`)).join("\n");
        case "box": return `**【${b.label}】${b.title ? mdInl(b.title, refs) : ""}**\n${mdBlocks(b.body, refs)}`;
        case "recap": return `**【收口】**\n${mdBlocks(b.body, refs)}`;
        case "ex": return [`**【例题】${b.title ? mdInl(b.title, refs) : ""}**`, mdBlocks(b.q, refs),
          ...b.steps.map((s, i) => `第 ${i + 1} 步：${mdBlocks(s, refs)}`)].filter(Boolean).join("\n");
        case "q": return mdQ(b, refs);
        case "plot": return `（图：${b.lines.map(l => { const [main, ...o] = l.split("|").map(x => x.trim()); return o.filter(x => x !== "虚线")[0] || main; }).join("；")}）`;
        case "cards": return `**【反应卡】**\n${b.items.map(c => `- ${mdInl(c[0], refs)} → ${mdInl(c[1], refs)}`).join("\n")}`;
        case "f": return `- ${mdInl(b.name, refs)}：$${String(b.tex).split("\n").join("$；$")}$`;
        default: return "";
      }
    }).filter(Boolean).join("\n\n");
  }
  function mdAnswers(bid, qs) {
    const rows = qs.map(q => {
      const item = `${bid}/${q.id}`, a = lastOf(item), w = reviewOf(item);
      if (!a) return "";
      const flags = String(a[2] || ""), h = flags.match(/h(\d)/);
      const parts = [`最近一次${a[1] && !flags.includes("unsure") ? "做对" : a[1] ? "做对（看了第 2 层提示或解答，不算独立做对）" : "没做对"}`, `共做了 ${a[3] || 1} 次`];
      if (a[0]) parts.push(`最近一次选了 ${a[0]}`);
      if (h) parts.push(`最近一次看了 ${h[1]} 层提示`);
      if (flags.includes("sol")) parts.push("先看了解答");
      if (w && (w.state === "active" || w.state === "probation")) parts.push(w.state === "probation" ? "在错题本的抽查期" : "在错题本里");
      return `- ${qLabel(q)}：${parts.join("，")}`;
    }).filter(Boolean);
    return rows.length ? rows.join("\n") : "还没做题";
  }
  function packText(bid, sid) {
    const book = BOOK[bid], sec = book && book.sections.find(s => s.id === sid);
    if (!sec) return "";
    const refs = new Set();
    const review = sec.kind === "review";
    let body = mdBlocks(sec.blocks, refs);
    if (review) {
      body += "\n\n### 各节收口\n" + book.sections.filter(s => s.kind !== "review").map(s => {
        const rc = s.blocks.find(b => b.t === "recap");
        return `**${s.label} ${s.title}**：${rc ? mdBlocks(rc.body, refs) : "（没写收口）"}`;
      }).join("\n");
    }
    let mine = mdAnswers(bid, sec.blocks.filter(b => b.t === "q"));
    if (review) {
      const pend = ztNotOk(book);
      if (pend.length) mine += `\n\n本讲 2010–2019 年真题还没做对的：${pend.map(x => `${x.q.src.year}-${x.q.src.no}（${x.st}）`).join("、")}`;
    }
    const fs = [...refs].map(r => {
      const [name, fid] = r.split(":"), fb = fbookOf(name);
      const f = fb && BOOK[fb.id] && allFormulas(BOOK[fb.id]).find(x => x.id === fid);
      return f ? `- ${mdInl(f.name)}：$${String(f.tex).split("\n").join("$；$")}$${f.note ? `（${mdInl(f.note)}）` : ""}` : "";
    }).filter(Boolean);
    return `【数学学习包 v1】${book.科目}第${book.讲}讲 · ${review ? "总复习" : `${sec.label} ${sec.title}`}\n` +
      `下面是我正在学的一节讲义和我在这一节的作答情况。请按这节讲义带我学：\n` +
      `① 先问我卡在哪，从卡点讲起，讲细，多用具体数字的小例子；\n` +
      `② 讲完出 1–2 道同类题让我做，我做完你再讲评；\n` +
      `③ 包里有题目的答案和解析，我没要之前不要直接给，按提示一层一层来；\n` +
      `④ 不要读取或写入 Notion；我说「同步」时，再按项目说明把这节课暴露的薄弱点写进 Notion。\n\n` +
      `## 讲义正文\n\n${body}\n\n` +
      (fs.length ? `## 这一节用到的公式（公式本）\n\n${fs.join("\n")}\n\n` : "") +
      `## 我在这一节的作答\n\n${mine}\n`;
  }
  // 公式本先在后台读好：点「复制学习包」时要同步拼出文字（等网络会丢掉点击，平板上复制会失败）
  function prefetchFormulaBooks(sec) {
    const names = new Set();
    JSON.stringify(sec.blocks).replace(/\[\[([^\]|:：]+)[:：]/g, (_, n) => names.add(n.trim()));
    names.forEach(n => { const fb = fbookOf(n); if (fb) getBook(fb.id).catch(() => {}); });
  }

  K.acts({
    "m:pack": el => {
      if (!secCur) return;
      K.copyText(packText(secCur.book, secCur.sec)).then(ok => K.toast(ok ? "学习包复制好了，粘贴给 GPT" : "没复制上，再点一次试试"));
    },
    "m:step": el => {
      const ex = document.getElementById(el.dataset.ex), n = +ex.dataset.n;
      let shown = +ex.dataset.shown;
      const step = $(`.step[data-i="${shown}"]`, ex);
      if (step) { step.hidden = false; shown++; ex.dataset.shown = shown; fitMath(step); }
      el.textContent = shown >= n ? "看完了" : `下一步（${shown}/${n}）`;
      if (shown >= n) { el.disabled = true; const all = $('[data-act="m:allsteps"]', ex); if (all) all.remove(); }
    },
    "m:allsteps": el => {
      const ex = document.getElementById(el.dataset.ex);
      $$(".step", ex).forEach(s => (s.hidden = false));
      ex.dataset.shown = ex.dataset.n;
      $(".exacts", ex).remove();
      fitMath(ex);
    },
    "m:hint": el => { const { item } = qOf(el); const st = QS[item] = QS[item] || {}; st.hints = (st.hints || 0) + 1; redraw(el); },
    "m:check": el => {
      const { item } = qOf(el); const st = QS[item] = QS[item] || {};
      st.open = true;
      const fresh = redraw(el);
      if (fresh) { const ans = $(".mans", fresh); if (ans) ans.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
    },
    "m:mark": el => submit(el, el.dataset.v === "1"),
    "m:opt": el => { const { q } = qOf(el); submit(el, el.dataset.k === q.answer, el.dataset.k); },
    "m:redo": el => { const { item } = qOf(el); delete QS[item]; redraw(el); },
    "m:undo": async el => {
      const { item } = qOf(el); const st = QS[item];
      if (!st || !st.aid) return;
      try {
        const r = await K.post("/api/math/undo", { id: st.aid });
        if (r.review) S.review[item] = r.review; else delete S.review[item];
        delete QS[item];
        const s2 = await K.get("/api/math/state"); S.answers = s2.answers; S.review = s2.review;
        redraw(el); K.toast("撤销了，这题重新做");
      } catch (e) { K.toast(e.message); }
    },
    "m:gpt": async el => {
      const { q, book, item } = qOf(el);
      const ok = await K.copyText(gptText(q, book, item));
      K.toast(ok ? "已复制题目、你的作答和看过的提示，去 ChatGPT 粘贴，补一句卡在哪" : "没复制上，手动选中题目复制");
    },
    "m:jump": el => { const t = document.getElementById(el.dataset.to); if (t) { t.scrollIntoView({ block: "start", behavior: "smooth" }); } },
    "m:secdone": async el => {
      if (!secCur) return;
      const k = `${secCur.book}/${secCur.sec}`, now = !(S.done || {})[k];
      try {
        const r = await K.post("/api/math/sec", { book: secCur.book, sec: secCur.sec, done: now });
        if (K.STATIC) { S.done = { ...(S.done || {}) }; if (now) S.done[k] = 1; else delete S.done[k]; keepLocal(); }
        else S.done = r.done;
        const txt = (el.dataset.txt || "✓ 本节学完了|这一节学完了").split("|");
        el.className = "btn" + (now ? "" : " primary");
        el.textContent = now ? txt[0] : txt[1];
        if (now) K.toast(secCur.sec === "zf" ? "记下了：总复习做完" : "记下了：这一节学完");
      } catch (e) { K.toast(e.message); }
    },
    "m:outline": () => {
      const view = $("#view");
      const rows = [];
      $$("[data-at]", view).forEach(el => {
        let t = "";
        if (el.classList.contains("mh")) t = `<span class="o-h">${el.innerHTML}</span>`;
        else if (el.classList.contains("ex")) t = `<span class="o-ex">例题</span>`;
        else if (el.classList.contains("diag")) t = `<span class="o-ex">先测一下</span>`;
        else if (el.classList.contains("mq")) { const tag = $(".qtag", el).textContent; const st = $(".qst", el); t = `<span class="o-q">${esc(tag)}</span>${st ? st.outerHTML : ""}`; if ($(".diag", view) && el.closest(".diag")) return; }
        else if (el.id === "recap") t = `<span class="o-ex">收口</span>`;
        if (t) rows.push(`<button class="mrow" data-act="m:goto" data-to="${el.id}">${t}</button>`);
      });
      K.openSheet(`<h3>本节目录</h3><div class="menu outline">${rows.join("")}</div>`);
    },
    "m:goto": el => { K.closeSheet(); const t = document.getElementById(el.dataset.to); if (t) { t.scrollIntoView({ block: "start" }); window.scrollBy(0, -66); } },
    "m:fpop": async el => {
      const bid = el.dataset.book, fid = el.dataset.fid;
      let fb;
      try { fb = await getBook(bid); } catch (e) { K.toast(e.message); return; }
      const f = allFormulas(fb).find(x => x.id === fid);
      if (!f) { K.toast("公式本里没有这条"); return; }
      K.openSheet(`<h3>${esc(fb.名称)}</h3><div class="fsheet">${frow(f, fb, false, true)}</div>
        <div class="acts"><a class="btn" href="#/math/f/${bid}/${fid}" data-act="k:go" data-to="#/math/f/${bid}/${fid}">在公式本里看</a><button class="btn primary" data-act="k:close">接着看讲义</button></div>`);
    },
    // 公式本
    "m:fmode": el => { fmode = el.dataset.v; K.store.set("xuexi-math-fmode", fmode); fRender(); },
    "m:fflip": el => { if (fmode === "背") el.closest(".frow").classList.toggle("shown"); },
    "m:fnotes": el => { const row = el.closest(".frow"); row.classList.toggle("notes"); el.textContent = row.classList.contains("notes") ? "收起" : "记法"; },
    "m:zflip": el => el.classList.toggle("open"),
    "m:frate": async el => {
      const row = el.closest(".frow"), item = row.dataset.item, ok = el.dataset.v === "1";
      try {
        const r = await K.send("/api/math/answer", { item, correct: ok, mode: "card" });
        if (r.review) S.review[item] = r.review; else delete S.review[item];
        const ev = K.rules.event(r.event, r.review, false, "错题本");
        const msg = ok ? (ev && ev[0] ? ev[1].replace("做对", "记得").replace("错题本", "没记牢的") : "记得 ✓") : (K.STATIC ? "没记牢，多看几遍" : "没记牢，明天再背");
        $(".fr-res", row).innerHTML = `<span class="ev ${ok ? "out" : "in"}">${esc(msg)}</span>`;
        row.classList.add("rated");
        row.dataset.st = ok ? "" : "bad";
      } catch (e) { K.toast(e.message); }
    },
    "m:freset": () => {
      $$(".frow").forEach(r => { r.classList.remove("shown", "rated", "notes"); const res = $(".fr-res", r); if (res) res.innerHTML = ""; const nb = $('[data-act="m:fnotes"]', r); if (nb) nb.textContent = "记法"; });
      window.scrollTo(0, 0);
    },
  });

  /* ───── 公式本 ───── */
  let fmode = K.store.get("xuexi-math-fmode", "看");
  let fCur = null;
  function allFormulas(b) {
    const out = [];
    const take = arr => (arr || []).forEach(x => { if (x.t === "f") out.push(x); if (x.t === "box") take(x.body); });
    take(b.intro);
    b.sections.forEach(s => take(s.blocks));
    return out;
  }
  /* 一条公式。「看」：公式、记法、推论全摊开；「背」：盖板叠在公式上面，点开、再点盖回，整行高度不变。
     「式:」写了几行（续行），就分几行显示：并列的几条公式各占一行，不在中间乱断 */
  function frow(f, fb, mask, sheet) {
    const item = `${fb.id}/${f.id}`;
    const w = reviewOf(item), bad = w && (w.state === "active" || w.state === "probation");
    const used = (fb.used || {})[f.id] || [];
    const extra = (f.note ? `<p class="fn">${inl(f.note, {})}</p>` : "") + (f.cor ? `<p class="fn cor"><b>推论</b>${inl(f.cor, {})}</p>` : "") +
      (used.length ? `<p class="fn used"><b>讲义里用到</b>${used.map(u => `<a href="#/math/sec/${esc(u.book)}/${esc(u.sec)}">${esc(u.title)}</a>`).join("、")}</p>` : "");
    return `<div class="frow${sheet ? " sheet" : ""}" id="f-${esc(f.id)}" data-item="${esc(item)}" data-st="${bad ? "bad" : ""}">
      <div class="fr-main"><div class="fr-name"><span class="fr-nm">${inl(f.name || f.id, {})}</span>${!sheet && extra ? `<button class="link fr-nb" data-act="m:fnotes">记法</button>` : ""}</div>
        <div class="fr-body"${sheet ? "" : ' data-act="m:fflip"'}><div class="fr-tex">${String(f.tex).split("\n").filter(l => l.trim()).map(l => `<div class="fr-l">${tex("\\displaystyle " + l, false)}</div>`).join("")}</div><span class="fr-cover">先在纸上写出来，再点开</span></div>
        ${sheet ? "" : `<div class="fr-rate"><button class="btn small ok" data-act="m:frate" data-v="1">记得</button><button class="btn small bad" data-act="m:frate" data-v="0">没记住</button><span class="fr-res"></span></div>`}</div>
      ${extra ? `<div class="fr-extra">${extra}</div>` : ""}
    </div>`;
  }
  async function fPage(arg) {
    K.setTone(TONE);
    const [bid, fid] = (arg || "").split("/");
    let fb;
    try { fb = await getBook(bid); } catch (e) { K.setBar(K.backBar("公式本", "#/math")); K.render(`<p class="placeholder">${esc(e.message)}</p>`); return; }
    fCur = fb;
    K.setBar(K.backBar(fb.名称, "#/math"));
    fRender();
    if (fid) { const el = document.getElementById("f-" + fid); if (el) { el.classList.add("flash"); el.scrollIntoView({ block: "center" }); } }
  }
  function fRender() {
    const fb = fCur;
    if (!fb) return;
    const due = allFormulas(fb).filter(f => { const w = reviewOf(`${fb.id}/${f.id}`); return w && ["active", "probation"].includes(w.state) && w.due && w.due <= S.today; });
    let html = `<div class="fpage mode-${fmode === "背" ? "mem" : "see"}">
      <div class="fhead"><div class="seg" role="group"><button data-act="m:fmode" data-v="看" aria-pressed="${fmode === "看"}">看</button><button data-act="m:fmode" data-v="背" aria-pressed="${fmode === "背"}">背</button></div>
      <span class="mute">${fmode === "背" ? "先在纸上写出右边，再点开对照；再点一下盖回去" : "公式、记法、推论都摊开；要自测换到「背」"}</span></div>`;
    if (fmode === "背" && due.length) html += `<p class="fdue">今天该复习：${due.map(f => `<a href="#/math/f/${fb.id}/${f.id}">${inl(f.name, {})}</a>`).join("、")}</p>`;
    const ctx = { book: fb.id, fbook: fb };
    html += blocks(fb.intro, ctx);
    fb.sections.forEach(s => { html += `<h2 class="sec">${esc(s.title)}</h2>` + blocks(s.blocks, ctx); });
    if (fmode === "背") html += `<div class="acts" style="margin-top:18px"><button class="btn" data-act="m:freset">全部盖回去，再来一遍</button></div>`;
    html += `</div>`;
    K.render(html, true);
  }

  /* ───── 错题本、单独重做一道 ───── */
  function findQ(item) {
    const [bid, qid] = item.split("/");
    const b = BOOK[bid];
    if (!b) return null;
    for (const s of b.sections) { const q = s.blocks.find(x => x.t === "q" && x.id === qid); if (q) return { q, sec: s, book: b }; }
    return null;
  }
  async function wrongPage() {
    K.setTone(TONE);
    K.setBar(K.backBar("错题本", "#/math"));
    const rows = Object.entries(S.review || {}).filter(([, w]) => w.state === "active" || w.state === "probation");
    const books = [...new Set(rows.map(([k]) => k.split("/")[0]))];
    try { await Promise.all(books.map(getBook)); } catch (e) { /* 读不到的显示 id */ }
    const due = rows.filter(([, w]) => w.due && w.due <= S.today), later = rows.filter(([, w]) => !(w.due && w.due <= S.today));
    const row = ([k, w]) => {
      const f = findQ(k);
      const b = BOOK[k.split("/")[0]];
      if (b && b.类型 === "公式本") {
        const fm = allFormulas(b).find(x => x.id === k.split("/")[1]);
        return `<a class="litem" href="#/math/f/${b.id}/${k.split("/")[1]}"><span class="t">公式：${fm ? inl(fm.name, {}) : esc(k)}</span><span class="m">${esc(b.名称)} · 没记住 ${w.n} 次 · ${w.state === "probation" ? "抽查 " : ""}${K.dayLabel(w.due, S.today)}</span></a>`;
      }
      const title = f ? `${f.q.kind === "真题" ? `${f.q.src.year} 第${f.q.src.no}题` : f.q.kind}` : k;
      const where = f ? `${f.book.科目}${f.book.讲} · ${f.sec.label} ${f.sec.title}` : "";
      return `<a class="litem" href="#/math/q/${esc(k)}"><span class="t">${esc(title)}</span><span class="m">${esc(where)} · 错 ${w.n} 次 · ${w.state === "probation" ? "抽查 " : ""}${K.dayLabel(w.due, S.today)}</span></a>`;
    };
    let html = `<div class="m-wrong"><p class="mute">真题做错、或看了第 2 层提示才做出来的，都在这里；公式本里没记住的也在。隔天自己做对就移出，7 天后再抽查一次。</p>`;
    html += `<h2 class="sec">今天该重做 <small>${due.length}</small></h2>` + (due.length
      ? `<div class="qnext top"><a class="btn primary" href="${itemHref(due[0][0])}">从第一道开始，一道接一道 →</a></div>${due.map(row).join("")}`
      : `<p class="faint">今天没有到期的。</p>`);
    if (later.length) html += `<h2 class="sec">还没到时间 <small>${later.length}</small></h2>${later.map(row).join("")}`;
    K.render(html + `</div>`, true);
  }
  function dueList() {
    return Object.entries(S.review || {}).filter(([, w]) => (w.state === "active" || w.state === "probation") && w.due && w.due <= S.today).map(([k]) => k);
  }
  function itemHref(k, from) {
    const [bid, id] = k.split("/");
    const b = (S.books || []).find(x => x.id === bid);
    return b && b.类型 === "公式本" ? `#/math/f/${bid}/${id}` : `#/math/q/${k}${from ? "/" + from : ""}`;
  }
  async function qPage(arg) {
    K.setTone(TONE);
    const [bid, qid, from] = arg.split("/");
    const back = from === "zf" ? `#/math/sec/${bid}/zf` : "#/math/wrong";
    K.setBar(K.backBar(from === "zf" ? "总复习 · 重做真题" : "重做一题", back));
    try { await getBook(bid); } catch (e) { K.render(`<p class="placeholder">${esc(e.message)}</p>`); return; }
    const f = findQ(`${bid}/${qid}`);
    if (!f) { K.render(`<p class="placeholder">讲义里找不到这道题了（可能改过题号）。</p>`); return; }
    numberQs(f.sec);
    secCur = { book: bid, sec: f.sec.id };
    // 下一道：从错题本进来就按今天该重做的顺序；从总复习进来就是本讲还没做对的真题
    const me = `${bid}/${qid}`;
    const list = from === "zf" ? ztNotOk(BOOK[bid]).map(x => `${bid}/${x.q.id}`) : dueList();
    const at = list.indexOf(me), rest = list.filter(k => k !== me);
    const nextK = rest.length ? (at >= 0 && at < list.length - 1 ? list[at + 1] : rest[0]) : null;
    const nav = nextK
      ? `<div class="qnext"><a class="btn primary" href="${itemHref(nextK, from)}">下一道 →</a><span class="mute">${from === "zf" ? "本讲" : "今天"}还剩 ${rest.length} 道</span></div>`
      : `<div class="qnext"><a class="btn" href="${back}">${from === "zf" ? "回总复习" : "回错题本"}</a><span class="mute">${from === "zf" ? "这是本讲最后一道没做对的真题" : "这是今天最后一道"}</span></div>`;
    K.render(`<div class="mlec redo"><p class="crumb">${esc(f.book.科目)}第${esc(f.book.讲)}讲 · ${esc(f.sec.label)} ${esc(f.sec.title)} · <a href="#/math/sec/${bid}/${f.sec.id}/q-${esc(qid)}">回讲义里这一节</a></p>
      ${problem(f.q, { book: bid, sec: f.sec.id })}${nav}</div>`, true);
    hydrate($("#view"));
    fitMath();
  }

  // 讲义网站（K.STATIC）没有电脑记录：读到哪、学完哪节、做对没有，只记在这台设备上
  const LOCAL = "xuexi-math-local";
  function keepLocal() { if (K.STATIC) K.store.set(LOCAL, { answers: S.answers, done: S.done, last: S.last }); }
  async function init() {
    await loadKatex();
    S = await K.get("/api/math/state");
    if (K.STATIC) Object.assign(S, K.store.get(LOCAL, {}), { today: K.ymd(new Date()) });
  }
  K.subject({
    id: SID, name: "数学", tone: TONE,
    init,
    async onVisible() {
      try {
        const s2 = await K.get("/api/math/state");
        const changed = JSON.stringify(s2.books) !== JSON.stringify(S.books);
        S = s2;
        if (K.STATIC) Object.assign(S, K.store.get(LOCAL, {}), { today: K.ymd(new Date()) });
        if (changed) Object.keys(BOOK).forEach(k => delete BOOK[k]);
        if (["home", "wrong"].includes(K.cur.page)) K.route();
      } catch (e) { /* 离线 */ }
    },
    pages: { home, book: bookPage, sec: secPage, f: fPage, wrong: wrongPage, q: qPage },
  });
})();
