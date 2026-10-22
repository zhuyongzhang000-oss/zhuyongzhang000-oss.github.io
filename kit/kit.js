"use strict";
/* 学习台前端的公共部分（K）：
   - 和电脑上的服务通信：K.get / K.post；要保证送到的（作答、进度）用 K.send，连不上就排队，连上按顺序补发
   - 路由：地址是 #/<科目>/<页面>/<参数>，科目用 K.subject({...}) 注册自己
   - 顶栏、进度条、底部弹层、提示、切换科目、日间夜间
   各科目只管自己的页面，互不引用。 */
const K = (() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nat = (a, b) => String(a).localeCompare(String(b), "zh-CN", { numeric: true });
  const pct = x => (x == null || isNaN(x) ? "—" : Math.round(x * 100) + "%");
  const ymd = t => t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
  const addDays = (d, n) => { const t = new Date(d + "T00:00"); t.setDate(t.getDate() + n); return ymd(t); };
  const md = d => { const [, m, dd] = d.split("-"); return +m + "月" + +dd + "日"; };
  function dayLabel(d, today) {
    if (!d) return "";
    if (today) {
      const diff = Math.round((new Date(d + "T00:00") - new Date(today + "T00:00")) / 864e5);
      if (diff === 0) return "今天";
      if (diff === 1) return "明天";
      if (diff === -1) return "昨天";
    }
    return md(d);
  }
  const ICON = {
    chev: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    grid: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg>',
    more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>',
    book: '<svg viewBox="0 0 24 24"><path d="M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h9"/></svg>',
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 隐私模式 */ } },
  };

  /* ───── 错题规则（和电脑上 server/core/review.py 同一套） ─────
     先在网页里算出来马上显示，电脑回来的结果为准。noun 是「错题本」或「错词本」。 */
  const rules = {
    transition(row, correct, d) {
      if (!correct) {
        if (!row) return [{ state: "active", n: 1, last_wrong_day: d, due: addDays(d, 1) }, "入库"];
        const ev = { active: "仍在", probation: "抽查没过", mastered: "重新入库" }[row.state] || "仍在";
        return [{ ...row, state: "active", n: row.n + 1, last_wrong_day: d, due: addDays(d, 1) }, ev];
      }
      if (!row) return [null, null];
      if (row.state === "active") return row.last_wrong_day === d ? [row, "今天刚错"] : [{ ...row, state: "probation", due: addDays(d, 7) }, "移出"];
      if (row.state === "probation") return row.due && d < row.due ? [row, "抽查未到"] : [{ ...row, state: "mastered", due: null }, "掌握"];
      return [row, null];
    },
    event(ev, row, unsure, noun = "错题本") {
      const verb = noun === "错词本" ? "写对" : "做对";
      if (unsure && (ev === "入库" || ev === "仍在")) return ["in", `没把握，放进了${noun}`];
      return {
        "入库": ["in", `进了${noun} · 隔天${verb}就移出`],
        "仍在": ["in", `还在${noun} · 一共错了 ${row ? row.n : ""} 次`],
        "抽查没过": ["in", `抽查没过，回到${noun}`],
        "重新入库": ["in", `以前掌握了，这次又错，回到${noun}`],
        "今天刚错": ["", `今天刚错过，这次不算 · 明天${verb}才移出`],
        "移出": ["out", `移出${noun} ✓ 7 天后再抽查一次`],
        "抽查未到": ["", `在抽查期 · ${row && row.due ? md(row.due) : ""}再抽`],
        "掌握": ["out", "抽查通过，掌握了 ✓"],
      }[ev] || null;
    },
    due(wrong, today) {     // 今天能清的：错题本里到期的 + 抽查到期的
      return Object.entries(wrong).filter(([, w]) => (w.state === "active" || w.state === "probation") && w.due && w.due <= today).map(([id]) => id);
    },
  };

  /* ───── 通信 ───── */
  // 静态讲义站（GitHub 上那个只看讲义的网站）：没有电脑，记录不存，只读讲义
  const STATIC = !!window.XUEXI_STATIC;
  async function call(path, body) {
    if (STATIC && body !== undefined) return {};
    let r;
    try {
      r = await fetch(path, body === undefined ? { cache: "no-store" } :
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch (e) {
      offline(true);
      throw Object.assign(new Error(STATIC ? "没网，这一页还没存到这台设备上" : "连不上电脑上的学习台"), { offline: true });
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.错误 || `出错了（${r.status}）`);
    if (!outbox.length) offline(false);
    return data;
  }
  const get = path => call(path);
  const post = (path, body) => call(path, body || {});

  // 要保证送到的写入：先排队、按顺序送；连不上就每 3 秒重试，页面关了下次打开接着送
  let outbox = store.get("xuexi-outbox", []).map(x => ({ ...x, sending: false }));
  const waiters = new Map();
  let flushing = false, retryT = null;
  const persist = () => store.set("xuexi-outbox", outbox.map(({ path, body, key, id }) => ({ path, body, key, id })));
  function send(path, body, key) {
    if (STATIC) return Promise.resolve({});
    return new Promise((resolve, reject) => {
      if (key) outbox = outbox.filter(x => x.key !== key || x.sending);   // 同一份进度只留最新
      const item = { path, body, key, id: Date.now() + Math.random() };
      outbox.push(item);
      waiters.set(item.id, { resolve, reject });
      persist();
      flush();
    });
  }
  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      while (outbox.length) {
        const it = outbox[0];
        it.sending = true;
        let r;
        try {
          r = await fetch(it.path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(it.body) });
        } catch (e) {
          it.sending = false;
          offline(true);
          clearTimeout(retryT);
          retryT = setTimeout(flush, 3000);
          return;
        }
        const data = await r.json().catch(() => ({}));
        outbox.shift();
        persist();
        const w = waiters.get(it.id);
        waiters.delete(it.id);
        if (r.ok) w && w.resolve(data);
        else { if (w) w.reject(new Error(data.错误 || `出错了（${r.status}）`)); else toast(data.错误 || "有一条记录没保存上"); }
      }
      offline(false);
    } finally {
      flushing = false;
    }
  }
  function offline(on) {
    const el = $("#offline");
    el.hidden = !on;
    if (!on) return;
    el.textContent = STATIC ? "没网：这一页还没存到这台设备上，连上网再打开一次" :
      "连不上电脑上的学习台（电脑睡着了，还是黑窗口关了？）" +
      (outbox.length ? `，刚做的 ${outbox.length} 条先存在这里，连上自动保存` : "");
  }

  const pending = () => outbox.length;

  /* ───── 页面 ───── */
  const subjects = {};
  let hub = null, cur = { sid: null, page: null, arg: "" }, routeToken = 0;
  const bar = $("#bar"), view = $("#view"), strip = $("#strip");

  function subject(def) { subjects[def.id] = def; }
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

  async function route() {
    const token = ++routeToken;
    const m = location.hash.match(/^#\/([a-z]+)(?:\/([a-z]+))?(?:\/(.*))?$/);
    let sid = m && m[1];
    const page = (m && m[2]) || "home", arg = m && m[3] ? decodeURIComponent(m[3]) : "";
    if (!sid || !subjects[sid]) {
      sid = (hub && hub.上次) || store.get("xuexi-last", "politics");
      if (!subjects[sid]) sid = subjects.politics ? "politics" : Object.keys(subjects).find(k => !subjects[k].hidden);
      location.replace("#/" + sid);
      return;
    }
    const def = subjects[sid];
    K.onKey = null; K.onSwipe = null; K.onLeave && K.onLeave(); K.onLeave = null;
    closeSheet();
    strip.hidden = true;
    if (!def.hidden && cur.sid !== sid) {
      store.set("xuexi-last", sid);
      if (hub && hub.上次 !== sid) { hub.上次 = sid; post("/api/hub/last", { subject: sid }).catch(() => {}); }
    }
    if (!def.ready) {
      setTone(def.tone);
      bar.innerHTML = titleBar(def);
      render(`<p class="placeholder">正在读${esc(def.name)}…</p>`);
      try { await def.init(); def.ready = true; } catch (e) {
        if (token !== routeToken) return;
        render(`<p class="placeholder">${esc(e.message)}<br><button class="btn" data-act="k:reload">再试一次</button></p>`);
        return;
      }
      if (token !== routeToken) return;
    }
    const fn = (def.pages && def.pages[page]) || def.pages.home;
    const same = cur.sid === sid && cur.page === page && cur.arg === arg;
    cur = { sid, page, arg };
    fn(arg);
    if (!same) window.scrollTo(0, 0);
  }

  function titleBar(def, right = "") {
    return `<button class="title" data-act="k:switch" aria-label="切换科目"><span>${esc(def.name)}</span>${ICON.chev}</button><span class="sp"></span>${right}`;
  }
  function backBar(title, back, right = "") {
    return `<button class="ib" data-act="k:go" data-to="${esc(back)}" aria-label="返回">${ICON.back}</button>
      <span class="title small" title="${esc(title)}"><span>${esc(title)}</span></span><span class="sp"></span>${right}`;
  }
  function setBar(html) { bar.innerHTML = html; }
  function setTone(b) { if (b) $("#app").dataset.b = b; else delete $("#app").dataset.b; }
  function render(html, narrow) { view.className = "view" + (narrow ? " narrow" : ""); view.innerHTML = html; }
  function setStrip(ok, bad) {
    if (ok == null) { strip.hidden = true; return; }
    strip.hidden = false;
    strip.innerHTML = `<i class="g" style="width:${ok * 100}%"></i><i class="r" style="width:${bad * 100}%"></i>`;
  }

  /* ───── 弹层、提示 ───── */
  const sheet = $("#sheet"), scrim = $("#scrim");
  function openSheet(html) {
    sheet.innerHTML = `<div class="grip"></div>${html}`;
    sheet.hidden = false; scrim.hidden = false;
    const f = sheet.querySelector("textarea, button:not([disabled])");
    if (f) f.focus({ preventScroll: true });
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

  /* 切换科目：点左上角科目名 */
  function switcher() {
    const list = (hub && hub.科目) || Object.values(subjects).filter(s => !s.hidden).map(s => ({ id: s.id, 名称: s.name, 可用: true }));
    openSheet(`<h3>切换</h3><div class="menu">
      ${list.map(s => { const d = subjects[s.id]; return `<button class="mrow${cur.sid === s.id ? " cur" : ""}" data-act="k:go" data-to="#/${s.id}" data-b="${esc(d ? d.tone : "")}"><i></i>${esc(s.名称)}<span class="r${cur.sid === s.id ? " on" : ""}">${cur.sid === s.id ? "在这里" : s.可用 ? "" : esc(s.说明 || "还不能用")}</span></button>`; }).join("")}
      ${STATIC ? `<a class="mrow" href="zuowen/"><i class="plain"></i>英语作文 · 背诵<span class="r">单词 句型 模板</span></a><a class="mrow" href="c/index.html"><i class="plain"></i>C 语言讲义<span class="r">13 环</span></a>`
        : `<button class="mrow" data-act="k:go" data-to="#/settings"><i class="plain"></i>设置${hub && hub.更新 && hub.更新.落后 ? `<span class="r on">有更新</span>` : ""}</button>`}
      <button class="mrow" data-act="k:full"><i class="plain"></i>${fsOn() ? "退出全屏" : "全屏"}<span class="r">也可以双击顶栏空白处</span></button>
      ${((hub && hub.链接) || []).map(l => `<a class="mrow" href="${esc(l.地址)}" target="_blank" rel="noopener"><i class="plain"></i>${esc(l.名称)}<span class="r">新标签页</span></a>`).join("")}</div>
      <p class="note">${STATIC ? "这是只看讲义的网站：读到哪、做对没有只记在这台设备上，不进电脑的记录。" : "打开学习台会直接进上次用的科目。"}</p>`);
  }

  /* 全屏（隐藏的入口：切换菜单里的「全屏」，或者双击 / 双点顶栏空白处）。
     iPhone 的 Safari 不支持网页全屏，只能「添加到主屏幕」后从桌面图标打开。 */
  const fsOn = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  function fullscreen() {
    closeSheet();
    if (fsOn()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    const d = document.documentElement, req = d.requestFullscreen || d.webkitRequestFullscreen;
    const ios = /iPhone|iPod/.test(navigator.userAgent);
    if (!req || ios) {
      toast(ios ? "iPhone 不支持网页全屏：Safari 点「分享」→「添加到主屏幕」，以后从桌面图标打开就没有地址栏" : "这个浏览器不能网页全屏，电脑上可以按 F11", 4800);
      return;
    }
    try {
      const p = req.call(d);
      if (p && p.then) p.then(() => toast("全屏了 · 再双击顶栏或按 Esc 退出")).catch(() => toast("没能全屏，电脑上可以按 F11"));
    } catch (e) { toast("没能全屏，电脑上可以按 F11"); }
  }
  let lastTap = 0;
  const onBarBlank = e => !e.target.closest("button, a, input, select, textarea, [data-act]");
  bar.addEventListener("dblclick", e => { if (onBarBlank(e)) fullscreen(); });
  bar.addEventListener("touchend", e => {
    if (!onBarBlank(e)) return;
    const now = Date.now();
    if (now - lastTap < 320) { e.preventDefault(); lastTap = 0; fullscreen(); } else lastTap = now;
  });

  /* 日间夜间：每台设备分开记 */
  function setTheme(t) {
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    try { if (t) localStorage.setItem("xuexi-theme", t); else localStorage.removeItem("xuexi-theme"); } catch (e) { /* */ }
  }

  /* ───── 点击、键盘、滑动 ───── */
  const ACT = {
    "k:switch": switcher,
    "k:go": el => { closeSheet(); go(el.dataset.to); },
    "k:close": closeSheet,
    "k:reload": () => location.reload(),
    "k:full": fullscreen,
  };
  function acts(map) { Object.assign(ACT, map); }
  document.addEventListener("click", e => {
    const el = e.target.closest("[data-act]");
    if (!el || el.disabled) return;
    const fn = ACT[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el, e); }
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !sheet.hidden) { closeSheet(); return; }
    if (!sheet.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    if (K.onKey) K.onKey(e);
  });
  let tx = 0, ty = 0, tt = 0;
  view.addEventListener("touchstart", e => { const t = e.touches[0]; tx = t.clientX; ty = t.clientY; tt = Date.now(); }, { passive: true });
  view.addEventListener("touchend", e => {
    if (!K.onSwipe) return;
    const t = e.changedTouches[0], dx = t.clientX - tx, dy = t.clientY - ty;
    if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.6 && Date.now() - tt < 700) K.onSwipe(dx < 0 ? 1 : -1);
  }, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    flush();
    const def = subjects[cur.sid];
    if (def && def.ready && def.onVisible && !outbox.length) def.onVisible();
  });
  window.addEventListener("hashchange", route);

  /* 电脑上打开时：右下角给出平板这次要用的地址和二维码（电脑的 IP 每次可能不一样，平板相机扫一下就开） */
  function padCard() {
    const a = hub && hub.地址;
    if (STATIC || !["localhost", "127.0.0.1"].includes(location.hostname) || !a || !(a.局域网 || []).length) return;
    try { if (sessionStorage.getItem("xuexi-padcard") === "off") return; } catch (e) { /* */ }
    const list = a.局域网;
    let pick = 0;
    const box = document.createElement("div");
    box.className = "padcard";
    document.body.appendChild(box);
    const host = u => u.split("//")[1].split(":")[0];
    const draw = () => {
      const u = list[pick];
      let img = "";
      try { const qr = qrcode(0, "M"); qr.addData(u); qr.make(); img = qr.createImgTag(4, 0, "平板扫码打开"); } catch (e) { /* 画不出就只给地址 */ }
      box.innerHTML = `<div class="hd">平板扫码打开 <small>电脑这次的地址</small><button class="x" data-pc="off" aria-label="关掉">×</button></div>
        ${a.公用 ? `<div class="warn">Windows 把现在的网络当成「公用」，平板会被挡住：设置 → 网络和 Internet → WLAN → 点这个网络 → 网络配置文件类型选「专用」。</div>` : ""}
        <div class="code">${img}</div><code>${esc(u)}</code>
        ${list.length > 1 ? `<div class="alt">打不开？换一个：${list.map((x, i) => i === pick ? "" : `<button class="link" data-pc="ip" data-i="${i}">${esc(host(x))}</button>`).join(" ")}</div>` : ""}
        <div class="alt">平板和电脑要连同一个 Wi-Fi 或热点</div>`;
    };
    box.addEventListener("click", e => {
      const b = e.target.closest("[data-pc]");
      if (!b) return;
      if (b.dataset.pc === "off") { box.remove(); try { sessionStorage.setItem("xuexi-padcard", "off"); } catch (er) { /* */ } return; }
      pick = +b.dataset.i;
      draw();
    });
    draw();
  }

  async function start() {
    try { hub = await get("/api/hub"); } catch (e) { hub = null; }
    flush();
    route();
    padCard();
    if (STATIC && "serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});   // 看过的讲义存下来，没网也能看
  }
  async function refreshHub() { try { hub = await get("/api/hub"); } catch (e) { /* 离线时等恢复 */ } return hub; }

  return {
    $, $$, esc, nat, pct, ymd, addDays, md, dayLabel, ICON, store, rules,
    get, post, send, flush, pending, STATIC,
    subject, go, route, titleBar, backBar, setBar, setTone, render, setStrip,
    openSheet, closeSheet, toast, copyText, switcher, setTheme, acts, start, refreshHub, fullscreen,
    get hub() { return hub; }, get cur() { return cur; }, subjects,
    onKey: null, onSwipe: null, onLeave: null,
  };
})();
