// Vercel Routing Middleware: protects /demo/* on theitguys.online.
// ---- Demo login check (same code in functions/_middleware.js and middleware.js) ----
// Logins live in the hosting dashboard, never in this repo:
//   DEMO_USERS  = "storagekeys:LongPassword1,otherclient:LongPassword2"
//   DEMO_SECRET = any long random string (signs the login cookie)
const COOKIE = 'itg_demo';
const MAX_AGE = 7 * 24 * 3600;
const PUBLIC = ['/demo/login', '/demo/login/', '/demo/login.html'];
const enc = new TextEncoder();

function b64url(buf) {
  let s = '';
  new Uint8Array(buf).forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sign(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
function sameText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function readUsers(env) {
  const users = new Map();
  String(env.DEMO_USERS || '').split(',').forEach((pair) => {
    const i = pair.indexOf(':');
    if (i > 0) users.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  });
  return users;
}
function getCookie(request, name) {
  const all = request.headers.get('cookie') || '';
  const hit = all.split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
  return hit ? hit.slice(name.length + 1) : '';
}
function redirect(to, cookie) {
  const headers = new Headers({ Location: to, 'Cache-Control': 'no-store' });
  if (cookie) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers });
}

async function guardDemo(request, env, pass) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path !== '/demo' && !path.startsWith('/demo/')) return pass();
  if (PUBLIC.includes(path)) return pass();

  const users = readUsers(env);
  const secret = env.DEMO_SECRET;
  if (!secret || users.size === 0) {
    return new Response('The client preview is not set up yet.', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  if (path === '/demo/logout') {
    return redirect('/demo/login.html', COOKIE + '=; Path=/demo; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
  }

  if (path === '/demo/auth' && request.method === 'POST') {
    const form = await request.formData();
    const user = String(form.get('username') || '').trim();
    const password = String(form.get('password') || '');
    const expected = users.get(user);
    if (!expected || !sameText(password, expected)) {
      await new Promise((r) => setTimeout(r, 900));
      return redirect('/demo/login.html?e=1');
    }
    const payload = encodeURIComponent(user) + '.' + (Math.floor(Date.now() / 1000) + MAX_AGE);
    const token = payload + '.' + (await sign(secret, payload));
    return redirect('/demo/', COOKIE + '=' + token + '; Path=/demo; Max-Age=' + MAX_AGE + '; HttpOnly; Secure; SameSite=Lax');
  }

  const token = getCookie(request, COOKIE);
  const parts = token.split('.');
  if (parts.length === 3) {
    const payload = parts[0] + '.' + parts[1];
    const user = decodeURIComponent(parts[0]);
    const fresh = Number(parts[1]) > Date.now() / 1000;
    if (fresh && users.has(user) && sameText(parts[2], await sign(secret, payload))) return pass(true);
  }
  return redirect('/demo/login.html');
}
// ---- end of shared login check ----

export const config = { matcher: ['/demo', '/demo/:path*'] };

export default async function middleware(request) {
  // Returning nothing lets Vercel serve the requested file.
  return guardDemo(request, process.env, () => undefined);
}
