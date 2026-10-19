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
  if (tx.input_by) lines.push(`👤 Input oleh: ${escapeHtml(tx.input_by)}`);
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

// Rekap banyak transaksi dalam 1 pesan (mode borongan) — anti spam.
export function batchMessage(txs, inputBy) {
  const lines = [`🧾 <b>${txs.length} TRANSAKSI BARU (BORONGAN)</b>`];
  if (inputBy) lines.push(`👤 Diinput oleh: ${escapeHtml(inputBy)}`);
  lines.push("");
  let totalIn = 0,
    totalOut = 0;
  for (const tx of txs) {
    const emoji = tx.type === "in" ? "💰" : "💸";
    const sign = tx.type === "in" ? "+" : "-";
    if (tx.type === "in") totalIn += tx.amount;
    else totalOut += tx.amount;
    lines.push(
      `${emoji} ${sign}${formatIDR(tx.amount)} — ${escapeHtml(tx.category)}${tx.note ? ` <i>(${escapeHtml(tx.note)})</i>` : ""}`
    );
  }
  lines.push("", `Masuk: <b>${formatIDR(totalIn)}</b> • Keluar: <b>${formatIDR(totalOut)}</b>`);
  return lines.join("\n");
}

export async function notifyBatch(env, txs, inputBy) {
  try {
    await tgSend(env, "sendMessage", { text: batchMessage(txs, inputBy), parse_mode: "HTML" });
  } catch (e) {
    console.log("notifyBatch failed:", e?.message || e);
  }
}

// Kirim foto yang sudah ada di Telegram via file_id (tanpa upload ulang).
// Dipakai untuk notifikasi ulang / fallback saat bytes asli tak tersedia.
export async function sendPhotoByFileId(env, fileId, caption) {
  try {
    await tgSend(env, "sendPhoto", { photo: fileId, caption, parse_mode: "HTML" });
  } catch (e) {
    console.log("sendPhotoByFileId failed:", e?.message || e);
  }
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
      form.append("photo", new Blob([photoBytes], { type: "image/webp" }), "struk.webp");
      await tgSend(env, "sendPhoto", form, true);
    } else {
      await tgSend(env, "sendMessage", { text: caption, parse_mode: "HTML" });
    }
  } catch (e) {
    console.log("notify failed:", e?.message || e);
  }
}
