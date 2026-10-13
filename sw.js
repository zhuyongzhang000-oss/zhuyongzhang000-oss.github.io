/* 讲义网站的离线缓存（自动生成）。 */
const CACHE = "jiangyi-d345a6efb1f2";
const FILES = ["./", "api/english/state", "api/hub", "api/math/book/apps", "api/math/book/deriv", "api/math/book/gs05", "api/math/book/gs08", "api/math/book/gs09", "api/math/book/gs13", "api/math/book/integ", "api/math/book/la", "api/math/book/limits", "api/math/book/multi", "api/math/book/ode", "api/math/book/taylor", "api/math/book/trig", "api/math/book/xd05", "api/math/book/xd06", "api/math/state", "c/index.html", "c/r01.html", "c/r02.html", "c/r03.html", "c/r04.html", "c/r05.html", "c/r06.html", "c/r07.html", "c/r08.html", "c/r09.html", "c/r10.html", "c/r11.html", "c/r12.html", "c/r13.html", "content/english/words.js", "english/english.css", "english/english.js", "icon.svg", "kit/base.css", "kit/kit.js", "manifest.json", "math/math.css", "math/math.js", "vendor/katex/LICENSE", "vendor/katex/fonts/KaTeX_AMS-Regular.woff2", "vendor/katex/fonts/KaTeX_Caligraphic-Bold.woff2", "vendor/katex/fonts/KaTeX_Caligraphic-Regular.woff2", "vendor/katex/fonts/KaTeX_Fraktur-Bold.woff2", "vendor/katex/fonts/KaTeX_Fraktur-Regular.woff2", "vendor/katex/fonts/KaTeX_Main-Bold.woff2", "vendor/katex/fonts/KaTeX_Main-BoldItalic.woff2", "vendor/katex/fonts/KaTeX_Main-Italic.woff2", "vendor/katex/fonts/KaTeX_Main-Regular.woff2", "vendor/katex/fonts/KaTeX_Math-BoldItalic.woff2", "vendor/katex/fonts/KaTeX_Math-Italic.woff2", "vendor/katex/fonts/KaTeX_SansSerif-Bold.woff2", "vendor/katex/fonts/KaTeX_SansSerif-Italic.woff2", "vendor/katex/fonts/KaTeX_SansSerif-Regular.woff2", "vendor/katex/fonts/KaTeX_Script-Regular.woff2", "vendor/katex/fonts/KaTeX_Size1-Regular.woff2", "vendor/katex/fonts/KaTeX_Size2-Regular.woff2", "vendor/katex/fonts/KaTeX_Size3-Regular.woff2", "vendor/katex/fonts/KaTeX_Size4-Regular.woff2", "vendor/katex/fonts/KaTeX_Typewriter-Regular.woff2", "vendor/katex/katex.min.css", "vendor/katex/katex.min.js"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c =>
  Promise.all(FILES.map(f => c.add(f).catch(() => {})))).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks =>
  Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === "navigate" ? await cache.match("./") : null);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      return new Response(JSON.stringify({ 错误: "没网，这一页还没存到这台设备上" }),
        { status: 503, headers: { "Content-Type": "application/json; charset=utf-8" } });
    }
  })());
});
