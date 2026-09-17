// Netlify 函数: 图片代理 (绕过防盗链 Referer)
// 路径: /img?u=<encoded url>
export default async (req) => {
  const target = req.query?.u;
  if (!target) {
    return { statusCode: 400, body: JSON.stringify({ error: '缺少 u 参数' }) };
  }

  let decoded;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'URL 编码无效' }) };
  }

  // 只允许代理 mmdb.cc 域名
  if (!/^https:\/\/[a-z0-9.]*mmdb\.cc\//.test(decoded)) {
    return { statusCode: 403, body: JSON.stringify({ error: '不允许的域名' }) };
  }

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
      'Referer': 'https://meirentu.cc/',
    };
    const r = await fetch(decoded, { headers, redirect: 'follow' });
    if (!r.ok) {
      return { statusCode: r.status, body: JSON.stringify({ error: '原站返回 ' + r.status }) };
    }
    const buf = Buffer.from(await r.arrayBuffer());
    const contentType = r.headers.get('content-type') || 'image/jpeg';
    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
      body: buf.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
