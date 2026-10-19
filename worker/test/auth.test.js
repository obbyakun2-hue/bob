import { test } from "node:test";
import assert from "node:assert/strict";
import { createToken, verifyToken, checkPassword, getAuthUser } from "../src/auth.js";

const SECRET = "secret-panjang-untuk-test-12345";

test("JWT: roundtrip valid", async () => {
  const token = await createToken("bobby", SECRET);
  assert.equal(await verifyToken(token, SECRET), "bobby");
});

test("JWT: ditolak kalau secret beda", async () => {
  const token = await createToken("bobby", SECRET);
  assert.equal(await verifyToken(token, "secret-lain"), null);
});

test("JWT: ditolak kalau signature diubah", async () => {
  const token = await createToken("bobby", SECRET);
  const parts = token.split(".");
  const tampered = `${parts[0]}.${parts[1]}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
  assert.equal(await verifyToken(tampered, SECRET), null);
});

test("JWT: ditolak kalau payload diubah", async () => {
  const token = await createToken("bobby", SECRET);
  const parts = token.split(".");
  const fakePayload = Buffer.from(JSON.stringify({ sub: "admin", exp: 9999999999 })).toString("base64url");
  assert.equal(await verifyToken(`${parts[0]}.${fakePayload}.${parts[2]}`, SECRET), null);
});

test("JWT: format rusak ditolak", async () => {
  assert.equal(await verifyToken("bukan-jwt", SECRET), null);
  assert.equal(await verifyToken("a.b", SECRET), null);
  assert.equal(await verifyToken("", SECRET), null);
  assert.equal(await verifyToken(null, SECRET), null);
});

function b64urlJson(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

async function signExpired(secret) {
  const header = b64urlJson({ alg: "HS256", typ: "JWT" });
  const payload = b64urlJson({ sub: "bobby", iat: 1000, exp: 2000 }); // 1970 → pasti kadaluarsa
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${Buffer.from(sig).toString("base64url")}`;
}

test("JWT: token kadaluarsa ditolak", async () => {
  const expired = await signExpired(SECRET);
  assert.equal(await verifyToken(expired, SECRET), null);
});

test("checkPassword: cocok / tidak cocok", async () => {
  assert.equal(await checkPassword("rahasia123", "rahasia123"), true);
  assert.equal(await checkPassword("salah", "rahasia123"), false);
  assert.equal(await checkPassword("", "rahasia123"), false);
  assert.equal(await checkPassword("rahasia123", ""), false);
});

function mockRequest(token) {
  return {
    headers: {
      get: (name) => (name === "Authorization" && token ? `Bearer ${token}` : null),
    },
  };
}

test("getAuthUser: token valid + username cocok", async () => {
  const token = await createToken("bobby", SECRET);
  const env = { JWT_SECRET: SECRET, ADMIN_USERNAME: "bobby" };
  assert.equal(await getAuthUser(mockRequest(token), env), "bobby");
});

test("getAuthUser: username token beda dengan ADMIN_USERNAME → null", async () => {
  const token = await createToken("orang-lain", SECRET);
  const env = { JWT_SECRET: SECRET, ADMIN_USERNAME: "bobby" };
  assert.equal(await getAuthUser(mockRequest(token), env), null);
});

test("getAuthUser: tanpa header / token rusak → null", async () => {
  const env = { JWT_SECRET: SECRET, ADMIN_USERNAME: "bobby" };
  assert.equal(await getAuthUser(mockRequest(null), env), null);
  assert.equal(await getAuthUser(mockRequest("rusak"), env), null);
});
