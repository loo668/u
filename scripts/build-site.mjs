// 纯"壳"构建: 首页/专题/图集 全部由 Netlify 函数运行时实时代理源站 meirentu.cc。
// 构建时额外全量爬取一份搜索索引 (public/data/search-index.json), 供前端"整站搜索"即时过滤。
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// 全量爬取搜索索引 (24h 缓存跳过; 失败不阻塞部署, 前端有实时池回退)
console.log('[build] 生成搜索索引…');
const child = spawn('node', [join(__dirname, 'crawl-search-index.mjs')], { stdio:'inherit', cwd:ROOT });
await new Promise((resolve, reject) => { child.on('close', c => c===0?resolve():reject(new Error('crawler exit '+c))); child.on('error', reject); });
console.log('[build] 搜索索引就绪 (public/data/search-index.json)');
console.log('[build] 构建完成: 实时代理壳 + 离线搜索索引');
