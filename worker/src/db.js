// Skema & seed database D1 untuk app catatan uang.

// Satu statement per exec(), dan semuanya SINGLE-LINE (tanpa newline).
// Ditemukan 2026-10-20: newline di dalam string SQL tampaknya hilang dalam
// perjalanan ke parser D1 ("incomplete input" selalu menunjuk baris pertama).
const SCHEMA_STATEMENTS = [
  "CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, date TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('in', 'out')), category TEXT NOT NULL, amount INTEGER NOT NULL CHECK (amount >= 0), note TEXT NOT NULL DEFAULT '', receipt_key TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions (date)",
  "CREATE INDEX IF NOT EXISTS idx_tx_type ON transactions (type)",
  "CREATE TABLE IF NOT EXISTS categories (name TEXT PRIMARY KEY, type TEXT NOT NULL CHECK (type IN ('in', 'out')))",
  "CREATE TABLE IF NOT EXISTS inputters (name TEXT PRIMARY KEY)",
  "CREATE TABLE IF NOT EXISTS debts (id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK (type IN ('hutang', 'piutang')), person TEXT NOT NULL, amount INTEGER NOT NULL CHECK (amount >= 0), start_date TEXT NOT NULL, due_date TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'belum', input_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', doc_date TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', photo_key TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_doc_date ON documents (doc_date)",
];

const DEFAULT_CATEGORIES = [
  ["Gaji", "in"],
  ["Bonus", "in"],
  ["Usaha / Freelance", "in"],
  ["Hadiah", "in"],
  ["Lainnya (Masuk)", "in"],
  ["Makan & Minum", "out"],
  ["Transport / Bensin", "out"],
  ["Belanja", "out"],
  ["Tagihan & Listrik", "out"],
  ["Pulsa & Kuota", "out"],
  ["Kesehatan", "out"],
  ["Hiburan & Game", "out"],
  ["Tabungan", "out"],
  ["Vape", "out"],
  ["Lainnya (Keluar)", "out"],
];

// Nama penginput awal — bisa ditambah/dihapus dari aplikasi.
const DEFAULT_INPUTTERS = ["Bobby", "Killa", "kita"];

export async function initDb(db) {
  if (!db || typeof db.exec !== "function") {
    throw new Error("D1 binding (DB) tidak tersedia — cek database_id di konfigurasi worker");
  }
  for (let i = 0; i < SCHEMA_STATEMENTS.length; i++) {
    try {
      await db.exec(SCHEMA_STATEMENTS[i]);
    } catch (e) {
      throw new Error(`schema statement #${i + 1} gagal: ${e?.message || e}`);
    }
  }
  // Seed kategori default SELALU dijalankan dengan INSERT OR IGNORE —
  // idempoten (tak ada duplikat), dan kategori default baru otomatis
  // masuk ke database lama setiap init dipanggil (mis. habis deploy).
  const placeholders = DEFAULT_CATEGORIES.map(() => "(?, ?)").join(", ");
  const params = DEFAULT_CATEGORIES.flat();
  await db
    .prepare(`INSERT OR IGNORE INTO categories (name, type) VALUES ${placeholders}`)
    .bind(...params)
    .run();

  // Migrasi: kolom input_by untuk database yang dibuat sebelum fitur ini ada.
  const cols = await db.prepare("PRAGMA table_info(transactions)").all();
  const hasInputBy = (cols.results || []).some((c) => c.name === "input_by");
  if (!hasInputBy) {
    await db.exec("ALTER TABLE transactions ADD COLUMN input_by TEXT NOT NULL DEFAULT ''");
  }

  // Migrasi: kolom owner (bobby/killa/kita) — pemisahan keuangan per orang.
  // Data lama ditebak dari input_by: "Bobby"→bobby, "Killa"→killa, sisanya→kita.
  const hasOwner = (cols.results || []).some((c) => c.name === "owner");
  if (!hasOwner) {
    await db.exec("ALTER TABLE transactions ADD COLUMN owner TEXT NOT NULL DEFAULT 'kita'");
    await db.exec("UPDATE transactions SET owner = 'bobby' WHERE LOWER(TRIM(input_by)) = 'bobby'");
    await db.exec("UPDATE transactions SET owner = 'killa' WHERE LOWER(TRIM(input_by)) = 'killa'");
  }
  const dCols = await db.prepare("PRAGMA table_info(debts)").all();
  const hasDebtOwner = (dCols.results || []).some((c) => c.name === "owner");
  if (!hasDebtOwner) {
    await db.exec("ALTER TABLE debts ADD COLUMN owner TEXT NOT NULL DEFAULT 'kita'");
    await db.exec("UPDATE debts SET owner = 'bobby' WHERE LOWER(TRIM(input_by)) = 'bobby'");
    await db.exec("UPDATE debts SET owner = 'killa' WHERE LOWER(TRIM(input_by)) = 'killa'");
  }

  // Migrasi: kolom owner untuk dokumen (bobby/killa — dokumen itu pribadi).
  // Dokumen lama dianggap milik Bobby (pemilik akun).
  const docCols = await db.prepare("PRAGMA table_info(documents)").all();
  const hasDocOwner = (docCols.results || []).some((c) => c.name === "owner");
  if (!hasDocOwner) {
    await db.exec("ALTER TABLE documents ADD COLUMN owner TEXT NOT NULL DEFAULT 'bobby'");
  }

  // Seed penginput default — idempoten seperti kategori.
  const ipPlaceholders = DEFAULT_INPUTTERS.map(() => "(?)").join(", ");
  await db
    .prepare(`INSERT OR IGNORE INTO inputters (name) VALUES ${ipPlaceholders}`)
    .bind(...DEFAULT_INPUTTERS)
    .run();
}
