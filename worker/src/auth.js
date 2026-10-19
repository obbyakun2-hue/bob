// Auth single-user: JWT HS256 (Web Crypto, tanpa dependency) + verifikasi password.

const te = new TextEncoder();

function b64urlEncode(bytes) {
  const arr = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

async function importHmacKey(secret, usages) {
  return crypto.subtle.importKey("raw", te.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usages);
}

export async function createToken(username, secret) {
  const header = b64urlEncode(te.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64urlEncode(
    te.encode(JSON.stringify({ sub: username, iat: now, exp: now + 7 * 24 * 3600 }))
  );
  const key = await importHmacKey(secret, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, te.encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64urlEncode(sig)}`;
}

export async function verifyToken(token, secret) {
  try {
    const parts = String(token).split(".");
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;
    const key = await importHmacKey(secret, ["verify"]);
    const ok = await crypto.subtle.verify("HMAC", key, b64urlDecode(s), te.encode(`${h}.${p}`));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    return payload.sub || null;
  } catch {
    return null;
  }
}

async function sha256hex(str) {
  const d = await crypto.subtle.digest("SHA-256", te.encode(str));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Perbandingan password anti-timing-attack sederhana (hash dulu, lalu bandingkan).
export async function checkPassword(input, stored) {
  const a = await sha256hex("uang-tracker:" + String(input ?? ""));
  const b = await sha256hex("uang-tracker:" + String(stored ?? ""));
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Ambil username dari header Authorization: Bearer <token>. Null kalau tidak valid.
export async function getAuthUser(request, env) {
  const h = request.headers.get("Authorization") || "";
  const m = h.match(/^Bearer (.+)$/);
  if (!m) return null;
  const sub = await verifyToken(m[1], env.JWT_SECRET);
  return sub && sub === env.ADMIN_USERNAME ? sub : null;
}

export function unauthorized() {
  return Response.json({ error: "Unauthorized — silakan login dulu" }, { status: 401 });
}
