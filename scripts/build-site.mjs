// 把 state/group_*.json 合并成一个 site.json 供前端静态使用
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const STATE_DIR = join(ROOT, 'state');
const OUT_DIR = join(ROOT, 'public', 'data');

const groups = JSON.parse(readFileSync(join(STATE_DIR, 'groups.json'), 'utf-8'));

const albums = [];
for (const g of groups) {
  const file = join(STATE_DIR, `group_${g}.json`);
  if (!existsSync(file)) continue;
  const data = JSON.parse(readFileSync(file, 'utf-8'));
  for (const [pid, item] of Object.entries(data)) {
    albums.push({
      id: pid,
      group: g,
      model: item.model || '',
      title: item.title || '',
      date: item.date || '',
      cover: item.cover || '',
    });
  }
}

const site = {
  generated: new Date().toISOString(),
  origin: 'https://meirentu.cc',
  groups,
  albums,
};

writeFileSync(join(OUT_DIR, 'site.json'), JSON.stringify(site));
console.log(`site.json: ${groups.length} 组, ${albums.length} 图集`);
