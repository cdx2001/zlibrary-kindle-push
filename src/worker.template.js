// Version 2: deploy WITH wrangler.toml (SQLite Durable Object binding required).
// No third-party SMTP library. Buffer is a documented Workers built-in.
import { connect } from 'cloudflare:sockets';
import { Buffer } from 'node:buffer';

const MAX_BYTES = __MAX_BYTES__; // Decimal MB, deliberately NOT 50 MiB.

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();
const IO_TIMEOUT = 60000;
const SMTP_DEADLINE = 480000;

export class SafeError extends Error {
  constructor(code, status = 400, stage = '', smtpCode) {
    super(code);
    Object.assign(this, { code, status, stage, smtpCode });
  }
}
function fail(code, status = 400) { throw new SafeError(code, status); }
function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  } });
}
function config(env) {
  for (const key of ['API_TOKEN', 'SMTP_USER', 'SMTP_AUTH_CODE', 'KINDLE_EMAIL']) {
    if (typeof env[key] !== 'string' || !env[key]) fail('CONFIG_MISSING_' + key, 503);
  }
  if (!/^[\x21-\x7e]{32,256}$/.test(env.API_TOKEN)) fail('CONFIG_API_TOKEN_FORMAT', 503);
  const mailbox = /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/;
  if (env.SMTP_USER.length > 254 || !mailbox.test(env.SMTP_USER) || !/@126\.com$/i.test(env.SMTP_USER)) {
    fail('CONFIG_SMTP_USER_FORMAT', 503);
  }
  if (env.KINDLE_EMAIL.length > 254 || !mailbox.test(env.KINDLE_EMAIL)) fail('CONFIG_KINDLE_EMAIL_FORMAT', 503);
  if (!/^[\x21-\x7e]{1,256}$/.test(env.SMTP_AUTH_CODE)) fail('CONFIG_SMTP_AUTH_CODE_FORMAT', 503);
  return env;
}
async function authorize(request, env) {
  // Fixed-length digest comparison; never echo or log either credential.
  const auth = request.headers.get('Authorization') || '';
  if (auth.length > 300 || !auth.startsWith('Bearer ')) fail('UNAUTHORIZED', 401);
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', ENCODER.encode(auth.slice(7))),
    crypto.subtle.digest('SHA-256', ENCODER.encode(env.API_TOKEN)),
  ]);
  const aa = new Uint8Array(a), bb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  if (diff !== 0) fail('UNAUTHORIZED', 401);
}
export function configurationWarnings(env) {
  const from=env.SMTP_USER.split('@')[0].toLowerCase();
  const to=env.KINDLE_EMAIL.split('@')[0].toLowerCase();
  const warnings=[];
  if(from===to || (Math.min(from.length,to.length)>=4 && (from.includes(to)||to.includes(from))))warnings.push('MAILBOX_PREFIX_SIMILAR');
  if(!/@(?:free\.)?kindle\.com$/i.test(env.KINDLE_EMAIL))warnings.push('CHECK_KINDLE_ADDRESS_DOMAIN');
  return warnings;
}
export async function readLimited(request, limit = MAX_BYTES) {
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) fail('FILE_TOO_LARGE', 413);
  if (!request.body) fail('EMPTY_FILE');
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0, timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new SafeError('UPLOAD_TIMEOUT', 408));
      reader.cancel().catch(() => {});
    }, 60000);
  });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        reader.cancel().catch(() => {});
        fail('FILE_TOO_LARGE', 413);
      }
      chunks.push(value);
    }
  } finally { clearTimeout(timer); reader.releaseLock(); }
  if (!total) fail('EMPTY_FILE');
  if (length !== null && Number(length) !== total) fail('CONTENT_LENGTH_MISMATCH');
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  return bytes;
}
export function uploadSize(request) {
  const declared = request.headers.get('X-File-Size');
  const length = request.headers.get('Content-Length');
  const raw = declared ?? length;
  if (raw === null) fail('FILE_SIZE_REQUIRED', 411);
  if (!/^\d{1,10}$/.test(raw) || Number(raw) < 1) fail('BAD_FILE_SIZE');
  const expected = Number(raw);
  if (expected > MAX_BYTES) fail('FILE_TOO_LARGE', 413);
  if (length !== null && (!/^\d{1,10}$/.test(length) || Number(length) !== expected)) fail('CONTENT_LENGTH_MISMATCH');
  return expected;
}
export async function readExactUpload(request, timeoutMs = 300000) {
  const expected = uploadSize(request);
  if (!request.body) fail('EMPTY_FILE');
  // One allocation for the entire file. Never keep all incoming chunks then copy them.
  // Only the Durable Object runs this path; the public Worker forwards the body as a stream.
  const bytes = new Uint8Array(expected);
  const reader = request.body.getReader();
  let total = 0, timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new SafeError('UPLOAD_TIMEOUT', 408));
      reader.cancel().catch(() => {});
    }, timeoutMs);
  });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      if (total + value.byteLength > expected) fail('FILE_SIZE_MISMATCH');
      bytes.set(value, total);
      total += value.byteLength;
    }
    if (total !== expected) fail('FILE_SIZE_MISMATCH');
    return bytes;
  } catch (e) {
    reader.cancel().catch(() => {});
    throw e;
  } finally { clearTimeout(timer); reader.releaseLock(); }
}
export function filenameFrom(request) {
  let name;
  try { name = decodeURIComponent(request.headers.get('X-Filename') || 'book.epub'); }
  catch { fail('BAD_FILENAME'); }
  if (name.length > 160 || !/\.epub$/i.test(name) || /[\x00-\x1f\x7f/\\]/.test(name)) fail('BAD_FILENAME');
  return name;
}
export function validateEpub(bytes) {
  // Bounded ZIP structure check, NOT full EPUBCheck, decompression, or a DRM remover.
  const bad = () => fail('INVALID_EPUB', 415);
  if (bytes.length < 100) bad();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = n => v.getUint16(n, true), u32 = n => v.getUint32(n, true);
  const text = (a, b) => DECODER.decode(bytes.subarray(a, b));
  if (u32(0) !== 0x04034b50 || (u16(6) & 9) || u16(8) !== 0 ||
      u32(18) !== 20 || u32(22) !== 20 || u16(26) !== 8 || u16(28) !== 0 ||
      text(30, 38) !== 'mimetype' || text(38, 58) !== 'application/epub+zip') bad();
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(58, bytes.length - 65557); i--) {
    if (u32(i) === 0x06054b50 && i + 22 + u16(i + 20) === bytes.length) { end = i; break; }
  }
  if (end < 0 || u16(end + 4) || u16(end + 6)) bad();
  const count = u16(end + 10), size = u32(end + 12), start = u32(end + 16);
  if (!count || count > 16384 || u16(end + 8) !== count || start + size !== end || start < 58) bad();
  let p = start, container = false, packageFile = false, mime = false;
  const names = new Set();
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || u32(p) !== 0x02014b50) bad();
    const nl = u16(p + 28), el = u16(p + 30), cl = u16(p + 32), local = u32(p + 42);
    const method = u16(p + 10), flags = u16(p + 8), compressed = u32(p + 20);
    if (nl > 1024 || !nl || p + 46 + nl + el + cl > end || (flags & 1) ||
        ![0, 8].includes(method) || u16(p + 34) || local + 30 > start) bad();
    const name = text(p + 46, p + 46 + nl);
    if (names.has(name) || /[\x00-\x1f\\]/.test(name) || name.startsWith('/') || name.split('/').includes('..')) bad();
    names.add(name);
    if (u32(local) !== 0x04034b50 || u16(local + 8) !== method || u16(local + 6) !== flags) bad();
    const ln = u16(local + 26), le = u16(local + 28), data = local + 30 + ln + le;
    if (data > start || data + compressed > start || text(local + 30, local + 30 + ln) !== name) bad();
    if (!(flags & 8) && (u32(local + 18) !== compressed || u32(local + 22) !== u32(p + 24))) bad();
    if (name === 'mimetype') { if (local !== 0 || compressed !== 20 || u32(p + 24) !== 20) bad(); mime = true; }
    if (name === 'META-INF/container.xml') container = true;
    if (/\.opf$/i.test(name)) packageFile = true;
    p += 46 + nl + el + cl;
  }
  if (p !== end || !mime || !container || !packageFile) bad();
}

