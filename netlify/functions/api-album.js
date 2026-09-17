// Netlify 函数: 图集大图 (实时从原站拉取, 一次全部返回, 不分页)
// 路径: /api/album/<pid>
export default async (req) => {
  let pid = req.query?.pid;
  if (!pid) {
    const m = (req.path || '').match(/\/(\d+)$/);
    if (m) pid = m[1];
  }
  if (!pid || !/^\d+$/.test(pid)) {
    return { statusCode: 400, body: JSON.stringify({ error: '缺少 pid' }) };
  }

  const ORIGIN = 'https://meirentu.cc';
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
    'Referer': ORIGIN + '/',
  };

  const MAX_PAGES = 10;
  const allImages = [];
  let model = '';
  let title = '';

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = page === 1
      ? `${ORIGIN}/pic/${pid}.html`
      : `${ORIGIN}/pic/${pid}-${page}.html`;

    let html;
    try {
      const r = await fetch(url, { headers, redirect: 'follow' });
      if (r.status === 404) break;
      if (!r.ok) break;
      html = await r.text();
    } catch {
      break;
    }

    // 提取大图 (带 min-height 样式的 img)
    const imgRegex = /<img[^>]*?style="[^"]*min-height:[^"]*"[^>]*?src="(https:\/\/p\d+\.mmdb\.cc\/[^"]+\.jpg)"/g;
    let m;
    let found = 0;
    while ((m = imgRegex.exec(html)) !== null) {
      allImages.push(m[1]);
      found++;
    }
    if (found === 0) break;

    // 第一页提取 model 和 title
    if (page === 1) {
      const modelMatch = html.match(/href="\/model\/([^/]+)\.html"/);
      if (modelMatch) model = modelMatch[1];
      const titleMatch = html.match(/<div class="item_title"><h1>(.*?)<\/h1/);
      if (titleMatch) title = titleMatch[1].trim();
    }

    // 如果没有下一页链接, 停止
    if (page < MAX_PAGES) {
      const nextLink = html.includes(`/pic/${pid}-${page + 1}.html`);
      if (!nextLink) break;
    }
    await new Promise(r => setTimeout(r, 200));
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ pid, model, title, images: allImages }),
  };
};
