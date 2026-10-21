// Notifikasi Telegram: teks untuk tiap transaksi, foto bila ada struk.
// Diam-diam dilewati kalau TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID kosong.

export function formatIDR(n) {
  return "Rp" + Number(n || 0).toLocaleString("id-ID");
}

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const OWNER_LABEL = { bobby: "Bobby", killa: "Killa", kita: "Kita" };
const ownerLabel = (o) => OWNER_LABEL[o] || "Kita";

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
  lines.push(`🏷️ Milik: ${ownerLabel(tx.owner)}`);
  if (tx.payment) lines.push(`💳 Via: ${escapeHtml(tx.payment)}`);
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

// ---------- notifikasi hutang & piutang ----------
export function debtMessage(d) {
  const isHutang = d.type !== "piutang";
  const emoji = isHutang ? "🔴" : "🟢";
  const label = isHutang ? "HUTANG BARU" : "PIUTANG BARU";
  const lines = [
    `${emoji} <b>${label}</b>`,
    `${isHutang ? "Ke" : "Dari"}: <b>${escapeHtml(d.person)}</b>`,
    `Nominal : <b>${formatIDR(d.amount)}</b>`,
    `Mulai   : ${escapeHtml(d.start_date)}`,
  ];
  if (d.due_date) lines.push(`Tenggat : ${escapeHtml(d.due_date)}`);
  if (d.input_by) lines.push(`👤 Input oleh: ${escapeHtml(d.input_by)}`);
  lines.push(`🏷️ Milik: ${ownerLabel(d.owner)}`);
  if (d.note) lines.push(`Catatan : ${escapeHtml(d.note)}`);
  return lines.join("\n");
}

export async function notifyDebt(env, debt) {
  try {
    await tgSend(env, "sendMessage", { text: debtMessage(debt), parse_mode: "HTML" });
  } catch (e) {
    console.log("notifyDebt failed:", e?.message || e);
  }
}

export async function notifyDebtPaid(env, d) {
  try {
    const isHutang = d.type !== "piutang";
    const text =
      `✅ <b>${isHutang ? "HUTANG LUNAS" : "PIUTANG LUNAS"}</b>\n` +
      `${isHutang ? "Ke" : "Dari"}: <b>${escapeHtml(d.person)}</b>\n` +
      `Nominal : <b>${formatIDR(d.amount)}</b>`;
    await tgSend(env, "sendMessage", { text, parse_mode: "HTML" });
  } catch (e) {
    console.log("notifyDebtPaid failed:", e?.message || e);
  }
}
// Pesan teks bebas (dipakai pengingat jatuh tempo).
export async function sendText(env, text) {
  return tgSend(env, "sendMessage", { text, parse_mode: "HTML" });
}

export async function testTelegram(env) {  if (!env.TELEGRAM_BOT_TOKEN) return { ok: false, error: "TELEGRAM_BOT_TOKEN kosong di worker" };
  if (!env.TELEGRAM_CHAT_ID) return { ok: false, error: "TELEGRAM_CHAT_ID kosong di worker" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: "🔔 Tes notifikasi KIBY — kalau kamu baca ini, notif Telegram sudah jalan ✅",
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: `Telegram API ${res.status}: ${data.description || "gagal"}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
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