export class SMTPClient {
  constructor(socket, timeoutMs = IO_TIMEOUT, deadlineMs = SMTP_DEADLINE) {
    this.socket = socket;
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
    this.timeoutMs = timeoutMs;
    this.deadline = Date.now() + deadlineMs;
    this.buffer = '';
    this.stage = 'connect';
    this.commitStarted = false;
    this.accepted = false;
    // Both promises may reject independently. Observe both, without logging.
    socket.closed.catch(() => {});
    socket.opened.catch(() => {});
  }
  async io(promise) {
    const remaining = Math.min(this.timeoutMs, this.deadline - Date.now());
    if (remaining <= 0) throw new SafeError('SMTP_TIMEOUT', 504, this.stage);
    let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new SafeError('SMTP_TIMEOUT', 504, this.stage));
          this.close();
        }, remaining);
      })]);
    } catch (e) {
      if (e instanceof SafeError) throw e;
      throw new SafeError('SMTP_CONNECTION_ERROR', 502, this.stage);
    } finally { clearTimeout(timer); }
  }
  async line() {
    while (true) {
      const end = this.buffer.indexOf('\r\n');
      if (end >= 0) {
        if (end > 4096) throw new SafeError('SMTP_BAD_REPLY', 502, this.stage);
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 2);
        return line;
      }
      if (this.buffer.length > 4096) throw new SafeError('SMTP_BAD_REPLY', 502, this.stage);
      const { value, done } = await this.io(this.reader.read());
      if (done) throw new SafeError('SMTP_CONNECTION_CLOSED', 502, this.stage);
      this.buffer += DECODER.decode(value);
      if (this.buffer.length > 65536) throw new SafeError('SMTP_BAD_REPLY', 502, this.stage);
    }
  }
  async reply() {
    const lines = [];
    let code;
    for (let i = 0; i < 64; i++) {
      const line = await this.line();
      const match = /^(\d{3})([- ]|$)(.*)$/.exec(line);
      if (!match || (code !== undefined && code !== Number(match[1]))) throw new SafeError('SMTP_BAD_REPLY', 502, this.stage);
      code = Number(match[1]);
      lines.push(match[3]);
      if (match[2] !== '-') return { code, lines };
    }
    throw new SafeError('SMTP_BAD_REPLY', 502, this.stage);
  }
  expect(reply, codes) {
    if (!codes.includes(reply.code)) throw new SafeError('SMTP_REJECTED', 502, this.stage, reply.code);
    return reply;
  }
  async write(text) { await this.io(this.writer.write(ENCODER.encode(text))); }
  async command(text, codes, stage) {
    this.stage = stage;
    if (/[\r\n]/.test(text)) throw new SafeError('INTERNAL_COMMAND_ERROR', 500, stage);
    await this.write(text + '\r\n');
    return this.expect(await this.reply(), codes);
  }
  async login(env, serviceHost) {
    await this.io(this.socket.opened);
    this.stage = 'greeting';
    this.expect(await this.reply(), [220]);
    const ehlo = await this.command('EHLO ' + serviceHost, [250], 'ehlo');
    const capabilities = ehlo.lines.slice(1); // First line is the greeting, per SMTP.
    const auth = capabilities.filter(s => /^AUTH[ =]/i.test(s)).join(' ').toUpperCase().split(/[ =]+/);
    const size = capabilities.map(s => /^SIZE\s+(\d+)/i.exec(s)).find(Boolean);
    this.maxSize = size ? Number(size[1]) : null;
    this.supportsSize = capabilities.some(s => /^SIZE(?:\s|$)/i.test(s));
    if (auth.includes('PLAIN')) {
      this.mechanism = 'PLAIN';
      await this.command('AUTH PLAIN', [334], 'auth');
      await this.command(Buffer.from('\0' + env.SMTP_USER + '\0' + env.SMTP_AUTH_CODE).toString('base64'), [235], 'auth');
    } else if (auth.includes('LOGIN')) {
      this.mechanism = 'LOGIN';
      await this.command('AUTH LOGIN', [334], 'auth');
      await this.command(Buffer.from(env.SMTP_USER).toString('base64'), [334], 'auth');
      await this.command(Buffer.from(env.SMTP_AUTH_CODE).toString('base64'), [235], 'auth');
    } else {
      throw new SafeError('SMTP_AUTH_UNSUPPORTED', 502, 'ehlo');
    }
    return { mechanism: this.mechanism, tls: 'implicit', port: 465, smtpCode: 235, serverMaxMessageBytes: this.maxSize };
  }
  async send(from, to, mime) {
    if (this.maxSize && mime.size > this.maxSize) throw new SafeError('SMTP_MESSAGE_TOO_LARGE', 413, 'mail');
    await this.command('MAIL FROM:<' + from + '>' + (this.supportsSize ? ' SIZE=' + mime.size : ''), [250], 'mail');
    await this.command('RCPT TO:<' + to + '>', [250, 251], 'rcpt');
    await this.command('DATA', [354], 'data');
    this.stage = 'body';
    // Every payload line is ASCII headers, boundaries, or base64, and cannot start with '.'.
    // Therefore dot-stuffing is unnecessary here. Do not insert arbitrary text into this path.
    for (const chunk of mime.chunks()) await this.write(chunk);
    this.stage = 'commit';
    this.commitStarted = true;
    await this.write('.\r\n'); // MIME chunks always end in CRLF.
    const reply = await this.reply();
    if (reply.code >= 400 && reply.code <= 599) this.commitStarted = false; // Explicit rejection, not ambiguous.
    this.expect(reply, [250]);
    this.accepted = true;
    // QUIT failure after acceptance must never turn a successful send into a retry.
    try { await this.command('QUIT', [221], 'quit'); } catch {}
  }
  close() {
    try { this.socket.close().catch(() => {}); } catch {}
  }
}

