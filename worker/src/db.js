// Skema & seed database D1 untuk app catatan uang.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('in', 'out')),
  category TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  note TEXT NOT NULL DEFAULT '',
  receipt_key TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions (date);
CREATE INDEX IF NOT EXISTS idx_tx_type ON transactions (type);
CREATE TABLE IF NOT EXISTS categories (
  name TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('in', 'out'))
);
`;

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
  ["Lainnya (Keluar)", "out"],
];

export async function initDb(db) {
  if (!db || typeof db.exec !== "function") {
    throw new Error("D1 binding (DB) tidak tersedia — cek database_id di konfigurasi worker");
  }
  await db.exec(SCHEMA);
  const row = await db.prepare("SELECT COUNT(*) AS c FROM categories").first();
  if (!row || row.c === 0) {
    // Satu statement multi-VALUES (tanpa batch) — pola paling aman di semua runtime.
    const placeholders = DEFAULT_CATEGORIES.map(() => "(?, ?)").join(", ");
    const params = DEFAULT_CATEGORIES.flat();
    await db
      .prepare(`INSERT OR IGNORE INTO categories (name, type) VALUES ${placeholders}`)
      .bind(...params)
      .run();
  }
}
