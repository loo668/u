// Netlify 函数: 图集大图 (实时从原站拉取, 一次全部返回, 不分页)
// 路径: /api/album/<pid>  -> 重定向到 /api-album?pid=<pid>
// 兼容旧版 (req.query) 与新版 Web (req.url) 函数签名
export default async (req) => {
  try {
    // pid: 新版 req.url 是完整 URL; 旧版 req.query.pid
    let pid = '';
    try {
      const u = new URL(req.url, 'http://x.local');
      pid = u.searchParams.get('pid') || '';
    } catch {}
    if (!pid && req.query && typeof req.query.pid === 'string') pid = req.query.pid;
    if (!pid) {
      const m = (req.url || req.path || '').match(/\/(\d+)(?:\.html)?(?:\?|$)/);
      if (m) pid = m[1];
    }
    if (!/^\d+$/.test(pid)) {
      return new Response(JSON.stringify({ error: '缺少 pid' }), { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    }

    const ORIGIN = 'https://meirentu.cc';
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      Referer: ORIGIN + '/',
    };

    // 原站分页"下一页链接"不可靠 (10 页后链接消失但仍有图), 上限放到 30 页兜底
    const MAX_PAGES = 30;
    const allImages = [];
    let model = '';
    let title = '';
    let pagesFetched = 0;
    let fetchError = '';

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = page === 1
        ? `${ORIGIN}/pic/${pid}.html`
        : `${ORIGIN}/pic/${pid}-${page}.html`;

      let html;
      try {
        const r = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(20000) });
        if (r.status === 404) { if (page === 1) fetchError = '图集不存在(404)'; break; }
        if (!r.ok) break;
        html = await r.text();
      } catch (e) {
        if (page === 1) fetchError = '抓取失败: ' + (e && e.message ? e.message : e);
        break;
      }
      if (!html || html.length < 200) { if (page === 1) fetchError = '原站返回内容过短'; break; }
      pagesFetched = page;

      // 只取属于本图集的大图: p*.mmdb.cc/file/.../<pid>/ 路径 (排除 cdn 推荐位)
      // 本图集图片: p*.mmdb.cc/file/YYYYMMDD/<pid>/NNNNNNNN.jpg (排除 cdn 推荐位)
      const albumPattern = 'https://p[0-9]+\\.mmdb\\.cc/file/[0-9]+/' + pid + '/[0-9]+\\.jpg';
      const found = html.match(new RegExp(albumPattern, 'gi')) || [];
      for (const u of found) allImages.push(u);
      if (found.length === 0) break;

      if (page === 1) {
        const modelMatch = html.match(/href="\/model\/([^\/"]+)\.html/);
        if (modelMatch) model = decodeURIComponent(modelMatch[1]);
        const titleMatch = html.match(/<div class="item_title">[^]*?<h1[^>]*>([^<]+)<\/h1/s);
        if (titleMatch) title = titleMatch[1].trim();
      }

      // 原站分页"下一页链接"不可靠 (10 页后链接消失但仍有图), 抓满 MAX_PAGES 或某页无图为止
      await new Promise((r) => setTimeout(r, 150));
    }

    if (allImages.length === 0) {
      const msg = fetchError || '未找到图片 (原站结构可能已变化或图集已删除)';
      return new Response(JSON.stringify({ pid, error: msg, images: [] }), {
        status: 502,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    return new Response(JSON.stringify({ pid, model, title, pages: pagesFetched, images: allImages }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: '函数异常: ' + (e && e.message ? e.message : String(e)) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
};