function foldedBase64(bytes) {
  const base64 = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  return base64.replace(/.{1,76}/g, '$&\r\n');
}
function encodedHeader(text) {
  // Each encoded-word stays below 75 characters, including multi-byte Chinese names.
  const words = []; let part = '';
  for (const character of text) {
    if (Buffer.byteLength(part + character) > 42) { words.push(part); part = ''; }
    part += character;
  }
  if (part) words.push(part);
  return words.map(s => '=?UTF-8?B?' + Buffer.from(s).toString('base64') + '?=').join('\r\n ');
}
function filenameParameters(filename) {
  const encoded = [...ENCODER.encode(filename)].map(n => '%' + n.toString(16).padStart(2, '0').toUpperCase());
  const parts = [];
  for (let i = 0; i < encoded.length; i += 15) parts.push(encoded.slice(i, i + 15).join(''));
  return parts.map((p, i) => ' filename*' + i + '*=' + (i === 0 ? "UTF-8''" : '') + p).join(';\r\n');
}
export function makeMime(from, to, filename, attachment, id = crypto.randomUUID(), serviceHost = 'kindle-push.invalid') {
  const boundary = 'kp_' + id;
  const title = attachment ? filename : 'Kindle Push SMTP test';
  const body = attachment ? 'Your EPUB is attached.\n' : 'SMTP login and plain email submission succeeded.\nThis is not a Kindle attachment test.\n';
  const common = 'From: <' + from + '>\r\nTo: <' + to + '>\r\n' +
    'Subject: ' + encodedHeader(title) + '\r\nDate: ' + new Date().toUTCString() + '\r\n' +
    'Message-ID: <' + id + '@' + serviceHost + '>\r\nMIME-Version: 1.0\r\n';
  let prefix, suffix = '';
  const textPart = 'Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' +
    foldedBase64(ENCODER.encode(body));
  if (!attachment) {
    prefix = common + textPart;
  } else {
    prefix = common + 'Content-Type: multipart/mixed; boundary="' + boundary + '"\r\n\r\n' +
      '--' + boundary + '\r\n' + textPart + '\r\n--' + boundary + '\r\n' +
      'Content-Type: application/epub+zip; name="book.epub"\r\nContent-Transfer-Encoding: base64\r\n' +
      'Content-Disposition: attachment;\r\n' + filenameParameters(filename) + '\r\n\r\n';
    suffix = '\r\n--' + boundary + '--\r\n';
  }
  const encodedLength = attachment ? Math.ceil(attachment.length / 3) * 4 : 0;
  const size = prefix.length + suffix.length + encodedLength + 2 * Math.ceil(encodedLength / 76);
  return { id, size, *chunks() {
    yield prefix;
    if (attachment) {
      // 57 input bytes become exactly 76 base64 characters. Chunk boundaries preserve this.
      const step = 57 * 1024;
      for (let i = 0; i < attachment.length; i += step) yield foldedBase64(attachment.subarray(i, i + step));
      yield suffix;
    }
  } };
}

