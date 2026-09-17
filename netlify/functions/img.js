// Netlify 函数: 图片代理 (绕过防盗链 Referer)
// 路径: /img?u=<urlencoded>
export default async (req) => {
  const jh = { 'Content-Type': 'application/json; charset=utf-8' };
  const target = req.query && typeof req.query.u === 'string'
    ? req.query.u
    : (() => { try { return new URL(req.url, 'http://x.local').searchParams.get('u') || ''; } catch { return ''; } })();

  if (!target) {
    return new Response(JSON.stringify({ error: '缺少 u 参数' }), { status: 400, headers: jh });
  }

  let decoded;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    return new Response(JSON.stringify({ error: 'URL 编码无效' }), { status: 400, headers: jh });
  }

  // 只允许代理 mmdb.cc 域名
  if (!/^https:\/\/[a-z0-9.]*mmdb\.cc\//.test(decoded)) {
    return new Response(JSON.stringify({ error: '不允许的域名' }), { status: 403, headers: jh });
  }

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      Referer: 'https://meirentu.cc/',
    };
    const r = await fetch(decoded, { headers, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    if (!r.ok) {
      return new Response(JSON.stringify({ error: '原站返回 ' + r.status }), {
        status: r.status >= 500 ? 502 : r.status, headers: jh,
      });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    const contentType = r.headers.get('content-type') || 'image/jpeg';
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e && e.message ? e.message : String(e) }), { status: 502, headers: jh });
  }
};
