// 全站全量爬取: 遍历 23 个专题 + 首页的全部分页, 生成离线搜索索引。
// 用途: 前端"全局整站搜索" — 一次爬完, 之后所有搜索都在本地即时过滤, 不再每次打源站。
// 输出: public/data/search-index.json  (压缩到 ~2-3MB, 含 标题/模特/封面/pid/专题/日期)
//
// 爬取策略:
//   - 并发 10 线程抓源站分页 (实测每页 0.28s, 全量 800+ 页 ≈ 1-3 分钟)
//   - 每页解析 <li class="i_list"> 拿 pid/cover/model/title/date
//   - 专题末页用 title "第N页" 判断 (源站对超出末页的 group/N.html 会静默回首页, 不可靠)
//   - 首页分页用 /index/N.html
//   - 去重后写 JSON
//
// 运行: node scripts/crawl-search-index.mjs [--force]
//   默认若 public/data/search-index.json 已存在且 <24h 则跳过; --force 强制重爬

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import zlib from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'public', 'data', 'search-index.json');
const ORIGIN = 'https://meirentu.cc';
const HEADERS = { 'Referer': ORIGIN + '/', 'User-Agent': 'Mozilla/5.0' };

// 23 个专题 slug (与源站首页导航一致)
const SLUGS = [
  'xiuren','mfstar','mistar','mygirl','imiss','bololi','youwu','uxing','miitao',
  'feilin','wings','taste','leyuan','huayan','dkgirl','mintye','youmi','candy',
  'mtmeng','micat','huayang','xingyan','xiaoyu',
];

// slug -> 中文名 (与 _parse-source.js parseGroups 一致, 源站首页 title 属性)
const GROUP_NAMES = {
  bololi:'兔几盟', candy:'糖果画报', dkgirl:'御女郎', feilin:'嗲囡囡',
  huayan:'花の颜', huayang:'花漾', imiss:'爱蜜社', leyuan:'星乐园',
  mfstar:'模范学院', micat:'猫萌榜', miitao:'蜜桃社', mintye:'薄荷叶',
  mistar:'魅妍社', mtmeng:'模特联盟', mygirl:'美媛馆', taste:'顽味生活',
  uxing:'优星馆', wings:'影私荟', xiaoyu:'画语界', xingyan:'星颜社',
  xiuren:'秀人网', youmi:'尤蜜荟', youwu:'尤物馆',
};

// ---------- 源站 HTML 解析 (与 _parse-source.js 保持一致) ----------
function parseItem(block) {
  const out = { pid: '', cover: '', model: '', title: '', date: '', group: '' };
  const pidM = block.match(/href="\/pic\/(\d+)\.html"/);
  if (pidM) out.pid = pidM[1];
  const coverM = block.match(/data-src="(https:\/\/[a-z0-9.]*mmdb\.cc\/[^"]+)"/i);
  if (coverM) out.cover = coverM[1];
  if (coverM && coverM[1]) {
    const altM = block.match(/<img[^>]*alt="([^"]*)"/);
    if (altM && altM[1]) out.model = altM[1];
  }
  const titleM = block.match(/<div class="meta-title">([^<]+)<\/div>/);
  if (titleM) out.title = titleM[1].trim();
  const dateM = block.match(/<div class="meta-post">[\s\S]*?<span>(\d{4}-\d{2}-\d{2})<\/span>/);
  if (dateM) out.date = dateM[1];
  return out;
}
function parseItems(html) {
  const items = [];
  const re = /<li class="i_list[^"]*">[\s\S]*?<\/li>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const it = parseItem(m[0]);
    if (it.pid) items.push(it);
  }
  return items;
}

async function fetchHtml(url) {
  const r = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  return r.text();
}

// 简易并发池
async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

// 二分找末页: 返回最大 p 使 group/<slug>-p.html 仍含 i_list (源站超末页静默回首页, 但 i_list 仍 30 条 → 需结合 title 判断)
// 这里用 i_list 数量 + title "第N页" 双重校验
// 源站 bug: 超过真实末页后, group/N.html 不 404 也不空, 而是静默回首页并复述"第1页", i_list 仍是 30。
// 因此探测有效页必须核对 title 复述的页码 === 请求页码。
// 已知源站真实深度上限 100 页 (xiuren 第 100 页 stated=100, 第 120 页 stated 回退 1)。
const MAX_GROUP_PAGES = 100;
const MAX_HOME_PAGES = 150;

