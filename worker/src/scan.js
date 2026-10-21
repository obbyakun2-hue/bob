// Scan struk: prompt untuk model vision + parser hasil yang defensif.
// Dipisah dari index.js supaya logika parse bisa diuji sendiri.

// Metode pembayaran kanonis (dipakai struk, form, dan validasi server).
export const PAYMENT_METHODS = [
  "Cash", "QRIS", "ShopeePay", "GoPay", "OVO", "DANA",
  "Transfer Bank", "Kartu Debit", "Kartu Kredit", "Lainnya",
];

export function matchPayment(raw) {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  const exact = PAYMENT_METHODS.find((p) => p.toLowerCase() === s);
  if (exact) return exact;
  if (/tunai|cash|kontan/.test(s)) return "Cash";
  if (/qris/.test(s)) return "QRIS";
  if (/shopee/.test(s)) return "ShopeePay";
  if (/gopay|go-pay/.test(s)) return "GoPay";
  if (/\bovo\b/.test(s)) return "OVO";
  if (/dana/.test(s)) return "DANA";
  if (/debit/.test(s)) return "Kartu Debit";
  if (/kredit|credit|\bcc\b/.test(s)) return "Kartu Kredit";
  if (/transfer|bank|bca|bri|mandiri|bni/.test(s)) return "Transfer Bank";
  return null;
}

export function buildScanPrompt(catNames) {
  return [
    "Kamu adalah mesin pembaca struk belanja Indonesia. Lihat foto struk ini dan ekstrak SEMUA datanya.",
    'Balas HANYA dengan JSON valid tanpa teks lain, format persis:',
    '{"amount": 123456, "date": "YYYY-MM-DD", "merchant": "Nama Toko", "category": "Kategori", "payment": "Cash", "items": [{"name": "Nama barang", "qty": 1, "price": 12000}]}',
    "Aturan:",
    "- items = SEMUA barang yang dibeli, satu objek per baris barang di struk. name = nama barang seperti tertulis. qty = jumlahnya. price = HARGA TOTAL baris itu (qty x harga satuan, sesudah diskon baris bila ada). Jika struk tidak merinci barang, isi [].",
    "- amount = TOTAL yang dibayar pembeli (GRAND TOTAL / TOTAL BAYAR, setelah diskon & pajak). Angka saja tanpa titik/koma/Rp. Jika tidak ditemukan isi 0.",
    "- date = tanggal transaksi pada struk, format YYYY-MM-DD. Jika tidak ada isi null.",
    '- merchant = nama toko/merchant pada struk. Jika tidak jelas isi "".',
    `- category = pilih SATU yang paling cocok dari daftar ini: ${catNames.join(", ")}. Jika tidak ada yang cocok isi "".`,
    `- payment = metode pembayaran yang tertulis di struk, pilih SATU dari: ${PAYMENT_METHODS.join(", ")}. TUNAI berarti Cash, DEBIT berarti Kartu Debit. Jika tidak tertulis isi "Cash".`,
  ].join("\n");
}

function parseAmount(v) {
  if (typeof v === "string") v = Number(v.replace(/[^\d]/g, ""));
  v = Math.floor(Number(v) || 0);
  return v > 0 && v < 1e12 ? v : 0;
}

function parseItems(raw) {
  if (!Array.isArray(raw)) return [];
  const items = [];
  for (const it of raw.slice(0, 50)) {
    if (!it || typeof it !== "object") continue;
    const name = typeof it.name === "string" ? it.name.trim().slice(0, 80) : "";
    const price = parseAmount(it.price);
    if (!name || !price) continue;
    let qty = Math.floor(Number(it.qty) || 1);
    if (qty < 1) qty = 1;
    if (qty > 999) qty = 999;
    items.push({ name, qty, price });
  }
  return items;
}

// Ambil JSON pertama dari teks respons AI lalu validasi ketat.
// Mengembalikan {amount, date, merchant, category, payment, items} atau null.
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
  const items = parseItems(obj.items);
  const itemsTotal = items.reduce((a, it) => a + it.price, 0);
  // amount: dari total struk; bila kosong, pakai jumlah rincian item.
  let amount = parseAmount(obj.amount);
  if (!amount) amount = itemsTotal;
  if (!amount) return null;
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
  const payment = matchPayment(obj.payment);
  return { amount, date, merchant, category, payment, items };
}
