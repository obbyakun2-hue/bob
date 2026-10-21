// Scan struk: prompt untuk model vision + parser hasil yang defensif.
// Dipisah dari index.js supaya logika parse bisa diuji sendiri.

export function buildScanPrompt(catNames) {
  return [
    "Kamu adalah mesin pembaca struk belanja Indonesia. Lihat foto struk ini dan ekstrak datanya.",
    'Balas HANYA dengan JSON valid tanpa teks lain, format persis:',
    '{"amount": 123456, "date": "YYYY-MM-DD", "merchant": "Nama Toko", "category": "Kategori"}',
    "Aturan:",
    "- amount = TOTAL yang dibayar pembeli (setelah diskon & pajak; biasanya bertuliskan TOTAL, GRAND TOTAL, TOTAL BAYAR, atau JUMLAH). Angka saja tanpa titik, koma, atau Rp. Jika tidak ditemukan isi 0.",
    "- date = tanggal transaksi pada struk, format YYYY-MM-DD. Jika tidak ada isi null.",
    '- merchant = nama toko/merchant pada struk. Jika tidak jelas isi "".',
    `- category = pilih SATU yang paling cocok dari daftar ini: ${catNames.join(", ")}. Jika tidak ada yang cocok isi "".`,
  ].join("\n");
}

// Ambil JSON pertama dari teks respons AI lalu validasi ketat.
// Mengembalikan {amount, date, merchant, category} atau null bila tak layak.
export function parseScanResult(text, catNames) {
  if (!text || typeof text !== "string") return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let obj;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  // amount: terima angka atau string berformat "Rp 52.000"
  let amount = obj.amount;
  if (typeof amount === "string") amount = Number(amount.replace(/[^\d]/g, ""));
  amount = Math.floor(Number(amount) || 0);
  if (!amount || amount <= 0 || amount >= 1e12) return null;
  // date: format ketat + tanggal beneran + rentang wajar
  let date = null;
  if (typeof obj.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(obj.date)) {
    const d = new Date(obj.date + "T00:00:00Z");
    const year = d.getUTCFullYear();
    if (!Number.isNaN(d.getTime()) && year >= 2020 && year <= new Date().getUTCFullYear() + 1) {
      date = obj.date;
    }
  }
  // category: harus salah satu kategori pengeluaran yang ada (case-insensitive)
  let category = null;
  if (typeof obj.category === "string") {
    const found = (catNames || []).find((c) => c.toLowerCase() === obj.category.trim().toLowerCase());
    if (found) category = found;
  }
  const merchant = typeof obj.merchant === "string" ? obj.merchant.trim().slice(0, 80) : "";
  return { amount, date, merchant, category };
}