async function lastPage(slug) {
  const probe = async (p) => {
    const h = await fetchHtml(ORIGIN + '/group/' + slug + '-' + p + '.html');
    const m = h.match(/<title>[^<]*?第(\d+)页/);
    const stated = m ? parseInt(m[1], 10) : 0;
    const has = (h.match(/<li class="i_list/g) || []).length >= 1;
    // 有效页 = 有内容 且 源站复述的页码恰好等于请求页码 (否则是回退首页)
    return has && stated === p;
  };
  // 在 [1, MAX_GROUP_PAGES] 二分找最大有效页
  let lo = 1, hi = MAX_GROUP_PAGES;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    (await probe(mid)) ? (lo = mid) : (hi = mid - 1);
  }
  return lo;
}

async function main() {
  const force = process.argv.includes('--force');
  if (!force && existsSync(OUT)) {
    const age = Date.now() - statSync(OUT).mtimeMs;
    if (age < 24 * 3600 * 1000) {
      console.log('[crawl] 搜索索引存在且 <24h, 跳过 (加 --force 强制重爬)');
      return;
    }
  }
  console.log('[crawl] 开始全量爬取 23 专题 + 首页…');
  const t0 = Date.now();

  // 1) 并发找每个专题的末页
  const lastPages = await mapPool(SLUGS, 8, async (s) => {
    try {
      const lp = await lastPage(s);
      console.log('[crawl]   %s 末页=%d', s, lp);
      return lp;
    } catch (e) {
      console.log('[crawl]   %s 探测失败, 按 2 页处理: %s', s, e.message);
      return 2;
    }
  });
  const maxGroupPage = Math.max(2, ...lastPages);

  // 2) 首页末页 (源站 /index/N.html, 与 group 同样"超页回退"bug, 同样有 150 页深度上限)
  async function homeLastPage() {
    const probe = async (p) => {
      try {
        const h = await fetchHtml(ORIGIN + (p === 1 ? '/' : '/index/' + p + '.html'));
        const m = h.match(/<title>[^<]*?第(\d+)页/);
        const stated = m ? parseInt(m[1], 10) : 0;
        const has = (h.match(/<li class="i_list/g) || []).length >= 1;
        return has && stated === p;
      } catch { return false; }
    };
    let lo = 1, hi = MAX_HOME_PAGES;
    while (lo < hi) { const mid = Math.floor((lo + hi + 1) / 2); (await probe(mid)) ? (lo = mid) : (hi = mid - 1); }
    return lo;
  }
  const homeLP = await homeLastPage();
  console.log('[crawl] 首页末页=%d', homeLP);

  // 3) 并发抓取全部分页, 边抓边解析累积
  const seen = {};
  const all = [];
  const pushItems = (items, group) => {
    for (const it of items) {
      if (!it.pid || seen[it.pid]) continue;
      seen[it.pid] = 1;
      all.push({ pid: it.pid, t: it.title, m: it.model, c: it.cover, d: it.date, g: group });
    }
  };

  const jobs = [];
  // 专题分页
  SLUGS.forEach((s, idx) => {
    const lp = lastPages[idx] || 2;
    for (let p = 1; p <= lp; p++) {
      jobs.push(async () => {
        const url = ORIGIN + (p === 1 ? '/group/' + s + '.html' : '/group/' + s + '-' + p + '.html');
        const h = await fetchHtml(url);
        pushItems(parseItems(h), GROUP_NAMES[s] || s);
      });
    }
  });
  // 首页分页
  for (let p = 1; p <= homeLP; p++) {
    jobs.push(async () => {
      const url = ORIGIN + (p === 1 ? '/' : '/index/' + p + '.html');
      const h = await fetchHtml(url);
      pushItems(parseItems(h), '全部');
    });
  }

  console.log('[crawl] 共需抓取 %d 页, 并发 10…', jobs.length);
  let done = 0;
  await mapPool(jobs, 10, async (fn) => {
    try { await fn(); } catch (e) { /* 单页失败跳过 */ }
    if (++done % 50 === 0) process.stdout.write('\r[crawl]   进度 ' + done + '/' + jobs.length + '  已收集 ' + all.length + ' 条');
  });
  console.log('\n[crawl] 抓取完成, 共 %d 条去重条目', all.length);

  // 4) 写 JSON (压缩: 字段缩写 t/m/c/d/g, 无冗余)
  const payload = { v: 1, ts: Date.now(), count: all.length, items: all };
  const body = Buffer.from(JSON.stringify(payload));
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload));
  console.log('[crawl] 已写入 %s (%.1f KB)', OUT, body.length / 1024);
  console.log('[crawl] 总耗时 %ds', Math.round((Date.now() - t0) / 1000));
}

main().catch((e) => { console.error('[crawl] 失败:', e); process.exit(1); });
