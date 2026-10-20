// Uang Tracker — Cloudflare Worker
// API pencatatan uang masuk/keluar + serve frontend statis (via [assets]).

import { initDb } from "./db.js";
import { createToken, getAuthUser, unauthorized, checkPassword } from "./auth.js";
import { notifyTransaction, notifyBatch, txMessage, sendPhotoByFileId, testTelegram, notifyDebt, notifyDebtPaid } from "./telegram.js";

const json = (data, status = 200) => Response.json(data, { status });
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---- Rate limit login (anti brute-force): maks 10 percobaan / 5 menit / IP ----
// Disimpan di KV supaya berlaku lintas isolate. Gagal-terbuka (fail open)
// kalau KV belum tersedia — login tetap jalan.
const LOGIN_RL_MAX = 10;
const LOGIN_RL_WINDOW_MS = 5 * 60 * 1000;
async function readLoginRec(env, ip) {
  if (!env.RECEIPTS) return null;
  try {
    const raw = await env.RECEIPTS.get(`rl:login:${ip}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
// >0 = diblokir, kembalikan sisa detik tunggu. 0 = boleh lanjut.
async function loginBlockedSeconds(env, request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const rec = await readLoginRec(env, ip);
  if (!rec || Date.now() - rec.t > LOGIN_RL_WINDOW_MS) return 0;
  if (rec.n < LOGIN_RL_MAX) return 0;
  return Math.max(1, Math.ceil((LOGIN_RL_WINDOW_MS - (Date.now() - rec.t)) / 1000));
}
async function loginAttempt(env, request, success) {
  if (!env.RECEIPTS) return;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = `rl:login:${ip}`;
  if (success) {
    try { await env.RECEIPTS.delete(key); } catch { /* abaikan */ }
    return;
  }
  const now = Date.now();
  let rec = await readLoginRec(env, ip);
  if (!rec || now - rec.t > LOGIN_RL_WINDOW_MS) rec = { n: 0, t: now };
  rec.n += 1;
  try {
    await env.RECEIPTS.put(key, JSON.stringify(rec), { expirationTtl: 300 });
  } catch { /* abaikan */ }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ---------- health ----------
      if (path === "/api/health") {
        return json({ ok: true, time: new Date().toISOString() });
      }

      // ---------- init database (dipanggil workflow setelah deploy) ----------
      if (path.startsWith("/api/init/")) {
        const secret = decodeURIComponent(path.slice("/api/init/".length));
        if (!env.JWT_SECRET || secret !== env.JWT_SECRET) {
          return json({ error: "forbidden" }, 403);
        }
        try {
          await initDb(env.DB);
        } catch (e) {
          // Pesan asli dikembalikan agar debug gampang. Endpoint ini
          // diproteksi JWT_SECRET jadi aman dari publik.
          return json({ error: "init gagal: " + (e?.message || String(e)) }, 500);
        }
        return new Response("success", { headers: { "Content-Type": "text/plain" } });
      }

      // ---------- login (1 user) ----------
      if (path === "/api/login" && request.method === "POST") {
        const waitSecs = await loginBlockedSeconds(env, request);
        if (waitSecs > 0) {
          return new Response(JSON.stringify({ error: "Terlalu banyak percobaan, coba lagi sebentar" }), {
            status: 429,
            headers: { "Content-Type": "application/json", "Retry-After": String(waitSecs) },
          });
        }
        const body = await request.json().catch(() => ({}));
        const username = String(body.username || "").trim();
        const password = String(body.password || "");
        if (
          username &&
          username === env.ADMIN_USERNAME &&
          (await checkPassword(password, env.ADMIN_PASSWORD))
        ) {
          await loginAttempt(env, request, true);
          return json({ token: await createToken(username, env.JWT_SECRET) });
        }
        await loginAttempt(env, request, false);
        return json({ error: "Username atau password salah" }, 401);
      }

      // ---------- daftar kategori ----------
      if (path === "/api/categories" && request.method === "GET") {
        if (!(await getAuthUser(request, env))) return unauthorized();
        const { results } = await env.DB.prepare(
          "SELECT name, type FROM categories ORDER BY type, name"
        ).all();
        return json({ categories: results || [] });
      }

      // ---------- daftar penginput (siapa yang input data) ----------
      // Bisa ditambah/dihapus dari aplikasi; dipakai sebagai label transaksi.
      if (path === "/api/inputters" && request.method === "GET") {
        if (!(await getAuthUser(request, env))) return unauthorized();
        const { results } = await env.DB.prepare("SELECT name FROM inputters ORDER BY name").all();
        return json({ inputters: (results || []).map((r) => r.name) });
      }
      if (path === "/api/inputters" && request.method === "POST") {
        if (!(await getAuthUser(request, env))) return unauthorized();
        const b = await request.json().catch(() => ({}));
        const name = String(b.name || "").trim().slice(0, 40);
        if (!name) return json({ error: "Nama tidak boleh kosong" }, 400);
        await env.DB.prepare("INSERT OR IGNORE INTO inputters (name) VALUES (?)").bind(name).run();
        return json({ name }, 201);
      }
      const mInp = path.match(/^\/api\/inputters\/(.+)$/);
      if (mInp && request.method === "DELETE") {
        if (!(await getAuthUser(request, env))) return unauthorized();
        const name = decodeURIComponent(mInp[1]).slice(0, 40);
        await env.DB.prepare("DELETE FROM inputters WHERE name = ?").bind(name).run();
        return json({ ok: true });
      }

      // ---------- upload struk ----------
      // Jalur utama: TELEGRAM (gratis, praktis unlimited, tanpa kartu kredit).
      // Foto dikirim via sendPhoto ke chat Telegram; kalau meta transaksi
      // disertakan, caption notifikasi ikut dikirim SEKALI JALAN (tidak dobel
      // saat transaksi dibuat). file_id yang dikembalikan Telegram disimpan
      // sebagai receipt_key format "tg:<file_id>".
      // Fallback: KV ("kv:receipts/...") bila Telegram tak dikonfigurasi/gagal.
      if (path === "/api/upload" && request.method === "POST") {
        if (!(await getAuthUser(request, env))) return unauthorized();
        const form = await request.formData().catch(() => null);
        const file = form ? form.get("file") : null;
        if (!file || typeof file === "string") return json({ error: "File tidak ditemukan" }, 400);
        if (file.type && !file.type.startsWith("image/")) return json({ error: "File harus berupa gambar" }, 400);
        if (file.size > 5 * 1024 * 1024) return json({ error: "Ukuran file maksimal 5MB" }, 400);

        const meta = {
          date: String(form.get("date") || "").slice(0, 10),
          type: form.get("type") === "in" ? "in" : "out",
          category: String(form.get("category") || "").slice(0, 80),
          amount: Math.floor(Number(form.get("amount")) || 0),
          note: String(form.get("note") || "").slice(0, 500),
          input_by: String(form.get("input_by") || "").slice(0, 40),
        };
        const hasMeta = meta.amount > 0 && DATE_RE.test(meta.date);
        // Label bebas untuk upload non-transaksi (mis. "Dokumen: KTP").
        // Di-escape karena caption dikirim dengan parse_mode HTML.
        const label = String(form.get("label") || "").slice(0, 80)
          .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        // --- Jalur 1: Telegram ---
        if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
          try {
            const bytes = await file.arrayBuffer();
            const tgForm = new FormData();
            tgForm.append("chat_id", env.TELEGRAM_CHAT_ID);
            tgForm.append("caption", hasMeta ? txMessage(meta) : label ? `📄 ${label}` : "🧾 Struk");
            tgForm.append("parse_mode", "HTML");
            tgForm.append("photo", new Blob([bytes], { type: "image/webp" }), "struk.webp");
            const tgRes = await fetch(
              `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`,
              { method: "POST", body: tgForm }
            );
            const tgData = await tgRes.json().catch(() => ({}));
            const photos = tgData?.result?.photo;
            const fileId =
              Array.isArray(photos) && photos.length ? photos[photos.length - 1].file_id : null;
            if (tgRes.ok && fileId) {
              const key = `tg:${fileId}`;
              return json({ key, url: `/api/receipt/${key}`, via: "telegram", notified: hasMeta });
            }
            console.log("telegram upload gagal, fallback KV:", JSON.stringify(tgData).slice(0, 200));
          } catch (e) {
            console.log("telegram upload error, fallback KV:", e?.message || e);
          }
        }

        // --- Jalur 2: KV (fallback) ---
        if (!env.RECEIPTS) {
          return json({ error: "Telegram & KV belum dikonfigurasi — struk tidak bisa disimpan" }, 500);
        }
        const ext =
          (file.name.split(".").pop() || "webp").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) ||
          "webp";
        const key = `kv:receipts/${crypto.randomUUID()}.${ext}`;
        await env.RECEIPTS.put(key, await file.arrayBuffer(), {
          metadata: { contentType: file.type || "image/webp" },
        });
        return json({ key, url: `/api/receipt/${key}`, via: "kv", notified: false });
      }

      // ---------- serve struk ----------
      // Format key: "tg:<file_id>" (Telegram), "kv:..." (KV), atau
      // "receipts/..." polos (KV, format lama). Tanpa login agar <img> bisa
      // tampil — key-nya tak-tertebak (file_id Telegram / uuid).
      if (path.startsWith("/api/receipt/") && request.method === "GET") {
        const key = path.slice("/api/receipt/".length);

        // --- Telegram storage: getFile lalu proxy download (token tetap di server) ---
        const mTg = key.match(/^tg:([A-Za-z0-9_-]{10,200})$/);
        if (mTg) {
          if (!env.TELEGRAM_BOT_TOKEN) return json({ error: "Telegram belum dikonfigurasi" }, 500);
          try {
            const gfRes = await fetch(
              `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(mTg[1])}`
            );
            const gfData = await gfRes.json().catch(() => ({}));
            const filePath = gfData?.result?.file_path;
            if (!gfRes.ok || !filePath) return json({ error: "not found" }, 404);
            const dlRes = await fetch(
              `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`
            );
            if (!dlRes.ok || !dlRes.body) return json({ error: "not found" }, 404);
            const ct = /\.png$/i.test(filePath)
              ? "image/png"
              : /\.webp$/i.test(filePath)
                ? "image/webp"
                : "image/jpeg";
            return new Response(dlRes.body, {
              headers: { "Content-Type": ct, "Cache-Control": "private, max-age=86400" },
            });
          } catch {
            return json({ error: "not found" }, 404);
          }
        }

        // --- KV storage ---
        const mKv = key.match(
          /^(kv:receipts\/[A-Za-z0-9-]+\.[a-z0-9]{1,5}|receipts\/[A-Za-z0-9-]+\.[a-z0-9]{1,5})$/
        );
        if (mKv) {
          if (!env.RECEIPTS) return json({ error: "KV belum dikonfigurasi" }, 500);
          const { value, metadata } = await env.RECEIPTS.getWithMetadata(mKv[1], {
            type: "arrayBuffer",
          });
          if (!value) return json({ error: "not found" }, 404);
          return new Response(value, {
            headers: {
              "Content-Type": metadata?.contentType || "image/webp",
              "Cache-Control": "private, max-age=31536000",
            },
          });
        }

        return json({ error: "not found" }, 404);
      }

      // ---------- tes notifikasi Telegram (diagnosa config) ----------
      if (path === "/api/telegram-test" && request.method === "POST") {
        if (!(await getAuthUser(request, env))) return unauthorized();
        return json(await testTelegram(env));
      }

      // ---------- koleksi transaksi ----------
      if (path === "/api/transactions") {
        if (!(await getAuthUser(request, env))) return unauthorized();

        if (request.method === "GET") {
          const from = url.searchParams.get("from");
          const to = url.searchParams.get("to");
          const type = url.searchParams.get("type");
          const category = url.searchParams.get("category");
          const input_by = url.searchParams.get("input_by");
          const q = url.searchParams.get("q");
          const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 500);
          const offset = parseInt(url.searchParams.get("offset") || "0", 10) || 0;
          const conds = [];
          const params = [];
          if (from && DATE_RE.test(from)) { conds.push("date >= ?"); params.push(from); }
          if (to && DATE_RE.test(to)) { conds.push("date <= ?"); params.push(to); }
          if (type === "in" || type === "out") { conds.push("type = ?"); params.push(type); }
          if (category) { conds.push("category = ?"); params.push(category); }
          if (input_by) { conds.push("input_by = ?"); params.push(input_by); }
          if (q) { conds.push("note LIKE ?"); params.push(`%${q}%`); }
          const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
          const { results } = await env.DB.prepare(
            `SELECT * FROM transactions ${where} ORDER BY date DESC, created_at DESC LIMIT ? OFFSET ?`
          ).bind(...params, limit, offset).all();
          const countRow = await env.DB.prepare(
            `SELECT COUNT(*) AS c FROM transactions ${where}`
          ).bind(...params).first();
          return json({ transactions: results || [], total: countRow?.c ?? 0 });
        }

        if (request.method === "POST") {
          const b = await request.json().catch(() => ({}));
          const date = String(b.date || "").slice(0, 10);
          const type = b.type === "in" ? "in" : "out";
          const category = String(b.category || "Lainnya").slice(0, 80) || "Lainnya";
          const amount = Math.floor(Number(b.amount) || 0);
          const note = String(b.note || "").slice(0, 500);
          const receipt_key = String(b.receipt_key || "").slice(0, 200);
          const input_by = String(b.input_by || "").trim().slice(0, 40);
          if (!DATE_RE.test(date)) return json({ error: "Tanggal tidak valid (YYYY-MM-DD)" }, 400);
          if (amount <= 0) return json({ error: "Nominal harus lebih dari 0" }, 400);
          const tx = {
            id: crypto.randomUUID(),
            date, type, category, amount, note, receipt_key, input_by,
            created_at: new Date().toISOString(),
          };
          await env.DB.prepare(
            "INSERT INTO transactions (id, date, type, category, amount, note, receipt_key, input_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
          ).bind(tx.id, tx.date, tx.type, tx.category, tx.amount, tx.note, tx.receipt_key, tx.input_by, tx.created_at).run();

          // Notif Telegram — dilewati bila upload tadi sudah mengirim foto+caption
          // notifikasi sekali jalan (receipt via Telegram selalu begitu).
          // Fire-and-forget: gagal notif tidak menggagalkan simpan.
          if (b.notified !== true) {
            const mTgKey = tx.receipt_key.match(/^tg:([A-Za-z0-9_-]{10,200})$/);
            if (mTgKey) {
              // Foto sudah ada di Telegram: kirim ulang via file_id + caption
              ctx.waitUntil(sendPhotoByFileId(env, mTgKey[1], txMessage(tx)));
            } else {
              let photoBytes = null;
              if (tx.receipt_key && env.RECEIPTS) {
                try {
                  photoBytes = await env.RECEIPTS.get(tx.receipt_key, { type: "arrayBuffer" });
                } catch { /* abaikan */ }
              }
              ctx.waitUntil(notifyTransaction(env, tx, photoBytes));
            }
          }
          return json({ transaction: tx, telegram: !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) }, 201);
        }

        // Hapus massal: body {ids: [...]} — dipakai checkbox "pilih semua".
        if (request.method === "DELETE") {
          const b = await request.json().catch(() => ({}));
          const ids = Array.isArray(b.ids)
            ? [...new Set(b.ids.filter((x) => typeof x === "string" && x.length <= 64))].slice(0, 200)
            : [];
          if (!ids.length) return json({ error: "Tidak ada yang dipilih" }, 400);
          const ph = ids.map(() => "?").join(",");
          let receipts = [];
          try {
            const r = await env.DB.prepare(`SELECT receipt_key FROM transactions WHERE id IN (${ph})`).bind(...ids).all();
            receipts = (r.results || []).map((x) => x.receipt_key).filter(Boolean);
          } catch { /* abaikan */ }
          await env.DB.prepare(`DELETE FROM transactions WHERE id IN (${ph})`).bind(...ids).run();
          if (env.RECEIPTS) {
            for (const k of receipts) { try { await env.RECEIPTS.delete(k); } catch { /* abaikan */ } }
          }
          return json({ ok: true, deleted: ids.length });
        }

        return json({ error: "method not allowed" }, 405);
      }

      // ---------- tambah borongan: banyak transaksi sekaligus ----------
      // 1 request, 1x insert batch, 1 pesan rekap Telegram (tidak spam).
      if (path === "/api/transactions/batch" && request.method === "POST") {
        if (!(await getAuthUser(request, env))) return unauthorized();
        const b = await request.json().catch(() => ({}));
        const items = Array.isArray(b.items) ? b.items : [];
        if (!items.length) return json({ error: "Tidak ada data" }, 400);
        if (items.length > 50) return json({ error: "Maksimal 50 transaksi sekaligus" }, 400);
        const input_by = String(b.input_by || "").trim().slice(0, 40);
        const txs = [];
        const recapTxs = [];
        for (const it of items) {
          const date = String(it.date || "").slice(0, 10);
          const type = it.type === "in" ? "in" : "out";
          const category = String(it.category || "Lainnya").slice(0, 80) || "Lainnya";
          const amount = Math.floor(Number(it.amount) || 0);
          const note = String(it.note || "").slice(0, 500);
          const receipt_key = String(it.receipt_key || "").slice(0, 200);
          const notified = it.notified === true; // struk sudah ternotifikasi via foto
          if (!DATE_RE.test(date) || amount <= 0) {
            return json({ error: "Ada baris yang tanggal / nominalnya tidak valid" }, 400);
          }
          const tx = {
            id: crypto.randomUUID(),
            date, type, category, amount, note,
            receipt_key,
            input_by,
            created_at: new Date().toISOString(),
          };
          txs.push(tx);
          if (!notified) recapTxs.push(tx);
        }
        const stmt = env.DB.prepare(
          "INSERT INTO transactions (id, date, type, category, amount, note, receipt_key, input_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        );
        await env.DB.batch(
          txs.map((t) => stmt.bind(t.id, t.date, t.type, t.category, t.amount, t.note, t.receipt_key, t.input_by, t.created_at))
        );
        // Rekap teks hanya untuk baris yang belum ternotifikasi via foto (anti dobel)
        if (recapTxs.length) ctx.waitUntil(notifyBatch(env, recapTxs, input_by));
        return json({ count: txs.length, transactions: txs, telegram: !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) }, 201);
      }

      // ---------- satu transaksi: ubah / hapus ----------
      const mTx = path.match(/^\/api\/transactions\/([A-Za-z0-9-]+)$/);
      if (mTx) {
        if (!(await getAuthUser(request, env))) return unauthorized();
        const id = mTx[1];

        if (request.method === "PUT") {
          const b = await request.json().catch(() => ({}));
          const oldRow = await env.DB.prepare("SELECT receipt_key FROM transactions WHERE id = ?").bind(id).first();
          const oldReceiptKey = oldRow?.receipt_key || "";
          const fields = [];
          const params = [];
          const setIf = (col, val, valid) => {
            if (val !== undefined && (!valid || valid(val))) {
              fields.push(`${col} = ?`);
              params.push(val);
            }
          };
          setIf("date", String(b.date || "").slice(0, 10), (v) => DATE_RE.test(v));
          setIf("type", b.type === "in" ? "in" : b.type === "out" ? "out" : undefined);
          setIf("category", String(b.category || "").slice(0, 80), (v) => v.length > 0);
          setIf("amount", Math.floor(Number(b.amount) || 0), (v) => v > 0);
          // note hanya diubah kalau dikirim eksplisit (jangan timpa saat partial update)
          if (b.note !== undefined) {
            fields.push("note = ?");
            params.push(String(b.note).slice(0, 500));
          }
          if (b.receipt_key !== undefined) {
            fields.push("receipt_key = ?");
            params.push(String(b.receipt_key).slice(0, 200));
          }
          if (b.input_by !== undefined) {
            fields.push("input_by = ?");
            params.push(String(b.input_by).trim().slice(0, 40));
          }
          if (!fields.length) return json({ error: "Tidak ada perubahan" }, 400);
          params.push(id);
          await env.DB.prepare(`UPDATE transactions SET ${fields.join(", ")} WHERE id = ?`)
            .bind(...params).run();
          const row = await env.DB.prepare("SELECT * FROM transactions WHERE id = ?").bind(id).first();
          if (!row) return json({ error: "Transaksi tidak ditemukan" }, 404);
          // Bersihkan file struk lama di KV kalau diganti/dihapus — jangan jadi yatim.
          // (Struk Telegram tidak bisa dihapus otomatis; itu keterbatasan API.)
          const newReceiptKey = b.receipt_key !== undefined ? String(b.receipt_key).slice(0, 200) : oldReceiptKey;
          if (oldReceiptKey && oldReceiptKey !== newReceiptKey && oldReceiptKey.startsWith("kv:") && env.RECEIPTS) {
            try { await env.RECEIPTS.delete(oldReceiptKey); } catch { /* abaikan */ }
          }
          return json({ transaction: row });
        }

        if (request.method === "DELETE") {
          const row = await env.DB.prepare("SELECT receipt_key FROM transactions WHERE id = ?")
            .bind(id).first();
          if (!row) return json({ error: "Transaksi tidak ditemukan" }, 404);
          await env.DB.prepare("DELETE FROM transactions WHERE id = ?").bind(id).run();
          if (row?.receipt_key && env.RECEIPTS) {
            try { await env.RECEIPTS.delete(row.receipt_key); } catch { /* abaikan */ }
          }
          return json({ ok: true });
        }

        return json({ error: "method not allowed" }, 405);
      }

      // ---------- hutang & piutang ----------
      if (path === "/api/debts") {
        if (!(await getAuthUser(request, env))) return unauthorized();

        if (request.method === "GET") {
          const status = url.searchParams.get("status");
          const conds = [];
          const params = [];
          if (status === "belum" || status === "lunas") { conds.push("status = ?"); params.push(status); }
          const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
          const { results } = await env.DB.prepare(
            `SELECT * FROM debts ${where} ORDER BY status ASC, due_date ASC, created_at DESC`
          ).bind(...params).all();
          return json({ debts: results || [] });
        }

        if (request.method === "POST") {
          const b = await request.json().catch(() => ({}));
          const type = b.type === "piutang" ? "piutang" : "hutang";
          const person = String(b.person || "").trim().slice(0, 80);
          const amount = Math.floor(Number(b.amount) || 0);
          const start_date = String(b.start_date || "").slice(0, 10);
          const due_date = String(b.due_date || "").slice(0, 10);
          const note = String(b.note || "").slice(0, 500);
          const input_by = String(b.input_by || "").trim().slice(0, 40);
          if (!person) return json({ error: "Nama orang harus diisi" }, 400);
          if (amount <= 0) return json({ error: "Nominal harus lebih dari 0" }, 400);
          if (!DATE_RE.test(start_date)) return json({ error: "Tanggal mulai tidak valid" }, 400);
          if (due_date && !DATE_RE.test(due_date)) return json({ error: "Tenggat tidak valid" }, 400);
          const debt = {
            id: crypto.randomUUID(), type, person, amount, start_date, due_date,
            note, status: "belum", input_by, created_at: new Date().toISOString(),
          };
          await env.DB.prepare(
            "INSERT INTO debts (id, type, person, amount, start_date, due_date, note, status, input_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
          ).bind(debt.id, debt.type, debt.person, debt.amount, debt.start_date, debt.due_date, debt.note, debt.status, debt.input_by, debt.created_at).run();
          ctx.waitUntil(notifyDebt(env, debt));
          return json({ debt, telegram: !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) }, 201);
        }

        return json({ error: "method not allowed" }, 405);
      }

      const mDebt = path.match(/^\/api\/debts\/([A-Za-z0-9-]+)$/);
      if (mDebt) {
        if (!(await getAuthUser(request, env))) return unauthorized();
        const id = mDebt[1];

        if (request.method === "PUT") {
          const b = await request.json().catch(() => ({}));
          const fields = [];
          const params = [];
          const setIf = (col, val, valid) => {
            if (val !== undefined && (!valid || valid(val))) {
              fields.push(`${col} = ?`);
              params.push(val);
            }
          };
          if (b.type === "hutang" || b.type === "piutang") { fields.push("type = ?"); params.push(b.type); }
          setIf("person", String(b.person || "").trim().slice(0, 80), (v) => v.length > 0);
          setIf("amount", Math.floor(Number(b.amount) || 0), (v) => v > 0);
          setIf("start_date", String(b.start_date || "").slice(0, 10), (v) => DATE_RE.test(v));
          if (b.due_date !== undefined) {
            const dv = String(b.due_date || "").slice(0, 10);
            if (dv && !DATE_RE.test(dv)) return json({ error: "Tenggat tidak valid" }, 400);
            fields.push("due_date = ?"); params.push(dv);
          }
          // note hanya diubah kalau dikirim eksplisit (jangan timpa saat partial update,
          // mis. toggle "lunas" yang cuma kirim {status})
          if (b.note !== undefined) {
            fields.push("note = ?");
            params.push(String(b.note).slice(0, 500));
          }
          if (b.status === "lunas" || b.status === "belum") { fields.push("status = ?"); params.push(b.status); }
          if (b.input_by !== undefined) { fields.push("input_by = ?"); params.push(String(b.input_by).trim().slice(0, 40)); }
          if (!fields.length) return json({ error: "Tidak ada perubahan" }, 400);
          params.push(id);
          await env.DB.prepare(`UPDATE debts SET ${fields.join(", ")} WHERE id = ?`).bind(...params).run();
          const row = await env.DB.prepare("SELECT * FROM debts WHERE id = ?").bind(id).first();
          if (!row) return json({ error: "Data hutang tidak ditemukan" }, 404);
          if (b.status === "lunas" && row) ctx.waitUntil(notifyDebtPaid(env, row));
          return json({ debt: row });
        }

        if (request.method === "DELETE") {
          const del = await env.DB.prepare("DELETE FROM debts WHERE id = ?").bind(id).run();
          if (!del.meta.changes) return json({ error: "Data hutang tidak ditemukan" }, 404);
          return json({ ok: true });
        }

        return json({ error: "method not allowed" }, 405);
      }

      // ---------- dokumen (arsip dokumen + foto) ----------
      if (path === "/api/documents") {
        if (!(await getAuthUser(request, env))) return unauthorized();

        if (request.method === "GET") {
          const { results } = await env.DB.prepare(
            "SELECT * FROM documents ORDER BY doc_date DESC, created_at DESC"
          ).all();
          return json({ documents: results || [] });
        }

        if (request.method === "POST") {
          const b = await request.json().catch(() => ({}));
          const title = String(b.title || "").trim().slice(0, 120);
          const category = String(b.category || "").trim().slice(0, 40);
          let doc_date = String(b.doc_date || "").slice(0, 10);
          // Default: hari ini (WIB) kalau tanggal tak valid / tak dikirim.
          if (!DATE_RE.test(doc_date)) {
            doc_date = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
          }
          const note = String(b.note || "").slice(0, 500);
          const photo_key = String(b.photo_key || "").slice(0, 200);
          if (!title) return json({ error: "Judul dokumen harus diisi" }, 400);
          if (!photo_key) return json({ error: "Foto dokumen wajib diunggah" }, 400);
          const doc = {
            id: crypto.randomUUID(),
            title, category, doc_date, note, photo_key,
            created_at: new Date().toISOString(),
          };
          await env.DB.prepare(
            "INSERT INTO documents (id, title, category, doc_date, note, photo_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
          ).bind(doc.id, doc.title, doc.category, doc.doc_date, doc.note, doc.photo_key, doc.created_at).run();
          return json({ document: doc }, 201);
        }

        return json({ error: "method not allowed" }, 405);
      }

      const mDoc = path.match(/^\/api\/documents\/([A-Za-z0-9-]+)$/);
      if (mDoc) {
        if (!(await getAuthUser(request, env))) return unauthorized();
        const id = mDoc[1];

        if (request.method === "DELETE") {
          const row = await env.DB.prepare("SELECT photo_key FROM documents WHERE id = ?")
            .bind(id).first();
          if (!row) return json({ error: "Dokumen tidak ditemukan" }, 404);
          await env.DB.prepare("DELETE FROM documents WHERE id = ?").bind(id).run();
          // Bersihkan foto di KV kalau tersimpan di sana (format kv:...).
          // Foto Telegram (tg:...) tak bisa dihapus via API — keterbatasan yang sama
          // seperti struk transaksi.
          if (row?.photo_key && row.photo_key.startsWith("kv:") && env.RECEIPTS) {
            try { await env.RECEIPTS.delete(row.photo_key); } catch { /* abaikan */ }
          }
          return json({ ok: true });
        }

        return json({ error: "method not allowed" }, 405);
      }

      // ---------- ringkasan bulanan ----------
      if (path === "/api/summary" && request.method === "GET") {
        if (!(await getAuthUser(request, env))) return unauthorized();
        const monthParam = url.searchParams.get("month");
        if (monthParam && !/^\d{4}-\d{2}$/.test(monthParam)) return json({ error: "Bulan tidak valid (YYYY-MM)" }, 400);
        // Default: bulan berjalan WIB (aplikasi Indonesia-only).
        // Frontend selalu kirim month eksplisit, jadi ini jarang kepakai.
        const month = monthParam || new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 7);
        const [y, mo] = month.split("-").map(Number);
        const daysInMonth = new Date(y, mo, 0).getDate();
        const start = `${month}-01`;
        const end = `${month}-${String(daysInMonth).padStart(2, "0")}`;

        const totals = await env.DB.prepare(
          "SELECT type, SUM(amount) AS total FROM transactions WHERE date BETWEEN ? AND ? GROUP BY type"
        ).bind(start, end).all();
        let totalIn = 0, totalOut = 0;
        for (const r of totals.results || []) {
          if (r.type === "in") totalIn = r.total || 0;
          else totalOut = r.total || 0;
        }

        const byCat = await env.DB.prepare(
          "SELECT category, type, SUM(amount) AS total, COUNT(*) AS n FROM transactions WHERE date BETWEEN ? AND ? GROUP BY category, type ORDER BY total DESC"
        ).bind(start, end).all();

        const perDay = await env.DB.prepare(
          "SELECT date, type, SUM(amount) AS total FROM transactions WHERE date BETWEEN ? AND ? GROUP BY date, type"
        ).bind(start, end).all();
        const map = {};
        for (const r of perDay.results || []) {
          (map[r.date] ||= { in: 0, out: 0 })[r.type] = r.total || 0;
        }
        const daily = [];
        for (let d = 1; d <= daysInMonth; d++) {
          const ds = `${month}-${String(d).padStart(2, "0")}`;
          daily.push({ date: ds, in: map[ds]?.in || 0, out: map[ds]?.out || 0 });
        }

        return json({ month, totalIn, totalOut, balance: totalIn - totalOut, byCategory: byCat.results || [], daily });
      }

      if (path.startsWith("/api/")) return json({ error: "not found" }, 404);

      // ---------- selain /api/* → frontend statis ----------
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.log("worker error:", e?.stack || e?.message || e);
      return json({ error: "Terjadi kesalahan server" }, 500);
    }
  },
};
