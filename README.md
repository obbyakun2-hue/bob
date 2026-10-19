# 💰 Uang Tracker

Aplikasi pencatatan uang masuk & keluar ala "catatan keuangan profesional":
dashboard ringkasan bulanan, grafik arus kas harian, breakdown per kategori,
filter transaksi, export CSV, **mode borongan** (banyak transaksi sekaligus),
upload foto struk (WebP otomatis; disimpan di
Telegram dengan fallback KV), dan notifikasi Telegram otomatis setiap ada
transaksi baru. Tampilan premium dengan **dark mode**.

**Stack:** Cloudflare Workers + D1 (database) + Telegram (penyimpanan struk
utama, gratis tanpa kartu kredit) + KV (fallback otomatis) + Telegram Bot API.
Frontend vanilla HTML/CSS/JS, tanpa build step.

> Foto struk disimpan di **KV** (bukan R2) supaya tetap bisa jalan di free tier
> **tanpa kartu kredit** — R2 mewajibkan payment method meski ada free tier-nya.

**Login:** 1 user saja (tanpa fitur register), pakai JWT.

---

## 1. Upload ke GitHub

1. Ekstrak `uang-tracker.zip`, lalu buat repository baru di GitHub (jangan centang "Add a README").
2. Upload semua file hasil ekstrak via web GitHub, **atau** via git:
   ```bash
   cd uang-tracker
   git init -b main
   git add .
   git commit -m "init uang-tracker"
   git remote add origin https://github.com/USERNAME/NAMA-REPO.git
   git push -u origin main
   ```

## 2. Isi GitHub Secrets

Buka repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Wajib | Keterangan |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | ✅ | Token API Cloudflare (butuh akses Workers, D1, KV) |
| `CLOUDFLARE_ACCOUNT_ID` | ✅ | Account ID Cloudflare |
| `JWT_SECRET` | ✅ | String acak panjang untuk tanda tangan JWT & proteksi endpoint init. **Jangan mengandung `? % # / \`** |
| `ADMIN_USERNAME` | ✅ | Username login (1 user) |
| `ADMIN_PASSWORD` | ✅ | Password login |
| `TELEGRAM_BOT_TOKEN` | ⚪ | Token bot Telegram — kosongkan = notif mati |
| `TELEGRAM_CHAT_ID` | ⚪ | Chat ID tujuan notif — kosongkan = notif mati |
| `D1_DATABASE_ID` | ⚪ | ID database D1 — kosongkan = dibuat otomatis |
| `KV_NAMESPACE_ID` | ⚪ | ID KV namespace untuk fallback struk — kosongkan = dibuat otomatis; kalau auto-create bermasalah, isi manual dari dashboard Cloudflare (Workers & Pages → KV) |
| `NAME` | ⚪ | Nama worker & database (default: `uang-tracker`) |

> Semua konfigurasi **hanya** dari Secrets — tidak ada secret yang di-hardcode di repo.

## 3. Deploy

Setiap `push` ke branch `main` yang menyentuh `worker/**` atau `web/**`
otomatis menjalankan workflow **Deploy uang-tracker to Cloudflare Workers**.
Bisa juga dijalankan manual via tab **Actions → workflow_dispatch**.

Alur workflow (diambil dari pola cloud-mail, versi ramping):
1. Checkout → setup pnpm + Node → `pnpm install --frozen-lockfile`
2. Validasi secrets → substitusi placeholder di `worker/wrangler-action.toml`
3. Cek/buat KV namespace & database D1 (pakai secret kalau diisi, kalau tidak cari berdasarkan nama, kalau belum ada dibuatkan otomatis)
4. `wrangler deploy` → dapat URL `https://<nama>.workers.dev`
5. Panggil `/api/init/<JWT_SECRET>` → buat tabel + seed 14 kategori default

Setelah deploy sukses, buka URL workers.dev → login dengan `ADMIN_USERNAME` /
`ADMIN_PASSWORD` → langsung bisa mencatat.

## 4. Struktur project

```
uang-tracker/
├── .github/workflows/deploy.yml   # CI/CD (pola cloud-mail versi ramping)
├── worker/
│   ├── wrangler-action.toml       # template, placeholder ${...} diisi CI
│   ├── package.json
│   ├── pnpm-lock.yaml
│   └── src/
│       ├── index.js               # router API + serve frontend
│       ├── db.js                  # skema D1 + seed kategori
│       ├── auth.js                # JWT HS256 + cek password (1 user)
│       └── telegram.js            # notif transaksi (teks/foto)
├── web/
│   ├── index.html
│   ├── styles.css
│   └── app.js                     # dashboard, grafik, filter, form, export CSV
└── README.md
```

## 5. Endpoint API

| Method & Path | Auth | Fungsi |
|---|---|---|
| `POST /api/login` | — | Login → JWT (7 hari) |
| `GET /api/health` | — | Cek worker hidup |
| `GET /api/init/<JWT_SECRET>` | secret URL | Buat tabel + seed (dipakai workflow) |
| `GET /api/categories` | ✅ | Daftar kategori |
| `GET /api/transactions?from&to&type&category&q&limit&offset` | ✅ | List + filter |
| `POST /api/transactions` | ✅ | Tambah 1 transaksi (+ notif Telegram) |
| `POST /api/transactions/batch` | ✅ | Tambah borongan (maks 50, tanpa struk) → 1 pesan rekap Telegram |
| `PUT /api/transactions/:id` | ✅ | Ubah |
| `DELETE /api/transactions/:id` | ✅ | Hapus (+ hapus struk di KV) |
| `GET /api/summary?month=YYYY-MM` | ✅ | Total masuk/keluar/saldo, per kategori, harian |
| `POST /api/upload` | ✅ | Upload struk (maks 5MB, browser kompres ke WebP dulu). Coba Telegram dulu → `tg:<file_id>`; fallback KV → `kv:...`. Terima meta transaksi (date/type/category/amount/note): kalau via Telegram, foto + caption notif dikirim sekali jalan |
| `GET /api/receipt/<key>` | — | Lihat struk (URL tak-tertebak). Key `tg:<file_id>` → proxy `getFile` Telegram (token tetap di server); key `kv:...` → KV |

## 6. Catatan

- Nominal disimpan sebagai **integer Rupiah** di D1.
- Foto struk selalu dikompres ke **WebP** (maks 1280px, kualitas 75, orientasi EXIF dikoreksi) di browser sebelum upload — rata-rata 50-150KB per struk.
- **Penyimpanan struk hybrid (jaga-jaga):** upload mencoba **Telegram dulu** — foto dikirim via `sendPhoto` ke chat Telegram; kalau meta transaksi disertakan, caption notifikasi ikut terkirim **sekali jalan** (tidak ada pesan ganda). `file_id` yang dikembalikan disimpan di D1 sebagai `receipt_key` format `tg:<file_id>`; saat ditampilkan, Worker proxy via `getFile` (token bot tidak bocor ke browser). Kalau Telegram tidak dikonfigurasi/gagal → otomatis fallback ke **KV** (`kv:...`). Tidak perlu secret tambahan.
- ⚠️ Jangan hapus pesan struk di Telegram — `file_id` ikut mati kalau pesannya dihapus, dan struknya tidak bisa ditampilkan lagi. `file_id` juga terikat ke bot pengupload (ganti bot = struk lama hilang).
- Notifikasi Telegram dikirim *fire-and-forget*: kalau gagal, transaksi tetap tersimpan.
- Tanpa `CUSTOM_DOMAIN`, app jalan di `https://<nama>.workers.dev`. Custom domain bisa ditambahkan nanti via route di `wrangler-action.toml`.
