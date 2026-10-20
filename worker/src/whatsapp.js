// Notifikasi WhatsApp via Cloud API resmi (Meta).
// Dipakai untuk mengirim foto dokumen + keterangannya ke nomor WA user
// setiap ada dokumen baru. Fire-and-forget: gagal kirim tidak
// menggagalkan penyimpanan dokumen.
//
// Konfigurasi (via wrangler secret, terenkripsi):
//   WHATSAPP_TOKEN           — token permanen (System User, jangan yang 24 jam)
//   WHATSAPP_PHONE_NUMBER_ID — Phone Number ID dari nomor pengirim (dashboard Meta)
//   WHATSAPP_TO              — nomor WA tujuan, format internasional tanpa "+"
//                              (cth: 6281234567890)
//
// Catatan Meta: pesan bebas (termasuk gambar) hanya bisa dikirim dalam
// 24 jam setelah penerima chat ke nomor bisnis. Di luar itu perlu message
// template yang disetujui. Kegagalan karena itu tercatat di log worker.

const GRAPH_VERSION = "v21.0";

export function waConfigured(env) {
  return !!(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_TO);
}

function waCaption(doc) {
  const lines = [`📄 ${doc.title}`];
  if (doc.category) lines.push(`Jenis: ${doc.category}`);
  lines.push(`Tanggal: ${doc.doc_date}`);
  if (doc.note) lines.push(`Catatan: ${doc.note}`);
  // Caption gambar WhatsApp maksimal 1024 karakter.
  return lines.join("\n").slice(0, 1024);
}

export async function sendWhatsAppDoc(env, doc, photoUrl) {
  if (!waConfigured(env)) return { ok: false, skipped: true };
  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: env.WHATSAPP_TO,
          type: "image",
          image: { link: photoUrl, caption: waCaption(doc) },
        }),
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // 131047 = perlu message template (di luar jendela 24 jam).
      console.log("whatsapp kirim gagal:", res.status, JSON.stringify(data).slice(0, 300));
      return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
    }
    return { ok: true, id: data?.messages?.[0]?.id || "" };
  } catch (e) {
    console.log("whatsapp error:", e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}