async function runSMTP(env, mode, filename, bytes, serviceHost) {
  let client;
  try {
    // TLS starts before greeting/AUTH; no plaintext fallback or certificate bypass.
    client = new SMTPClient(connect({ hostname: 'smtp.126.com', port: 465 }, { secureTransport: 'on' }));
    const login = await client.login(env, serviceHost);
    if (mode === 'auth') {
      try { await client.command('QUIT', [221], 'quit'); } catch {}
      return { ok: true, status: 'authenticated', ...login };
    }
    const to = mode === 'test' ? env.SMTP_USER : env.KINDLE_EMAIL;
    const mime = makeMime(env.SMTP_USER, to, filename, bytes, undefined, serviceHost);
    await client.send(env.SMTP_USER, to, mime);
    return { ok: true, status: 'smtp_accepted', smtpCode: 250,
      messageId: mime.id, recipient: mode === 'test' ? 'self' : 'kindle',
      attachmentBytes: bytes?.length || 0, messageBytes: mime.size,
      deliveredToKindle: false };
  } catch (error) {
    let e = error instanceof SafeError ? error : new SafeError('SMTP_CONNECTION_ERROR', 502, client?.stage || 'connect');
    if (client?.commitStarted && !client.accepted) {
      e = new SafeError('DELIVERY_UNKNOWN_DO_NOT_RETRY', 504, 'commit');
    }
    throw e;
  } finally { client?.close(); }
}

