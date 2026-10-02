// A tiny in-process stand-in for an S3-compatible bucket (path-style addressing), enough for the
// storage tests: PUT, GET (with Range and response-header overrides), HEAD and DELETE.
// It records every request so tests can check that links really were signed.
import http from 'node:http';
import crypto from 'node:crypto';

/** Decodes an "aws-chunked" request body (what the SDK sends when it adds trailing checksums). */
function decodeAwsChunked(buffer) {
  const parts = [];
  let offset = 0;
  while (offset < buffer.length) {
    const lineEnd = buffer.indexOf('\r\n', offset);
    if (lineEnd < 0) break;
    const size = parseInt(buffer.toString('latin1', offset, lineEnd).split(';')[0], 16);
    if (!size) break;
    parts.push(buffer.subarray(lineEnd + 2, lineEnd + 2 + size));
    offset = lineEnd + 2 + size + 2;
  }
  return Buffer.concat(parts);
}

export async function startFakeS3({ bucket = 'pulse-test', cors = true } = {}) {
  const objects = new Map(); // key -> { body, contentType, cacheControl }
  const requests = [];
  const state = { failPuts: 0 };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fake-s3');
    const segments = url.pathname.split('/').filter(Boolean);
    const bucketName = segments.shift();
    const key = decodeURIComponent(segments.join('/'));
    const corsHeaders = cors && req.headers.origin
      ? { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Content-Length, Content-Range, Accept-Ranges' }
      : {};
    requests.push({
      method: req.method,
      key,
      signedUrl: url.searchParams.has('X-Amz-Signature'),
      credential: url.searchParams.get('X-Amz-Credential') || (req.headers.authorization || '').match(/Credential=([^,]+)/)?.[1] || null,
      query: Object.fromEntries(url.searchParams),
      range: req.headers.range || null,
      origin: req.headers.origin || null
    });

    const fail = (status, code) => {
      res.writeHead(status, { 'content-type': 'application/xml', ...corsHeaders });
      res.end(`<?xml version="1.0"?><Error><Code>${code}</Code></Error>`);
    };

    if (bucketName !== bucket) return fail(404, 'NoSuchBucket');

    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...corsHeaders, 'access-control-allow-methods': 'GET, HEAD', 'access-control-allow-headers': 'Range' });
      return res.end();
    }

    if (req.method === 'PUT') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      let body = Buffer.concat(chunks);
      if (/aws-chunked/.test(req.headers['content-encoding'] || '')) body = decodeAwsChunked(body);
      if (state.failPuts > 0) { state.failPuts -= 1; return fail(500, 'InternalError'); }
      objects.set(key, { body, contentType: req.headers['content-type'] || 'binary/octet-stream', cacheControl: req.headers['cache-control'] || null });
      res.writeHead(200, { etag: `"${crypto.createHash('md5').update(body).digest('hex')}"` });
      return res.end();
    }

    if (req.method === 'DELETE') {
      objects.delete(key);
      res.writeHead(204);
      return res.end();
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      const object = objects.get(key);
      if (!object) return fail(404, 'NoSuchKey');
      const headers = {
        'content-type': url.searchParams.get('response-content-type') || object.contentType,
        'accept-ranges': 'bytes',
        ...(object.cacheControl ? { 'cache-control': object.cacheControl } : {}),
        ...(url.searchParams.get('response-content-disposition')
          ? { 'content-disposition': url.searchParams.get('response-content-disposition') } : {}),
        ...corsHeaders
      };
      let status = 200;
      let body = object.body;
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (range && (range[1] || range[2])) {
        const total = object.body.length;
        const start = range[1] === '' ? Math.max(0, total - Number(range[2])) : Number(range[1]);
        const end = range[1] === '' || range[2] === '' ? total - 1 : Math.min(Number(range[2]), total - 1);
        status = 206;
        body = object.body.subarray(start, end + 1);
        headers['content-range'] = `bytes ${start}-${end}/${total}`;
      }
      headers['content-length'] = body.length;
      res.writeHead(status, headers);
      return res.end(req.method === 'HEAD' ? undefined : body);
    }

    return fail(405, 'MethodNotAllowed');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    bucket,
    url: `http://127.0.0.1:${port}`,
    objects,
    requests,
    state,
    env: (extra = {}) => ({
      S3_ENDPOINT: `http://127.0.0.1:${port}`,
      S3_BUCKET: bucket,
      S3_ACCESS_KEY_ID: 'TESTKEYID',
      S3_SECRET_ACCESS_KEY: 'test-secret-access-key',
      ...extra
    }),
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); })
  };
}
