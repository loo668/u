// 纯"壳"构建: 不再预爬任何数据。
// 首页/专题/搜索/图集全部由 Netlify 函数在运行时实时代理到源站 (meirentu.cc)。
// 此步骤仅保证 public/ 目录存在并清理旧的静态数据, 使部署自包含、与 state/ 解耦。
import { existsSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// 清理旧的预爬静态数据 (前端已不再使用 /data/site.json)
const oldData = join(ROOT, 'public', 'data', 'site.json');
if (existsSync(oldData)) rmSync(oldData, { force: true });
// 若 public/data 目录因此为空, 一并移除
const dataDir = join(ROOT, 'public', 'data');
if (existsSync(dataDir)) {
  rmSync(dataDir, { recursive: true, force: true });
}

console.log('构建完成: 纯实时代理壳 (无预爬数据, 数据全部来自源站运行时)');