function errorResponse(e, id) {
  const known = e instanceof SafeError;
  return json({ ok: false, error: known ? e.code : 'INTERNAL_ERROR',
    stage: known ? e.stage : undefined, smtpCode: known ? e.smtpCode : undefined,
    requestId: id, automaticRetry: false }, known ? e.status : 500);
}
export default {
  async fetch(request, env) {
    const id = crypto.randomUUID();
    try {
      const url = new URL(request.url);
      if (url.protocol !== 'https:') fail('HTTPS_REQUIRED', 400);
      if (request.method === 'GET' && url.pathname === '/') {
        return Response.redirect(url.origin + '/setup', 302);
      }
      if (request.method === 'GET' && (url.pathname === '/panel' || url.pathname === '/setup')) return panel();
      if (request.method === 'GET' && url.pathname === '/kindle-push.user.js') {
        return new Response(renderUserscript(url.origin), { headers: {
          'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        } });
      }
      if (!['/limits', '/smtp-auth', '/smtp-test', '/push'].includes(url.pathname)) fail('NOT_FOUND', 404);
      if (request.method !== 'POST') fail('METHOD_NOT_ALLOWED', 405);
      // Authorization is bearer-based (never cookies). No CORS headers/preflight are granted.
      // Do not reject extension Origin values: Firefox GM requests may use them.
      if (url.search) fail('QUERY_NOT_ALLOWED');
      // Validate only token configuration before authentication; do not expose other configuration to strangers.
      if (typeof env.API_TOKEN !== 'string' || !/^[\x21-\x7e]{32,256}$/.test(env.API_TOKEN)) fail('SERVICE_NOT_CONFIGURED', 503);
      await authorize(request, env);
      config(env);
      if (url.pathname === '/push') {
        uploadSize(request); // Reject over-limit input BEFORE forwarding or allocating.
        filenameFrom(request);
        if ((request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/epub+zip') fail('UNSUPPORTED_MEDIA_TYPE', 415);
      }
      if (!env.MAIL_SENDER) fail('DURABLE_OBJECT_BINDING_MISSING', 503);
      // Never buffer the file in the ordinary 10 ms Worker. One fixed object serializes
      // this personal service and prevents two __MAX_MB__ MB buffers sharing an isolate.
      const stub = env.MAIL_SENDER.get(env.MAIL_SENDER.idFromName('personal-mailbox-v2'));
      try { return await stub.fetch(request); }
      catch { fail('SERVICE_INTERRUPTED_CHECK_MAIL_DO_NOT_RETRY', 503); }
    } catch (e) { return errorResponse(e, id); }
  },
};

// A standard fetch-based Durable Object class; no database or file contents are stored.
// wrangler.toml creates this class with the free-plan-compatible SQLite backend.
export class MailSender {
  constructor(state, env) {
    this.env = env;
    this.busy = false;
  }
  async fetch(request) {
    const id = crypto.randomUUID();
    let locked = false;
    try {
      const env = this.env;
      const url = new URL(request.url);
      if (request.method !== 'POST' || !['/limits', '/smtp-auth', '/smtp-test', '/push'].includes(url.pathname)) fail('NOT_FOUND', 404);
      await authorize(request, env);
      config(env);
      if (url.pathname === '/limits') {
        return json({ ok: true, version: '__VERSION__', engine: 'durable-object-sqlite',
          maxFileBytes: MAX_BYTES, maxFileMB: __MAX_MB__, busy: this.busy,
          configurationWarnings: configurationWarnings(env),
          uploadTimeoutSeconds: 300, smtpTimeoutSeconds: 480,
          serverAcceptanceRequired: true, requestId: id });
      }
      if (this.busy) fail('BUSY_ONE_BOOK_AT_A_TIME', 429);
      this.busy = true;
      locked = true;
      let bytes, filename;
      if (url.pathname === '/push') {
        if ((request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/epub+zip') fail('UNSUPPORTED_MEDIA_TYPE', 415);
        filename = filenameFrom(request);
        bytes = await readExactUpload(request);
        validateEpub(bytes);
      } else if (request.body) {
        // Some HTTP runtimes expose an empty POST body as a stream instead of null.
        try { await readLimited(request, 1); fail('TEST_BODY_NOT_ALLOWED'); }
        catch (e) { if (!(e instanceof SafeError) || e.code !== 'EMPTY_FILE') throw e; }
      }
      const result = await runSMTP(env, url.pathname === '/smtp-auth' ? 'auth' : url.pathname === '/smtp-test' ? 'test' : 'push', filename, bytes, url.hostname);
      return json({ ...result, requestId: id, version: '__VERSION__', engine: 'durable-object-sqlite' });
    } catch (e) { return errorResponse(e, id); }
    finally { if (locked) this.busy = false; }
  }
}

function panel() {
  const nonce = crypto.randomUUID();
  const html = SETUP_HTML.replaceAll('__NONCE__', nonce);
  return new Response(html, { headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  } });
}
