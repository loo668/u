// 共享: 从源站(meirentu.cc)实时 HTML 中解析列表项。
// 列表项统一结构 <li class="i_list ...">, 30 条/页。
// 首页/专题/搜索全部走源站实时数据, 本站只做"壳"。
export const ORIGIN = 'https://meirentu.cc';
export const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  Referer: ORIGIN + '/',
};

export async function fetchSource(path) {
  const r = await fetch(ORIGIN + path, {
    headers: UA,
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error('原站返回 ' + r.status);
  return r.text();
}

// 解析单个 <li class="i_list"> 列表项 -> {pid, cover, model, title, date, group}
function parseItem(block) {
  const out = { pid: '', cover: '', model: '', title: '', date: '', group: '' };
  const pidM = block.match(/href="\/pic\/(\d+)\.html"/);
  if (pidM) out.pid = pidM[1];
  const coverM = block.match(/data-src="(https:\/\/[a-z0-9.]*mmdb\.cc\/[^"]+)"/i);
  if (coverM) out.cover = coverM[1];
  const altM = coverM && coverM[1] ? block.match(/<img[^>]*alt="([^"]*)"/) : null;
  if (altM && altM[1]) out.model = altM[1];
  const titleM = block.match(/<div class="meta-title">([^<]+)<\/div>/);
  if (titleM) out.title = titleM[1].trim();
  const dateM = block.match(/<div class="meta-post">[\s\S]*?<span>(\d{4}-\d{2}-\d{2})<\/span>/);
  if (dateM) out.date = dateM[1];
  return out;
}

// 解析整页 HTML 中的全部列表项
export function parseListItems(html) {
  const items = [];
  const re = /<li class="i_list[^"]*">[\s\S]*?<\/li>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const it = parseItem(m[0]);
    if (it.pid) items.push(it);
  }
  return items;
}

// 从首页 HTML 提取专题(分组)导航: [{slug, name}]
// 链接形如 <a href="/group/xiuren.html" title="秀人网美图">XiuRen秀人网</a>
// 优先用 title 属性 (去掉"美图"后缀得到纯中文名), 否则用链接文本
export function parseGroups(html) {
  const re = /<a[^>]*href="\/group\/([a-z0-9-]+)\.html"[^>]*>([^<]*)<\/a>/g;
  const seen = new Set();
  const groups = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const slug = m[1];
    const tagOpen = m[0].slice(0, m[0].indexOf('>'));
    const tM = tagOpen.match(/title="([^"]*)"/);
    const title = tM ? tM[1].replace(/美图$/, '').trim() : '';
    const text = m[2].trim();
    const name = title || text || slug;
    if (!seen.has(slug)) {
      seen.add(slug);
      groups.push({ slug, name });
    }
  }
  return groups;
}

// 读取分页"下一页"链接 (形如 /group/x-N.html 或 /index/N.html 或 /?s=...&paged=N)
export function nextLinkOf(html, curPath) {
  const m = html.match(/<div class="page">([\s\S]*?)<\/div>/);
  if (!m) return '';
  const links = [...m[1].matchAll(/href="([^"]+)"/g)].map((x) => x[1]);
  const cur = links.find((l) => l.indexOf(curPath) === 0 || l === curPath);
  // 找比当前序号大的第一个
  const nums = links
    .map((l) => l.match(/(\d+)(?:\.html)?($|\?)/))
    .filter(Boolean);
  return links.length ? links[links.length - 2] || '' : '';
}
