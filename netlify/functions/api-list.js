// Netlify 函数: 列表(首页/专题/搜索)实时代理
// 路径: /api/list?s=<kw>  或 /api/list?g=<slug>&page=N
// 全部实时拉源站, 本站仅做壳。
import { fetchSource, parseListItems, parseGroups } from './_parse-source.js';

const jh = { 'Content-Type': 'application/json; charset=utf-8' };

function jmsg(body, status, extraHeaders) {
  const headers = Object.assign({}, jh, extraHeaders || {});
  return new Response(JSON.stringify(body), { status, headers });
}

export default async (req) => {
  let q, g, page;
  try {
    const u = new URL(req.url, 'http://x.local');
    q = u.searchParams.get('s') || '';
    g = u.searchParams.get('g') || '';
    page = parseInt(u.searchParams.get('page') || '1', 10) || 1;
  } catch {}
  if (!q && !g) {
    // 兼容旧版 req.query
    if (req.query) {
      q = req.query.s || '';
      g = req.query.g || '';
      page = parseInt(req.query.page || '1', 10) || 1;
    }
  }
  try {
    let path;
    let extra = {};
    if (q) {
      // 搜索: /?s=<kw>
      path = '/?s=' + encodeURIComponent(q);
      extra = { q, groups: [] };
      if (page > 1) path += '&paged=' + page;
    } else if (g) {
      // 专题: /group/<slug>.html, 分页 /group/<slug>-N.html
      path = page === 1 ? '/group/' + g + '.html' : '/group/' + g + '-' + page + '.html';
      extra = { g, groups: [] };
    } else {
      // 首页
      path = '/';
    }

    const html = await fetchSource(path);
    const items = parseListItems(html);

    let hasMore = false;
    // 分页判断: 列表恰好 30 条, 且存在下一页链接
    const pageBlock = html.match(/<div class="page">([\s\S]*?)<\/div>/);
    if (items.length >= 30 && pageBlock) {
      const numLinks = [...pageBlock[1].matchAll(/href="([^"]+)"/g)].map((x) => x[1]);
      hasMore = numLinks.length > 1;
    }

    const out = Object.assign(
      { items, hasMore, page, total: items.length },
      extra,
      { cache: 60 }
    );

    if (!q && !g) {
      // 首页同时返回专题导航
      out.groups = parseGroups(html);
    } else if (g) {
      // 专题页返回该专题中文名: 优先取首页 groups 映射 (源站 group 页 <title> 结构不一致, 不可靠)
      const homeHtml = await fetchSource('/').catch(() => '');
      const gm = parseGroups(homeHtml).find((x) => x.slug === g);
      out.groupName = gm ? gm.name : g;
    }

    return jmsg(out, 200, {
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    });
  } catch (e) {
    return jmsg({ error: '抓取失败: ' + (e && e.message ? e.message : String(e)), items: [] }, 502);
  }
};
