// Uang Tracker — Cloudflare Worker
// API pencatatan uang masuk/keluar + serve frontend statis (via [assets]).

import { initDb } from "./db.js";
import { createToken, getAuthUser, unauthorized, checkPassword } from "./auth.js";
import { notifyTransaction, notifyBatch, txMessage, sendPhotoByFileId } from "./telegram.js";

const json = (data, status = 200) => Response.json(data, { status });
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default {
  async fetch(request, env) {
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
        const body = await request.json().catch(() => ({}));
        const username = String(body.username || "").trim();
        const password = String(body.password || "");
        if (
          username &&
          username === env.ADMIN_USERNAME &&
          (await checkPassword(password, env.ADMIN_PASSWORD))
        ) {
          return json({ token: await createToken(username, env.JWT_SECRET) });
        }
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
        if (file.size > 5 * 1024 * 1024) return json({ error: "Ukuran file maksimal 5MB" }, 400);

        const meta = {
          date: String(form.get("date") || "").slice(0, 10),
          type: form.get("type") === "in" ? "in" : "out",
          category: String(form.get("category") || "").slice(0, 80),
          amount: Math.floor(Number(form.get("amount")) || 0),
          note: String(form.get("note") || "").slice(0, 500),
        };
        const hasMeta = meta.amount > 0 && DATE_RE.test(meta.date);

        // --- Jalur 1: Telegram ---
        if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
          try {
            const bytes = await file.arrayBuffer();
            const tgForm = new FormData();
            tgForm.append("chat_id", env.TELEGRAM_CHAT_ID);
            tgForm.append("caption", hasMeta ? txMessage(meta) : "🧾 Struk");
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
              headers: { "Content-Type": ct, "Cache-Control": "public, max-age=86400" },
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
              "Cache-Control": "public, max-age=31536000",
            },
          });
        }

        return json({ error: "not found" }, 404);
      }

      // ---------- koleksi transaksi ----------
      if (path === "/api/transactions") {
        if (!(await getAuthUser(request, env))) return unauthorized();

        if (request.method === "GET") {
          const from = url.searchParams.get("from");
          const to = url.searchParams.get("to");
          const type = url.searchParams.get("type");
          const category = url.searchParams.get("category");
          const q = url.searchParams.get("q");
          const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 500);
          const offset = parseInt(url.searchParams.get("offset") || "0", 10) || 0;
          const conds = [];
          const params = [];
          if (from && DATE_RE.test(from)) { conds.push("date >= ?"); params.push(from); }
          if (to && DATE_RE.test(to)) { conds.push("date <= ?"); params.push(to); }
          if (type === "in" || type === "out") { conds.push("type = ?"); params.push(type); }
          if (category) { conds.push("category = ?"); params.push(category); }
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
          if (!DATE_RE.test(date)) return json({ error: "Tanggal tidak valid (YYYY-MM-DD)" }, 400);
          if (amount <= 0) return json({ error: "Nominal harus lebih dari 0" }, 400);
          const tx = {
            id: crypto.randomUUID(),
            date, type, category, amount, note, receipt_key,
            created_at: new Date().toISOString(),
          };
          await env.DB.prepare(
            "INSERT INTO transactions (id, date, type, category, amount, note, receipt_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
          ).bind(tx.id, tx.date, tx.type, tx.category, tx.amount, tx.note, tx.receipt_key, tx.created_at).run();

          // Notif Telegram — dilewati bila upload tadi sudah mengirim foto+caption
          // notifikasi sekali jalan (receipt via Telegram selalu begitu).
          // Fire-and-forget: gagal notif tidak menggagalkan simpan.
          if (b.notified !== true) {
            const mTgKey = tx.receipt_key.match(/^tg:([A-Za-z0-9_-]{10,200})$/);
            if (mTgKey) {
              // Foto sudah ada di Telegram: kirim ulang via file_id + caption
              sendPhotoByFileId(env, mTgKey[1], txMessage(tx)).catch(() => {});
            } else {
              let photoBytes = null;
              if (tx.receipt_key && env.RECEIPTS) {
                try {
                  photoBytes = await env.RECEIPTS.get(tx.receipt_key, { type: "arrayBuffer" });
                } catch { /* abaikan */ }
              }
              notifyTransaction(env, tx, photoBytes).catch(() => {});
            }
          }
          return json({ transaction: tx }, 201);
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
        const txs = [];
        for (const it of items) {
          const date = String(it.date || "").slice(0, 10);
          const type = it.type === "in" ? "in" : "out";
          const category = String(it.category || "Lainnya").slice(0, 80) || "Lainnya";
          const amount = Math.floor(Number(it.amount) || 0);
          const note = String(it.note || "").slice(0, 500);
          if (!DATE_RE.test(date) || amount <= 0) {
            return json({ error: "Ada baris yang tanggal / nominalnya tidak valid" }, 400);
          }
          txs.push({
            id: crypto.randomUUID(),
            date, type, category, amount, note,
            receipt_key: "",
            created_at: new Date().toISOString(),
          });
        }
        const stmt = env.DB.prepare(
          "INSERT INTO transactions (id, date, type, category, amount, note, receipt_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        );
        await env.DB.batch(
          txs.map((t) => stmt.bind(t.id, t.date, t.type, t.category, t.amount, t.note, t.receipt_key, t.created_at))
        );
        notifyBatch(env, txs).catch(() => {});
        return json({ count: txs.length, transactions: txs }, 201);
      }

      // ---------- satu transaksi: ubah / hapus ----------
      const mTx = path.match(/^\/api\/transactions\/([A-Za-z0-9-]+)$/);
      if (mTx) {
        if (!(await getAuthUser(request, env))) return unauthorized();
        const id = mTx[1];

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
          setIf("date", String(b.date || "").slice(0, 10), (v) => DATE_RE.test(v));
          setIf("type", b.type === "in" ? "in" : b.type === "out" ? "out" : undefined);
          setIf("category", String(b.category || "").slice(0, 80), (v) => v.length > 0);
          setIf("amount", Math.floor(Number(b.amount) || 0), (v) => v > 0);
          setIf("note", String(b.note ?? "").slice(0, 500));
          setIf("receipt_key", String(b.receipt_key ?? "").slice(0, 200));
          if (!fields.length) return json({ error: "Tidak ada perubahan" }, 400);
          params.push(id);
          await env.DB.prepare(`UPDATE transactions SET ${fields.join(", ")} WHERE id = ?`)
            .bind(...params).run();
          const row = await env.DB.prepare("SELECT * FROM transactions WHERE id = ?").bind(id).first();
          return json({ transaction: row });
        }

        if (request.method === "DELETE") {
          const row = await env.DB.prepare("SELECT receipt_key FROM transactions WHERE id = ?")
            .bind(id).first();
          await env.DB.prepare("DELETE FROM transactions WHERE id = ?").bind(id).run();
          if (row?.receipt_key && env.RECEIPTS) {
            try { await env.RECEIPTS.delete(row.receipt_key); } catch { /* abaikan */ }
          }
          return json({ ok: true });
        }

        return json({ error: "method not allowed" }, 405);
      }

      // ---------- ringkasan bulanan ----------
      if (path === "/api/summary" && request.method === "GET") {
        if (!(await getAuthUser(request, env))) return unauthorized();
        const month = url.searchParams.get("month") || new Date().toISOString().slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(month)) return json({ error: "Bulan tidak valid (YYYY-MM)" }, 400);
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
