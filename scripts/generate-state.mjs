#!/usr/bin/env node
/**
 * 生成 state/group_*.json 元数据 (23 分类, 3533 图集)
 * 用法: node scripts/generate-state.mjs
 * 需要先 npm install
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const STATE_DIR = join(ROOT, 'state');
const ORIGIN = 'https://meirentu.cc';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const headers = {
  'User-Agent': UA,
  'Referer': ORIGIN + '/',
};

mkdirSync(STATE_DIR, { recursive: true });

// 限频
let lastReq = 0;
function throttle(gap = 0.5) {
  const now = Date.now() / 1000;
  const wait = (gap - (now - lastReq)) * 1000;
  if (wait > 0) return new Promise(r => setTimeout(r, wait));
  lastReq = Date.now() / 1000;
  return Promise.resolve();
}

async function get(url, retries = 4) {
  for (let i = 0; i < retries; i++) {
    await throttle();
    try {
      const r = await fetch(url, {
        headers,
        redirect: 'follow',
      });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      console.warn(`  重试 ${i + 1}/${retries} ${url}: ${e.message}`);
      await new Promise(r => setTimeout(r, 2 ** i + 1));
    }
  }
  throw new Error('获取失败: ' + url);
}

// 解析分类页
async function collectGroup(name) {
  const stateFile = join(STATE_DIR, `group_${name}.json`);
  if (existsSync(stateFile)) {
    console.log(`  [跳过] ${name} (已存在)`);
    return JSON.parse(readFileSync(stateFile, 'utf-8'));
  }

  const group = {};
  let page = 1;
  const MAX_PAGES = 10;

  while (page <= MAX_PAGES) {
    const url = page === 1 ? `${ORIGIN}/group/${name}.html` : `${ORIGIN}/group/${name}-${page}.html`;
    console.log(`  抓取 ${name} 第 ${page} 页...`);
    const html = await get(url);
    if (!html) { console.log(`  ${name} 第 ${page} 页 404, 停止`); break; }

    // 按 <li class="i_list" 分割
    const liBlocks = html.split(/(?=<li class="i_list)/).filter(b => b.includes('<li class="i_list'));
    let newCount = 0;
    for (const block of liBlocks) {
      const picMatch = block.match(/\/pic\/(\d+)\.html/);
      if (!picMatch) continue;
      const pid = picMatch[1];
      if (group[pid]) continue;

      const coverMatch = block.match(/<img[^>]*?data-src="(https:\/\/cdn\d+\.mmdb\.cc\/[^"]+\.jpg)"/)
        || block.match(/<img[^>]*?src="(https:\/\/cdn\d+\.mmdb\.cc\/[^"]+\.jpg)"/);
      const modelMatch = block.match(/<img[^>]*?alt="([^"]*)"/);
      const titleMatch = block.match(/<div class="meta-title">([^<]+?)<\/div>/);
      const dateMatch = block.match(/<div class="meta-post">[^<]*<i[^>]*><\/i>\s*<span>\s*([^<]+?)\s*<\/span>/)
        || block.match(/(\d{4}-\d{2}-\d{2})/);

      group[pid] = {
        cover: coverMatch ? coverMatch[1] : null,
        model: modelMatch ? modelMatch[1].trim() : null,
        title: titleMatch ? titleMatch[1].trim() : null,
        date: dateMatch ? dateMatch[1].trim() : null,
      };
      newCount++;
    }
    console.log(`    第 ${page} 页: ${liBlocks.length} 条, 新增 ${newCount}`);
    if (liBlocks.length < 30) break;
    page++;
    await throttle(0.3);
  }

  writeFileSync(stateFile, JSON.stringify(group, null, 2), 'utf-8');
  console.log(`  [完成] ${name}: ${Object.keys(group).length} 图集`);
  return group;
}

// 主流程
async function main() {
  console.log('=== 生成 state 数据 ===');

  // 1. 从首页获取分类列表
  const homeHtml = await get(ORIGIN + '/');
  const groupLinks = [...homeHtml.matchAll(/href="\/group\/([a-z0-9-]+)\.html/gi)].map(m => m[1]);
  // 去重: 去 -N 后缀, 小写
  const names = [...new Set(groupLinks.map(g => g.toLowerCase().replace(/-\d+$/, '')))].sort();
  console.log(`首页 ${groupLinks.length} 个链接 -> 去重后 ${names.length} 个分类`);

  // 保存分类名列表
  writeFileSync(join(STATE_DIR, 'groups.json'), JSON.stringify(names, null, 2), 'utf-8');

  // 2. 逐个抓分类
  const allGroups = {};
  for (const name of names) {
    console.log(`\n抓取分类: ${name}`);
    allGroups[name] = await collectGroup(name);
  }

  // 统计
  const total = Object.values(allGroups).reduce((s, g) => s + Object.keys(g).length, 0);
  console.log(`\n=== 完成: ${names.length} 分类, ${total} 图集 ===`);
}

main().catch(e => { console.error(e); process.exit(1); });
