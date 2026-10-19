// Notifikasi Telegram: teks untuk tiap transaksi, foto bila ada struk.
// Diam-diam dilewati kalau TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID kosong.

export function formatIDR(n) {
  return "Rp" + Number(n || 0).toLocaleString("id-ID");
}

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function txMessage(tx) {
  const isIn = tx.type === "in";
  const emoji = isIn ? "💰" : "💸";
  const label = isIn ? "UANG MASUK" : "UANG KELUAR";
  const lines = [
    `${emoji} <b>${label}</b>`,
    `Nominal : <b>${formatIDR(tx.amount)}</b>`,
    `Kategori: ${escapeHtml(tx.category)}`,
    `Tanggal : ${escapeHtml(tx.date)}`,
  ];
  if (tx.note) lines.push(`Catatan : ${escapeHtml(tx.note)}`);
  return lines.join("\n");
}

async function tgSend(env, method, body, isForm) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { skipped: true };
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const res = await fetch(
    url,
    isForm
      ? { method: "POST", body }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, ...body }),
        }
  );
  if (!res.ok) console.log("telegram error:", method, await res.text().catch(() => ""));
  return { ok: res.ok };
}

// Kirim notif transaksi. photoBytes = ArrayBuffer struk (opsional).
// Tidak pernah melempar error — kegagalan notif tidak menggagalkan pencatatan.
export async function notifyTransaction(env, tx, photoBytes) {
  try {
    const caption = txMessage(tx);
    if (photoBytes) {
      const form = new FormData();
      form.append("chat_id", env.TELEGRAM_CHAT_ID);
      form.append("caption", caption);
      form.append("parse_mode", "HTML");
      form.append("photo", new Blob([photoBytes], { type: "image/jpeg" }), "struk.jpg");
      await tgSend(env, "sendPhoto", form, true);
    } else {
      await tgSend(env, "sendMessage", { text: caption, parse_mode: "HTML" });
    }
  } catch (e) {
    console.log("notify failed:", e?.message || e);
  }
}
