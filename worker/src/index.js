// Uang Tracker — Cloudflare Worker
// API pencatatan uang masuk/keluar + serve frontend statis (via [assets]).

import { initDb } from "./db.js";
import { createToken, getAuthUser, unauthorized, checkPassword } from "./auth.js";
import { notifyTransaction } from "./telegram.js";

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
        await initDb(env.DB);
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

      // ---------- upload struk ke R2 ----------
      if (path === "/api/upload" && request.method === "POST") {
        if (!(await getAuthUser(request, env))) return unauthorized();
        if (!env.BUCKET) return json({ error: "R2 belum dikonfigurasi" }, 500);
        const form = await request.formData().catch(() => null);
        const file = form ? form.get("file") : null;
        if (!file || typeof file === "string") return json({ error: "File tidak ditemukan" }, 400);
        if (file.size > 5 * 1024 * 1024) return json({ error: "Ukuran file maksimal 5MB" }, 400);
        const ext =
          (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) ||
          "jpg";
        const key = `receipts/${crypto.randomUUID()}.${ext}`;
        await env.BUCKET.put(key, file.stream(), {
          httpMetadata: { contentType: file.type || "image/jpeg" },
        });
        return json({ key, url: `/api/receipt/${key}` });
      }

      // ---------- serve struk (URL tak-tertebak, tanpa login agar <img> bisa tampil) ----------
      if (path.startsWith("/api/receipt/") && request.method === "GET") {
        if (!env.BUCKET) return json({ error: "R2 belum dikonfigurasi" }, 500);
        const key = path.slice("/api/receipt/".length);
        if (!/^receipts\/[A-Za-z0-9-]+\.[a-z0-9]{1,5}$/.test(key)) {
          return json({ error: "not found" }, 404);
        }
        const obj = await env.BUCKET.get(key);
        if (!obj) return json({ error: "not found" }, 404);
        return new Response(obj.body, {
          headers: {
            "Content-Type": obj.httpMetadata?.contentType || "image/jpeg",
            "Cache-Control": "public, max-age=31536000",
          },
        });
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

          // Notif Telegram (async, fire-and-forget — gagal notif tidak menggagalkan simpan)
          let photoBytes = null;
          if (tx.receipt_key && env.BUCKET) {
            try {
              const obj = await env.BUCKET.get(tx.receipt_key);
              if (obj) photoBytes = await obj.arrayBuffer();
            } catch { /* abaikan */ }
          }
          notifyTransaction(env, tx, photoBytes).catch(() => {});
          return json({ transaction: tx }, 201);
        }

        return json({ error: "method not allowed" }, 405);
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
          if (row?.receipt_key && env.BUCKET) {
            try { await env.BUCKET.delete(row.receipt_key); } catch { /* abaikan */ }
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
