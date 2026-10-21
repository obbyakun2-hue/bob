"use strict";
// Catatan Uang — frontend vanilla JS.

const $ = (s) => document.querySelector(s);
const state = {
  token: localStorage.getItem("uang_token") || "",
  categories: [],
  inputters: [],
  chart: null,
  editingId: null,
  formType: "out",
  lastTx: [],
  debtType: "hutang",
  editingDebtId: null,
  debts: [],
  removeReceipt: false,
  recentTx: [],
  docs: [],
  owner: localStorage.getItem("uang_owner") || "kita",
};

// ---------------- pemilik data: Bobby / Killa / Kita ----------------
const OWNER_META = {
  bobby: { label: "Bobby", icon: "🧑" },
  killa: { label: "Killa", icon: "👩" },
  kita: { label: "Kita", icon: "👥" },
};
const ownerLabel = (o) => (OWNER_META[o] ? OWNER_META[o].label : "Kita");
const ownerIcon = (o) => (OWNER_META[o] ? OWNER_META[o].icon : "👥");
// Penginput tidak lagi dipilih manual — selalu nama pemilik menu aktif.
const INPUTTER_BY_OWNER = { bobby: "Bobby", killa: "Killa", kita: "kita" };
const ownerInputter = () => INPUTTER_BY_OWNER[state.owner] || "kita";

function syncOwnerUI() {
  document.querySelectorAll(".owner-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.owner === state.owner)
  );
}

// Ganti pemilik aktif: semua tampilan Management ikut pemilik ini.
function setOwner(o) {
  if (!OWNER_META[o]) return;
  state.owner = o;
  localStorage.setItem("uang_owner", o);
  // Batalkan edit yang sedang jalan — datanya milik pemilik lain.
  if (state.editingId) resetForm();
  if (state.editingDebtId) resetDebtForm();
  syncOwnerUI();
  const activeTab = document.querySelector(".nav-btn.active")?.dataset.tab;
  if (activeTab === "transaksi") loadTx().catch((e) => toast(e.message, false));
  else if (activeTab === "hutang") loadDebts().catch((e) => toast(e.message, false));
  else if (activeTab === "dashboard") loadDashboard().catch((e) => toast(e.message, false));
  else switchTab("dashboard");
}
document.querySelectorAll(".owner-btn").forEach((b) =>
  b.addEventListener("click", () => {
    switchMenu("management");
    setOwner(b.dataset.owner);
  })
);

const fmtIDR = (n) => "Rp" + Number(n || 0).toLocaleString("id-ID");
const pad = (n) => String(n).padStart(2, "0");
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const NAMA_BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const fmtDate = (s) => {
  const p = String(s).split("-");
  return `${parseInt(p[2], 10)} ${NAMA_BULAN[parseInt(p[1], 10) - 1]} ${p[0]}`;
};
const escHtml = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Ikon per kategori biar tampilannya hidup
const CAT_ICONS = {
  "Gaji": "💼", "Bonus": "🎁", "Usaha / Freelance": "🧑‍💻", "Hadiah": "🎀", "Lainnya (Masuk)": "📥",
  "Makan & Minum": "🍜", "Transport / Bensin": "⛽", "Belanja": "🛍️", "Tagihan & Listrik": "💡",
  "Pulsa & Kuota": "📱", "Kesehatan": "🏥", "Hiburan & Game": "🎮", "Tabungan": "🏦", "Vape": "💨", "Lainnya (Keluar)": "📤",
};
const catIcon = (name, type) => CAT_ICONS[name] || (type === "in" ? "💰" : "💸");

// Animasi angka naik di kartu statistik
function countUp(el, target) {
  const dur = 700;
  const start = performance.now();
  const neg = target < 0;
  const abs = Math.abs(target);
  function frame(t) {
    const p = Math.min(1, (t - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = (neg ? "-" : "") + fmtIDR(Math.round(abs * eased));
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Tema gelap / terang
function updateThemeBtn() {
  $("#theme-btn").textContent = document.documentElement.dataset.theme === "dark" ? "☀️" : "🌙";
}
function initTheme() {
  document.documentElement.dataset.theme = localStorage.getItem("uang_theme") || "light";
  updateThemeBtn();
}

let toastTimer;
function toast(msg, ok = true) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "show " + (ok ? "ok" : "err");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ""), 2600);
}

// Dialog konfirmasi/prompt custom (pengganti confirm()/prompt() native).
// Mengembalikan Promise: confirmDlg -> boolean, promptDlg -> string|null.
let dlgResolve = null;
function openDlg({ msg, input = false, okLabel = "Ya", danger = false }) {
  return new Promise((resolve) => {
    dlgResolve = resolve;
    $("#dlg-msg").textContent = msg;
    const inp = $("#dlg-input");
    inp.hidden = !input;
    if (input) inp.value = "";
    const okBtn = $("#dlg-ok");
    okBtn.textContent = okLabel;
    okBtn.classList.toggle("danger", danger);
    okBtn.classList.toggle("primary", !danger);
    $("#dlg").hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(() => (input ? inp.focus() : okBtn.focus()), 30);
  });
}
function closeDlg(result) {
  $("#dlg").hidden = true;
  document.body.style.overflow = "";
  const r = dlgResolve;
  dlgResolve = null;
  if (r) r(result);
}
function confirmDlg(msg, okLabel = "Ya, hapus") {
  return openDlg({ msg, okLabel, danger: true });
}
function promptDlg(msg, okLabel = "Simpan") {
  return openDlg({ msg, input: true, okLabel }).then((v) => {
    if (v === false) return null;
    const s = String(v || "").trim();
    return s ? s : null;
  });
}
$("#dlg-ok").addEventListener("click", () => {
  const inp = $("#dlg-input");
  closeDlg(inp.hidden ? true : inp.value);
});
$("#dlg-cancel").addEventListener("click", () => closeDlg(false));
$("#dlg-backdrop").addEventListener("click", () => closeDlg(false));
document.addEventListener("keydown", (e) => {
  if (!$("#dlg").hidden && e.key === "Escape") closeDlg(false);
});

// Lightbox: preview gambar ukuran besar (dipakai struk di form, borongan, daftar)
function openLightbox({ src, fullUrl, onRemove }) {
  if (!src) return;
  $("#lightbox-img").src = src;
  const openBtn = $("#lightbox-open");
  if (fullUrl) {
    openBtn.href = fullUrl;
    openBtn.hidden = false;
  } else {
    openBtn.hidden = true;
  }
  const rmBtn = $("#lightbox-remove");
  rmBtn.hidden = !onRemove;
  rmBtn.onclick = () => {
    closeLightbox();
    if (onRemove) onRemove();
  };
  $("#lightbox").hidden = false;
  document.body.style.overflow = "hidden";
}
function closeLightbox() {
  $("#lightbox").hidden = true;
  $("#lightbox-img").src = "";
  document.body.style.overflow = $("#tx-detail").hidden ? "" : "hidden";
}
$("#lightbox-close").addEventListener("click", closeLightbox);
$("#lightbox-backdrop").addEventListener("click", closeLightbox);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("#lightbox").hidden) closeLightbox();
  else if (!$("#tx-detail").hidden) closeTxDetail();
});

// Detail transaksi — tap baris di "Transaksi Terakhir" / daftar transaksi
let detailTxId = null;
function findTx(id) {
  return (state.recentTx || []).concat(state.lastTx || []).find((x) => x.id === id);
}
function showTxDetail(id) {
  const t = findTx(id);
  if (!t) return;
  detailTxId = id;
  $("#txd-head").className = "txd-head " + t.type;
  $("#txd-ico").textContent = catIcon(t.category, t.type);
  $("#txd-cat").textContent = t.category;
  $("#txd-date").textContent = fmtDate(t.date);
  $("#txd-amt").textContent = (t.type === "in" ? "+" : "-") + fmtIDR(t.amount);
  $("#txd-type").textContent = t.type === "in" ? "💰 Pemasukan" : "💸 Pengeluaran";
  $("#txd-owner").textContent = `${ownerIcon(t.owner)} ${ownerLabel(t.owner)}`;
  $("#txd-by").textContent = t.input_by || "—";
  $("#txd-note").textContent = t.note || "—";
  const rrow = $("#txd-receipt-row");
  if (t.receipt_key) {
    rrow.style.display = "";
    const img = $("#txd-receipt");
    img.style.display = "";
    img.src = "/api/receipt/" + t.receipt_key;
    img.onerror = () => (img.style.display = "none");
    img.onclick = () => openLightbox({ src: img.src, fullUrl: img.src });
  } else {
    rrow.style.display = "none";
  }
  $("#tx-detail").hidden = false;
  document.body.style.overflow = "hidden";
}
function closeTxDetail() {
  $("#tx-detail").hidden = true;
  detailTxId = null;
  document.body.style.overflow = "";
}
$("#txd-close").addEventListener("click", closeTxDetail);
$("#tx-detail-backdrop").addEventListener("click", closeTxDetail);
$("#txd-edit").addEventListener("click", () => {
  const id = detailTxId;
  closeTxDetail();
  if (id) startEdit(id);
});
$("#txd-del").addEventListener("click", async () => {
  const id = detailTxId;
  if (!id) return;
  if (!(await confirmDlg("Hapus transaksi ini?"))) return;
  try {
    await api("/api/transactions/" + id, { method: "DELETE" });
    toast("Dihapus 🗑️");
    closeTxDetail();
    const activeTab = document.querySelector(".nav-btn.active")?.dataset.tab;
    if (activeTab === "transaksi") loadTx().catch(() => {});
    else loadDashboard().catch(() => {});
  } catch (e) {
    toast(e.message, false);
  }
});

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: "Bearer " + state.token },
  });
  if (res.status === 401) {
    logout();
    throw new Error("Sesi berakhir, silakan login lagi");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Permintaan gagal");
  return data;
}

function logout() {
  state.token = "";
  localStorage.removeItem("uang_token");
  $("#app-view").hidden = true;
  $("#login-view").hidden = false;
}

// ---------------- login ----------------
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button");
  const btnLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Memproses…";
  try {
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: $("#username").value.trim(), password: $("#password").value }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Login gagal");
    state.token = d.token;
    localStorage.setItem("uang_token", d.token);
    $("#password").value = "";
    await showApp();
    toast("Selamat datang! 👋");
  } catch (err) {
    toast(err.message, false);
  }
  btn.textContent = btnLabel;
  btn.disabled = false;
});
$("#logout-btn").addEventListener("click", () => {
  logout();
  toast("Kamu sudah keluar");
});
$("#theme-btn").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("uang_theme", next);
  updateThemeBtn();
  if (!$("#tab-dashboard").hidden) loadDashboard().catch(() => {});
});
$("#tg-test-btn").addEventListener("click", async () => {
  const btn = $("#tg-test-btn");
  btn.disabled = true;
  try {
    const r = await api("/api/telegram-test", { method: "POST" });
    toast(r.ok ? "Pesan tes terkirim ke Telegram ✅ — cek HP-mu" : "Gagal: " + r.error, r.ok);
  } catch (e) {
    toast(e.message, false);
  }
  btn.disabled = false;
});

async function showApp() {
  $("#login-view").hidden = true;
  $("#app-view").hidden = false;
  try {
    const { categories } = await api("/api/categories");
    state.categories = categories;
    const { inputters } = await api("/api/inputters");
    state.inputters = inputters;
    renderInputterSelects();
    syncOwnerUI();
  } catch (err) {
    // Gagal ambil data awal (mis. token basi tapi belum 401) — kembali ke login
    // supaya tidak tampil aplikasi kosong/rusak.
    logout();
    toast(err.message, false);
    return;
  }
  const m = todayStr().slice(0, 7);
  $("#dash-month").value = m;
  $("#f-from").value = m + "-01";
  const dim = new Date(parseInt(m.slice(0, 4), 10), parseInt(m.slice(5), 10), 0).getDate();
  $("#f-to").value = `${m}-${pad(dim)}`;
  buildCategoryFilter();
  resetForm();
  resetDocForm();
  switchMenu("management");
  switchTab("overview");
}

// ---------------- tabs ----------------
document.querySelectorAll(".nav-btn").forEach((b) =>
  b.addEventListener("click", () => {
    // Reset form edit kalau user pindah tab manual — jangan sampai
    // form "Ubah" nyangkut dan menimpa data lain saat dikira tambah baru.
    if (b.dataset.tab === "tambah" && state.editingId) resetForm();
    if (b.dataset.tab === "hutang" && state.editingDebtId) resetDebtForm();
    switchTab(b.dataset.tab);
  })
);
function switchTab(name) {
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab").forEach((t) => (t.hidden = t.id !== "tab-" + name));
  if (name === "dashboard") loadDashboard().catch((e) => toast(e.message, false));
  if (name === "transaksi") loadTx().catch((e) => toast(e.message, false));
  if (name === "hutang") loadDebts().catch((e) => toast(e.message, false));
  if (name === "overview") loadOverview().catch((e) => toast(e.message, false));
}

// ---------------- menu sidebar: Management vs Dokumen ----------------
function switchMenu(name) {
  document.querySelectorAll(".side-btn").forEach((b) => b.classList.toggle("active", b.dataset.menu === name));
  document.querySelector(".content").dataset.menu = name;
  $("#view-management").hidden = name !== "management";
  $("#view-dokumen").hidden = name !== "dokumen";
  if (name === "dokumen") loadDocs().catch((e) => toast(e.message, false));
  window.scrollTo(0, 0);
}
document.querySelectorAll(".side-btn").forEach((b) =>
  b.addEventListener("click", () => switchMenu(b.dataset.menu))
);
// Klik "Management" selalu membuka Overview Management (bukan dashboard pemilik)
document.querySelector('.side-btn[data-menu="management"]').addEventListener("click", () => switchTab("overview"));

// ---------------- overview management ----------------
const MOTIVASI = [
  { q: "Jangan menabung apa yang tersisa setelah belanja — belanjalah apa yang tersisa setelah menabung.", a: "Warren Buffett" },
  { q: "Menabung bukan soal besar kecilnya uang, tapi soal konsistensi melakukannya.", a: "Pepatah keuangan" },
  { q: "Uang yang diatur berdua dengan jujur, rezekinya terasa dua kali lipat.", a: "KIBY" },
  { q: "Sedikit demi sedikit, lama-lama menjadi bukit. Yang penting mulai dan konsisten.", a: "Peribahasa Indonesia" },
  { q: "Kebebasan finansial dibangun dari kebiasaan kecil yang diulang setiap bulan.", a: "Pepatah keuangan" },
  { q: "Pasangan yang kompak soal uang, kompak juga mengejar mimpinya.", a: "KIBY" },
  { q: "Catat setiap rupiah — uang yang tercatat tidak akan hilang tanpa jejak.", a: "KIBY" },
  { q: "Harta yang paling berharga adalah ketenangan pikiran soal masa depan.", a: "Pepatah keuangan" },
];

async function loadOverview() {
  const nowD = new Date();
  const month = todayStr().slice(0, 7);
  const jam = nowD.getHours();
  const salam = jam < 11 ? "Selamat pagi ☀️" : jam < 15 ? "Selamat siang 🌤️" : jam < 19 ? "Selamat sore 🌇" : "Selamat malam 🌙";
  $("#ov-subtitle").textContent = `${salam} • Ringkasan ${NAMA_BULAN[nowD.getMonth()]} ${nowD.getFullYear()}`;
  const owners = ["bobby", "killa", "kita"];
  const sums = await Promise.all(owners.map((o) => api(`/api/summary?month=${month}&owner=${o}`)));
  const totalIn = sums.reduce((a, s) => a + s.totalIn, 0);
  const totalOut = sums.reduce((a, s) => a + s.totalOut, 0);
  const balance = totalIn - totalOut;
  countUp($("#ov-balance"), balance);
  countUp($("#ov-in"), totalIn);
  countUp($("#ov-out"), totalOut);
  const rate = totalIn > 0 ? Math.round(((totalIn - totalOut) / totalIn) * 100) : 0;
  $("#ov-rate").textContent = rate + "%";
  const spendPct = totalIn > 0 ? Math.min(100, Math.round((totalOut / totalIn) * 100)) : totalOut > 0 ? 100 : 0;
  $("#ov-bar").style.width = spendPct + "%";
  $("#ov-note").textContent =
    totalIn === 0 && totalOut === 0
      ? "✨ Mulai catat pemasukan & pengeluaran bulan ini — langkah pertama selalu yang paling penting."
      : rate >= 40
        ? `🔥 Luar biasa! Kalian menyisihkan ${rate}% pemasukan bulan ini. Konsisten begini, target besar tinggal soal waktu!`
        : rate >= 20
          ? `💪 Keren! ${rate}% pemasukan berhasil disisihkan. Sedikit lagi naik level, teruskan!`
          : rate >= 0
            ? `🌱 Saldo gabungan tetap positif (${rate}% tersisih). Coba sisihkan sedikit lebih banyak bulan ini, berdua pasti bisa.`
            : "💌 Bulan ini pengeluaran lebih besar dari pemasukan. Tidak apa-apa — yang penting sadar, lalu perbaiki pelan-pelan berdua.";

  $("#ov-cards").innerHTML = owners
    .map((o, i) => {
      const s = sums[i];
      const p = s.totalIn > 0 ? Math.min(100, Math.round((s.totalOut / s.totalIn) * 100)) : s.totalOut > 0 ? 100 : 0;
      return `
      <button class="card ov-card" data-ov-owner="${o}">
        <div class="ov-card-head"><span class="ov-ava">${ownerIcon(o)}</span><b>${ownerLabel(o)}</b><span class="ov-go">Buka →</span></div>
        <div class="ov-card-bal${s.balance < 0 ? " neg" : ""}">${fmtIDR(s.balance)}</div>
        <div class="ov-card-row"><span>💰 Masuk <b>${fmtIDR(s.totalIn)}</b></span><span>💸 Keluar <b>${fmtIDR(s.totalOut)}</b></span></div>
        <div class="hero-bar ov-bar"><i style="width:${p}%"></i></div>
        <small class="muted">Pengeluaran ${p}% dari pemasukan</small>
      </button>`;
    })
    .join("");
  document.querySelectorAll("[data-ov-owner]").forEach((c) =>
    c.addEventListener("click", () => setOwner(c.dataset.ovOwner))
  );

  const dayIdx = Math.floor(nowD.getTime() / 86400000) % MOTIVASI.length;
  $("#ov-quote-text").textContent = "“" + MOTIVASI[dayIdx].q + "”";
  $("#ov-quote-author").textContent = "— " + MOTIVASI[dayIdx].a;
}

// ---------------- dashboard ----------------
$("#dash-month").addEventListener("change", () => loadDashboard().catch((e) => toast(e.message, false)));
$("#ins-debt-card").addEventListener("click", () => switchTab("hutang"));

async function loadDashboard() {
  const month = $("#dash-month").value || todayStr().slice(0, 7);
  $("#cat-list").innerHTML = '<div class="loading">Memuat…</div>';
  $("#recent-list").innerHTML = '<div class="loading">Memuat…</div>';
  const [yy, mm] = month.split("-");
  $("#dash-subtitle").textContent = `Keuangan ${ownerIcon(state.owner)} ${ownerLabel(state.owner)} • ${NAMA_BULAN[parseInt(mm, 10) - 1]} ${yy}`;
  const s = await api("/api/summary?month=" + encodeURIComponent(month) + "&owner=" + state.owner);
  countUp($("#stat-in"), s.totalIn);
  countUp($("#stat-out"), s.totalOut);
  countUp($("#stat-balance"), s.balance);
  $("#stat-balance").closest(".stat").classList.toggle("neg", s.balance < 0);
  $("#hero-chip").textContent = `${ownerIcon(state.owner)} ${ownerLabel(state.owner)}`;
  const pct = s.totalIn > 0 ? Math.min(100, Math.round((s.totalOut / s.totalIn) * 100)) : s.totalOut > 0 ? 100 : 0;
  $("#spend-bar").style.width = pct + "%";
  $("#spend-note").textContent =
    s.totalIn === 0 && s.totalOut === 0
      ? "Belum ada transaksi bulan ini"
      : s.totalIn === 0
        ? "Belum ada pemasukan bulan ini"
        : `Pengeluaran ${pct}% dari pemasukan${pct >= 100 ? " — hati-hati, lagi boros 🔥" : pct >= 75 ? " — mulai mendekati batas" : " — masih aman 👍"}`;

  // Insight cepat dari data summary
  const outCats = s.byCategory.filter((c) => c.type === "out");
  const topCat = outCats[0];
  $("#ins-top-cat").textContent = topCat ? topCat.category : "—";
  $("#ins-top-cat-amt").textContent = topCat ? `${fmtIDR(topCat.total)} • ${topCat.n}x transaksi` : "belum ada pengeluaran";
  const daysInMonth = new Date(parseInt(yy, 10), parseInt(mm, 10), 0).getDate();
  const nowD = new Date();
  const isCurrentMonth = month === `${nowD.getFullYear()}-${pad(nowD.getMonth() + 1)}`;
  const elapsed = isCurrentMonth ? nowD.getDate() : daysInMonth;
  $("#ins-avg-out").textContent = fmtIDR(Math.round(s.totalOut / Math.max(1, elapsed)));
  $("#ins-avg-note").textContent = `dari ${elapsed} hari`;
  const nIn = s.byCategory.filter((c) => c.type === "in").reduce((a, c) => a + c.n, 0);
  const nOut = outCats.reduce((a, c) => a + c.n, 0);
  $("#ins-tx-count").textContent = `${nIn + nOut} transaksi`;
  $("#ins-tx-note").textContent = `${nIn} masuk • ${nOut} keluar`;

  const chartCanvas = $("#chart-daily");
  const chartWrap = chartCanvas?.closest(".chart-wrap");
  if (window.Chart && chartCanvas) {
    if (state.chart) state.chart.destroy();
    const dark = document.documentElement.dataset.theme === "dark";
    const gridC = dark ? "rgba(255,255,255,.07)" : "rgba(15,23,42,.06)";
    const tickC = dark ? "#8b94a9" : "#64748b";
    state.chart = new Chart($("#chart-daily"), {
      type: "bar",
      data: {
        labels: s.daily.map((d) => parseInt(d.date.slice(8), 10)),
        datasets: [
          { label: "Masuk", data: s.daily.map((d) => d.in), backgroundColor: "#10b981", borderRadius: 5, barPercentage: 0.75, categoryPercentage: 0.62 },
          { label: "Keluar", data: s.daily.map((d) => d.out), backgroundColor: "#f43f5e", borderRadius: 5, barPercentage: 0.75, categoryPercentage: 0.62 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { color: tickC, usePointStyle: true, pointStyle: "circle" } },
          tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmtIDR(c.parsed.y)}` } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: tickC, maxTicksLimit: 16 } },
          y: {
            grid: { color: gridC },
            border: { display: false },
            ticks: {
              color: tickC,
              maxTicksLimit: 6,
              callback: (v) => (v >= 1e6 ? v / 1e6 + "jt" : v >= 1e3 ? v / 1e3 + "rb" : v),
            },
          },
        },
      },
    });
  } else if (chartWrap && !chartWrap.dataset.fallback) {
    // CDN Chart.js gagal dimuat (mis. offline) — tampilkan pesan, bukan kanvas kosong.
    chartWrap.dataset.fallback = "1";
    chartWrap.innerHTML =
      '<p class="muted" style="padding:24px;text-align:center">Grafik tidak tersedia — CDN Chart.js gagal dimuat.</p>';
  }

  // Donut pengeluaran per kategori (6 teratas + Lainnya)
  const donutCanvas = $("#chart-cat");
  if (window.Chart && donutCanvas) {
    if (state.chartCat) state.chartCat.destroy();
    const top = outCats.slice(0, 6);
    const restTotal = outCats.slice(6).reduce((a, c) => a + c.total, 0);
    const dLabels = top.map((c) => c.category);
    const dValues = top.map((c) => c.total);
    if (restTotal > 0) { dLabels.push("Lainnya"); dValues.push(restTotal); }
    $("#donut-empty").hidden = dValues.length > 0;
    donutCanvas.style.display = dValues.length ? "" : "none";
    if (dValues.length) {
      const darkD = document.documentElement.dataset.theme === "dark";
      state.chartCat = new Chart(donutCanvas, {
        type: "doughnut",
        data: {
          labels: dLabels,
          datasets: [{
            data: dValues,
            backgroundColor: ["#f43f5e", "#f59e0b", "#3b82f6", "#8b5cf6", "#10b981", "#ec4899", "#64748b"],
            borderWidth: 2, borderColor: "transparent", spacing: 2,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: "62%",
          plugins: {
            legend: { position: "bottom", labels: { color: darkD ? "#8b94a9" : "#64748b", usePointStyle: true, pointStyle: "circle", boxWidth: 8 } },
            tooltip: { callbacks: { label: (c) => ` ${fmtIDR(c.parsed)}` } },
          },
        },
      });
    }
  }

  const max = Math.max(1, ...s.byCategory.map((c) => c.total));
  $("#cat-list").innerHTML = s.byCategory.length
    ? s.byCategory
        .map(
          (c) => `
      <div class="cat-row">
        <div class="cat-head">
          <span class="cat-name"><i class="cat-ico ${c.type}">${catIcon(c.category, c.type)}</i>${escHtml(c.category)} <em class="muted">×${c.n}</em></span>
          <span class="cat-total">${fmtIDR(c.total)}</span>
        </div>
        <div class="bar"><i style="width:${Math.round((c.total / max) * 100)}%;background:${c.type === "in" ? "#10b981" : "#f43f5e"}"></i></div>
      </div>`
        )
        .join("")
    : `<p class="muted">Belum ada data bulan ini.</p>`;

  const { transactions } = await api(`/api/transactions?limit=5&from=${month}-01&to=${month}-31&owner=${state.owner}`);
  state.recentTx = transactions;
  // Insight hutang aktif milik pemilik ini (gagal → diam saja)
  try {
    const { debts: unpaidDebts } = await api("/api/debts?status=belum&owner=" + state.owner);
    const owe = unpaidDebts.filter((d) => d.type !== "piutang").reduce((a, d) => a + d.amount, 0);
    const owed = unpaidDebts.filter((d) => d.type === "piutang").reduce((a, d) => a + d.amount, 0);
    $("#ins-debt").textContent = fmtIDR(owe);
    $("#ins-debt-note").textContent = unpaidDebts.length
      ? `${unpaidDebts.length} belum lunas${owed ? ` • piutang ${fmtIDR(owed)}` : ""}`
      : "tidak ada hutang aktif 🎉";
  } catch { /* abaikan */ }
  $("#recent-list").innerHTML = transactions.length
    ? transactions.map(txRow).join("")
    : `<p class="muted">Belum ada transaksi.</p>`;
  document.querySelectorAll("#recent-list .tx-row").forEach((row) =>
    row.addEventListener("click", () => showTxDetail(row.dataset.txId))
  );
}

function txRow(t) {
  return `
  <div class="tx-row ${t.type} tappable" data-tx-id="${t.id}">
    <div class="tx-ico">${catIcon(t.category, t.type)}</div>
    <div class="tx-main"><b>${escHtml(t.category)}</b>
      <span class="muted">${fmtDate(t.date)}${t.input_by ? " • 👤 " + escHtml(t.input_by) : ""}${t.note ? " • " + escHtml(t.note) : ""}</span>
    </div>
    <div class="tx-amt">${t.type === "in" ? "+" : "-"}${fmtIDR(t.amount)}</div>
  </div>`;
}

// ---------------- transaksi ----------------
function buildCategoryFilter() {
  $("#f-cat").innerHTML =
    `<option value="">Semua kategori</option>` +
    state.categories.map((c) => `<option>${escHtml(c.name)}</option>`).join("");
}
$("#f-apply").addEventListener("click", () => loadTx().catch((e) => toast(e.message, false)));

// ---------------- penginput (siapa yang input data) ----------------
// Daftar nama bisa ditambah/dihapus sendiri; pilihan terakhir diingat.
function renderInputterSelects() {
  const last = localStorage.getItem("uang_inputter") || "";
  document.querySelectorAll(".inputter-select").forEach((sel) => {
    sel.innerHTML = state.inputters.map((n) => `<option>${escHtml(n)}</option>`).join("");
    if (state.inputters.includes(last)) sel.value = last;
  });
  // Filter "penginput" di tab Transaksi ikut di-refresh
  const f = $("#f-inputter");
  if (f) {
    const cur = f.value;
    f.innerHTML =
      `<option value="">Semua penginput</option>` +
      state.inputters.map((n) => `<option>${escHtml(n)}</option>`).join("");
    if (cur && state.inputters.includes(cur)) f.value = cur;
  }
}
document.querySelectorAll(".inputter-select").forEach((sel) =>
  sel.addEventListener("change", () => localStorage.setItem("uang_inputter", sel.value))
);
document.querySelectorAll(".inputter-add").forEach((btn) =>
  btn.addEventListener("click", async () => {
    const name = await promptDlg("Nama penginput baru:");
    if (!name || !name.trim()) return;
    try {
      const { name: saved } = await api("/api/inputters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!state.inputters.includes(saved)) state.inputters.push(saved);
      state.inputters.sort((a, b) => a.localeCompare(b));
      localStorage.setItem("uang_inputter", saved);
      renderInputterSelects();
      toast(`"${saved}" ditambahkan ✅`);
    } catch (e) {
      toast(e.message, false);
    }
  })
);
document.querySelectorAll(".inputter-del").forEach((btn) =>
  btn.addEventListener("click", async () => {
    const sel = btn.closest(".inputter-wrap").querySelector(".inputter-select");
    const name = sel.value;
    if (!name) return;
    if (!(await confirmDlg(`Hapus "${name}" dari daftar penginput?`))) return;
    try {
      await api("/api/inputters/" + encodeURIComponent(name), { method: "DELETE" });
      state.inputters = state.inputters.filter((n) => n !== name);
      localStorage.removeItem("uang_inputter");
      renderInputterSelects();
      toast(`"${name}" dihapus`);
    } catch (e) {
      toast(e.message, false);
    }
  })
);

async function loadTx() {
  const applyBtn = $("#f-apply");
  applyBtn.disabled = true;
  $("#tx-list").innerHTML = '<div class="loading">Memuat transaksi…</div>';
  try {
  const p = new URLSearchParams({ limit: 200, offset: 0, owner: state.owner });
  if ($("#f-from").value) p.set("from", $("#f-from").value);
  if ($("#f-to").value) p.set("to", $("#f-to").value);
  if ($("#f-type").value) p.set("type", $("#f-type").value);
  if ($("#f-cat").value) p.set("category", $("#f-cat").value);
  if ($("#f-inputter").value) p.set("input_by", $("#f-inputter").value);
  if ($("#f-q").value.trim()) p.set("q", $("#f-q").value.trim());
  const { transactions } = await api("/api/transactions?" + p.toString());
  state.lastTx = transactions;
  selectedIds.clear();
  $("#sel-bar").hidden = transactions.length === 0;
  updateSelBar();
  $("#tx-list").innerHTML = transactions.length
    ? transactions
        .map(
          (t) => `
    <div class="tx-row ${t.type}" data-tx-id="${t.id}">
      <input type="checkbox" class="tx-check" data-id="${t.id}" title="Pilih" />
      <div class="tx-ico">${catIcon(t.category, t.type)}</div>
      <div class="tx-main"><b>${escHtml(t.category)}</b>
        <span class="muted">${fmtDate(t.date)}${t.input_by ? " • 👤 " + escHtml(t.input_by) : ""}${t.note ? " • " + escHtml(t.note) : ""}</span>
      </div>
      <div class="tx-amt">${t.type === "in" ? "+" : "-"}${fmtIDR(t.amount)}</div>
      ${t.receipt_key ? `<img class="tx-receipt-thumb" src="/api/receipt/${t.receipt_key}" alt="struk" loading="lazy" title="Tap untuk preview" />` : ""}
      <div class="tx-act">
        <button class="btn sm" data-edit="${t.id}">Ubah</button>
        <button class="btn sm danger" data-del="${t.id}">Hapus</button>
      </div>
    </div>`
        )
        .join("")
    : `<p class="muted">Tidak ada transaksi pada filter ini.</p>`;
  document.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => startEdit(b.dataset.edit)));
  document.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => delTx(b.dataset.del)));
  document.querySelectorAll(".tx-check").forEach((c) =>
    c.addEventListener("change", () => {
      if (c.checked) selectedIds.add(c.dataset.id);
      else selectedIds.delete(c.dataset.id);
      updateSelBar();
    })
  );
  document.querySelectorAll(".tx-receipt-thumb").forEach((img) => {
    img.addEventListener("error", () => (img.style.display = "none"));
    img.addEventListener("click", () => openLightbox({ src: img.src, fullUrl: img.src }));
  });
  // Tap baris (selain tombol/checkbox/thumbnail) → detail transaksi
  document.querySelectorAll("#tx-list .tx-row").forEach((row) =>
    row.addEventListener("click", (e) => {
      if (e.target.closest("button, input, img, a")) return;
      showTxDetail(row.dataset.txId);
    })
  );
  } finally {
    applyBtn.disabled = false;
  }
}

// ---------------- pilih massal + hapus massal ----------------
const selectedIds = new Set();

function updateSelBar() {
  const n = selectedIds.size;
  $("#sel-count").textContent = `${n} dipilih`;
  $("#tx-del-selected").disabled = n === 0;
  const boxes = document.querySelectorAll(".tx-check");
  const all = $("#tx-select-all");
  all.checked = boxes.length > 0 && n === boxes.length;
  all.indeterminate = n > 0 && n < boxes.length;
}

$("#tx-select-all").addEventListener("change", (e) => {
  document.querySelectorAll(".tx-check").forEach((c) => {
    c.checked = e.target.checked;
    if (c.checked) selectedIds.add(c.dataset.id);
    else selectedIds.delete(c.dataset.id);
  });
  updateSelBar();
});

$("#tx-del-selected").addEventListener("click", async () => {
  const n = selectedIds.size;
  if (!n) return;
  if (!(await confirmDlg(`Hapus ${n} transaksi yang dipilih?`))) return;
  try {
    const r = await api("/api/transactions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selectedIds] }),
    });
    toast(`${r.deleted} transaksi dihapus 🗑️`);
    await loadTx();
  } catch (e) {
    toast(e.message, false);
  }
});

async function delTx(id) {
  if (!(await confirmDlg("Hapus transaksi ini?"))) return;
  try {
    await api("/api/transactions/" + id, { method: "DELETE" });
    toast("Transaksi dihapus");
    await loadTx();
  } catch (e) {
    toast(e.message, false);
  }
}

$("#f-export").addEventListener("click", async () => {
  const btn = $("#f-export");
  btn.disabled = true;
  try {
    toast("Menyiapkan CSV...");
    // Ambil SEMUA halaman sesuai filter aktif — bukan cuma 200 baris pertama.
    const base = new URLSearchParams();
    base.set("owner", state.owner);
    if ($("#f-from").value) base.set("from", $("#f-from").value);
    if ($("#f-to").value) base.set("to", $("#f-to").value);
    if ($("#f-type").value) base.set("type", $("#f-type").value);
    if ($("#f-cat").value) base.set("category", $("#f-cat").value);
    if ($("#f-inputter").value) base.set("input_by", $("#f-inputter").value);
    if ($("#f-q").value.trim()) base.set("q", $("#f-q").value.trim());
    const all = [];
    let offset = 0;
    const LIM = 500;
    for (;;) {
      const p = new URLSearchParams(base);
      p.set("limit", String(LIM));
      p.set("offset", String(offset));
      const { transactions, total } = await api("/api/transactions?" + p.toString());
      all.push(...transactions);
      if (all.length >= total || transactions.length < LIM) break;
      offset += LIM;
    }
    const rows = [["Tanggal", "Tipe", "Kategori", "Nominal", "Kepunyaan", "Diinput oleh", "Catatan"]];
    for (const t of all)
      rows.push([t.date, t.type === "in" ? "Masuk" : "Keluar", t.category, t.amount, ownerLabel(t.owner), t.input_by || "", t.note || ""]);
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" }));
    a.download = `transaksi-${todayStr()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`${all.length} baris diunduh ✅`);
  } catch (e) {
    toast(e.message, false);
  }
  btn.disabled = false;
});

// ---------------- hutang & piutang ----------------
function setDebtType(t) {
  state.debtType = t;
  $("#debt-type-hutang").classList.toggle("active", t === "hutang");
  $("#debt-type-piutang").classList.toggle("active", t === "piutang");
}
$("#debt-type-hutang").addEventListener("click", () => setDebtType("hutang"));
$("#debt-type-piutang").addEventListener("click", () => setDebtType("piutang"));

$("#debt-amount").addEventListener("input", (e) => {
  const digits = e.target.value.replace(/\D/g, "").slice(0, 15);
  e.target.value = digits ? Number(digits).toLocaleString("id-ID") : "";
});

function resetDebtForm() {
  state.editingDebtId = null;
  $("#debt-form").reset();
  $("#debt-start").value = todayStr();
  setDebtType("hutang");
  $("#debt-form-title").textContent = "Tambah Hutang";
  $("#debt-submit").textContent = "Simpan";
  $("#debt-form").hidden = true;
}
$("#debt-cancel").addEventListener("click", resetDebtForm);
$("#debt-add-btn").addEventListener("click", () => {
  resetDebtForm();
  $("#debt-form").hidden = false;
  window.scrollTo(0, document.body.scrollHeight);
});
$("#debt-filter-status").addEventListener("change", () => loadDebts().catch((e) => toast(e.message, false)));

function debtStatus(d) {
  if (d.status === "lunas") return { key: "lunas", label: "✅ Lunas", cls: "lunas" };
  if (d.due_date && d.due_date < todayStr()) return { key: "overdue", label: "⚠️ Lewat tenggat", cls: "overdue" };
  return { key: "belum", label: "Belum lunas", cls: "belum" };
}

async function loadDebts() {
  const status = $("#debt-filter-status").value;
  $("#debt-list").innerHTML = '<div class="loading">Memuat…</div>';
  // Daftar tampil mengikuti filter, tapi statistik SELALU dari yang belum lunas
  // (biar ganti filter ke "Lunas" tidak mengnolkan angka).
  const [{ debts }, { debts: unpaid }] = await Promise.all([
    api("/api/debts?owner=" + state.owner + (status ? `&status=${status}` : "")),
    api("/api/debts?status=belum&owner=" + state.owner),
  ]);
  state.debts = debts;
  const today = todayStr();
  let owe = 0, owed = 0, overdue = 0;
  for (const d of unpaid) {
    if (d.type === "piutang") owed += d.amount;
    else owe += d.amount;
    if (d.due_date && d.due_date < today) overdue++;
  }
  $("#debt-stat-owe").textContent = fmtIDR(owe);
  $("#debt-stat-owed").textContent = fmtIDR(owed);
  $("#debt-stat-overdue").textContent = overdue;
  $("#debt-list").innerHTML = debts.length
    ? debts.map(debtRow).join("")
    : `<p class="muted">Belum ada data hutang.</p>`;
  document.querySelectorAll("[data-debt-toggle]").forEach((b) => b.addEventListener("click", () => toggleDebt(b.dataset.debtToggle)));
  document.querySelectorAll("[data-debt-edit]").forEach((b) => b.addEventListener("click", () => startEditDebt(b.dataset.debtEdit)));
  document.querySelectorAll("[data-debt-del]").forEach((b) => b.addEventListener("click", () => delDebt(b.dataset.debtDel)));
}

function debtRow(d) {
  const st = debtStatus(d);
  const isHutang = d.type !== "piutang";
  return `
  <div class="tx-row ${isHutang ? "out" : "in"}${st.key === "lunas" ? " debt-lunas" : ""}">
    <div class="tx-ico">${isHutang ? "🔴" : "🟢"}</div>
    <div class="tx-main"><b>${escHtml(d.person)}</b>
      <span class="muted">${isHutang ? "Saya berhutang" : "Menghutangi"} • Mulai ${fmtDate(d.start_date)}${d.due_date ? " • Tenggat " + fmtDate(d.due_date) : " • Tanpa tenggat"}${d.input_by ? " • 👤 " + escHtml(d.input_by) : ""}${d.note ? " • " + escHtml(d.note) : ""}</span>      <span class="debt-badge ${st.cls}">${st.label}</span>
    </div>
    <div class="tx-amt">${fmtIDR(d.amount)}</div>
    <div class="tx-act">
      <button class="btn sm" data-debt-toggle="${d.id}">${d.status === "lunas" ? "Batal lunas" : "Lunas"}</button>
      <button class="btn sm" data-debt-edit="${d.id}">Ubah</button>
      <button class="btn sm danger" data-debt-del="${d.id}">Hapus</button>
    </div>
  </div>`;
}

async function toggleDebt(id) {
  const d = state.debts.find((x) => x.id === id);
  if (!d) return;
  try {
    await api("/api/debts/" + id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: d.status === "lunas" ? "belum" : "lunas" }),
    });
    toast(d.status === "lunas" ? "Status dibatalkan" : "Lunas! 🎉");
    await loadDebts();
  } catch (e) {
    toast(e.message, false);
  }
}

async function delDebt(id) {
  if (!(await confirmDlg("Hapus data hutang ini?"))) return;
  try {
    await api("/api/debts/" + id, { method: "DELETE" });
    toast("Dihapus 🗑️");
    await loadDebts();
  } catch (e) {
    toast(e.message, false);
  }
}

function startEditDebt(id) {
  const d = state.debts.find((x) => x.id === id);
  if (!d) return;
  state.editingDebtId = id;
  $("#debt-form").hidden = false;
  setDebtType(d.type);
  $("#debt-form-title").textContent = "Ubah Hutang";
  $("#debt-person").value = d.person;
  $("#debt-start").value = d.start_date;
  $("#debt-due").value = d.due_date || "";
  $("#debt-amount").value = Number(d.amount).toLocaleString("id-ID");
  $("#debt-note").value = d.note || "";
  $("#debt-submit").textContent = "Simpan Perubahan";
  window.scrollTo(0, document.body.scrollHeight);
}

$("#debt-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#debt-submit");
  const btnLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Menyimpan…";
  try {
    const amount = parseInt(($("#debt-amount").value || "").replace(/\D/g, ""), 10);
    if (!amount || amount <= 0) throw new Error("Nominal harus lebih dari 0");
    const person = $("#debt-person").value.trim();
    if (!person) throw new Error("Nama orang harus diisi");
    const body = {
      type: state.debtType,
      person,
      amount,
      start_date: $("#debt-start").value,
      due_date: $("#debt-due").value || "",
      note: $("#debt-note").value.trim(),
      input_by: ownerInputter(),
      owner: state.owner,
    };
    if (state.editingDebtId) {
      await api("/api/debts/" + state.editingDebtId, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      toast("Hutang diperbarui ✅");
    } else {
      const rDebt = await api("/api/debts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      toast(rDebt.telegram ? "Tersimpan ✅ — notif dikirim ke Telegram" : "Tersimpan ✅");
    }
    resetDebtForm();
    await loadDebts();
  } catch (err) {
    toast(err.message, false);
  }
  btn.textContent = btnLabel;
  btn.disabled = false;
});

// ---------------- dokumen (arsip dokumen + foto) ----------------
// Ikon per jenis dokumen biar tampilannya hidup
const DOC_ICONS = {
  "KTP": "🪪", "KK": "👨‍👩‍👧", "SIM": "🚗", "STNK": "🛵", "BPKB": "📕",
  "Sertifikat": "📜", "Ijazah": "🎓", "Kwitansi": "🧾", "Nota": "🧾", "Kontrak": "📝",
};
const docIcon = (category) => DOC_ICONS[category] || "📄";

const DOC_DROP_DEFAULT = 'Seret & letakkan foto di sini<br /><small>atau klik untuk memilih file</small>';
function resetDocForm() {
  $("#doc-form").reset();
  $("#doc-date").value = todayStr();
  $("#doc-file").value = "";
  $("#doc-preview-wrap").hidden = true;
  $("#doc-preview").src = "";
  $("#doc-drop-text").innerHTML = DOC_DROP_DEFAULT;
}
$("#doc-file").addEventListener("change", () => {
  const f = $("#doc-file").files[0];
  if (f) {
    $("#doc-preview").src = URL.createObjectURL(f);
    $("#doc-preview-wrap").hidden = false;
    $("#doc-drop-text").innerHTML = `📄 ${escHtml(f.name)}<br /><small>klik / seret lagi untuk mengganti</small>`;
  } else {
    $("#doc-preview-wrap").hidden = true;
    $("#doc-preview").src = "";
    $("#doc-drop-text").innerHTML = DOC_DROP_DEFAULT;
  }
});
// Drag & drop foto ke kotak dropzone (klik juga tetap bisa)
const docDrop = $("#doc-drop");
docDrop.addEventListener("click", () => $("#doc-file").click());
docDrop.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#doc-file").click(); }
});
["dragenter", "dragover"].forEach((ev) =>
  docDrop.addEventListener(ev, (e) => { e.preventDefault(); docDrop.classList.add("dragover"); })
);
["dragleave", "drop"].forEach((ev) =>
  docDrop.addEventListener(ev, (e) => { e.preventDefault(); docDrop.classList.remove("dragover"); })
);
docDrop.addEventListener("drop", (e) => {
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!f) return;
  if (!f.type.startsWith("image/")) { toast("File harus berupa gambar", false); return; }
  const dt = new DataTransfer();
  dt.items.add(f);
  $("#doc-file").files = dt.files;
  $("#doc-file").dispatchEvent(new Event("change"));
});
// Cegah browser membuka file kalau drop meleset dari kotak
["dragover", "drop"].forEach((ev) => window.addEventListener(ev, (e) => e.preventDefault()));
$("#doc-preview-del").addEventListener("click", () => {
  $("#doc-file").value = "";
  $("#doc-preview-wrap").hidden = true;
  $("#doc-preview").src = "";
  $("#doc-drop-text").innerHTML = DOC_DROP_DEFAULT;
});
$("#doc-preview").addEventListener("click", () => {
  const src = $("#doc-preview").src;
  if (!src || $("#doc-preview-wrap").hidden) return;
  openLightbox({ src, fullUrl: src });
});

function docRow(d) {
  return `
  <div class="tx-row">
    <div class="tx-ico">${docIcon(d.category)}</div>
    <div class="tx-main"><b>${escHtml(d.title)}</b>
      <span class="muted">${d.category ? escHtml(d.category) + " • " : ""}${fmtDate(d.doc_date)}${d.note ? " • " + escHtml(d.note) : ""}</span>
    </div>
    ${d.photo_key ? `<img class="tx-receipt-thumb doc-thumb" src="/api/receipt/${d.photo_key}" alt="foto dokumen" loading="lazy" title="Tap untuk preview" />` : ""}
    <div class="tx-act">
      <button class="btn sm danger" data-doc-del="${d.id}">Hapus</button>
    </div>
  </div>`;
}

async function loadDocs() {
  $("#doc-list").innerHTML = '<div class="loading">Memuat dokumen…</div>';
  const { documents } = await api("/api/documents");
  state.docs = documents;
  $("#doc-count").textContent = documents.length ? `${documents.length} dokumen` : "";
  $("#doc-list").innerHTML = documents.length
    ? documents.map(docRow).join("")
    : `<p class="muted">Belum ada dokumen. Tambahkan dokumen pertamamu lewat form di atas 👆</p>`;
  document.querySelectorAll("[data-doc-del]").forEach((b) =>
    b.addEventListener("click", () => delDoc(b.dataset.docDel))
  );
  document.querySelectorAll(".doc-thumb").forEach((img) => {
    img.addEventListener("error", () => (img.style.display = "none"));
    img.addEventListener("click", () => openLightbox({ src: img.src, fullUrl: img.src }));
  });
}

async function delDoc(id) {
  if (!(await confirmDlg("Hapus dokumen ini? Foto yang tersimpan ikut dihapus."))) return;
  try {
    await api("/api/documents/" + id, { method: "DELETE" });
    toast("Dokumen dihapus 🗑️");
    await loadDocs();
  } catch (e) {
    toast(e.message, false);
  }
}

$("#doc-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#doc-submit");
  const btnLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Menyimpan…";
  try {
    const title = $("#doc-title").value.trim();
    if (!title) throw new Error("Judul dokumen harus diisi");
    const file = $("#doc-file").files[0];
    if (!file) throw new Error("Foto dokumen wajib diunggah");
    // Upload foto dulu (kompres ke WebP biar hemat storage).
    // Caption Telegram dikirim sekali jalan via label.
    btn.textContent = "Mengupload foto…";
    const fd = new FormData();
    fd.append("file", await toUploadFile(file));
    fd.append("label", "Dokumen: " + title);
    // Detail dokumen ikut dikirim agar caption notifikasi Telegram lengkap.
    fd.append("doc_category", $("#doc-category").value);
    fd.append("doc_date", $("#doc-date").value || todayStr());
    fd.append("doc_note", $("#doc-note").value.trim());
    const up = await fetch("/api/upload", {
      method: "POST",
      headers: { Authorization: "Bearer " + state.token },
      body: fd,
    });
    const ud = await up.json().catch(() => ({}));
    if (!up.ok) throw new Error(ud.error || "Upload foto gagal");
    // via: "telegram" kalau foto benar-benar terkirim ke Telegram,
    // "kv" kalau fallback (Telegram tak dikonfigurasi / gagal kirim).
    // Ditampilkan jujur di toast biar tidak dikira terkirim.
    const viaTelegram = ud.via === "telegram";
    btn.textContent = "Menyimpan…";
    await api("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        category: $("#doc-category").value,
        doc_date: $("#doc-date").value || todayStr(),
        note: $("#doc-note").value.trim(),
        photo_key: ud.key,
      }),
    });
    toast(
      viaTelegram
        ? "Dokumen tersimpan ✅ — terkirim ke Telegram 📲"
        : "Dokumen tersimpan ✅ — ⚠️ tidak terkirim ke Telegram"
    );
    resetDocForm();
    await loadDocs();
  } catch (err) {
    toast(err.message, false);
  }
  btn.textContent = btnLabel;
  btn.disabled = false;
});

// ---------------- mode borongan ----------------
// Banyak transaksi sekaligus → 1 request, 1 pesan rekap Telegram (tidak spam).
let bulkCount = 0;

function setEntryMode(mode) {
  const bulk = mode === "bulk";
  $("#mode-single").classList.toggle("active", !bulk);
  $("#mode-bulk").classList.toggle("active", bulk);
  $("#tx-form").hidden = bulk;
  $("#bulk-wrap").hidden = !bulk;
  if (bulk && bulkCount === 0) for (let i = 0; i < 3; i++) addBulkRow();
}

function addBulkRow() {
  bulkCount++;
  const div = document.createElement("div");
  div.className = "bulk-row";
  div.innerHTML = `
    <input type="date" class="b-date" value="${todayStr()}" />
    <select class="b-type"><option value="out">💸 Keluar</option><option value="in">💰 Masuk</option></select>
    <select class="b-cat"></select>
    <input class="b-amount" inputmode="numeric" placeholder="Nominal Rp" />
    <input class="b-note" placeholder="Catatan (opsional)" />
    <button type="button" class="btn sm b-photo" title="Foto struk (opsional)">📷</button>
    <input type="file" class="b-file" accept="image/*" hidden />
    <button type="button" class="btn sm danger b-del" title="Hapus baris">✕</button>`;
  const typeSel = div.querySelector(".b-type");
  const catSel = div.querySelector(".b-cat");
  const fillCats = () => {
    catSel.innerHTML = state.categories
      .filter((c) => c.type === typeSel.value)
      .map((c) => `<option>${escHtml(c.name)}</option>`)
      .join("");
  };
  typeSel.addEventListener("change", fillCats);
  fillCats();
  div.querySelector(".b-amount").addEventListener("input", (e) => {
    const d = e.target.value.replace(/\D/g, "").slice(0, 15);
    e.target.value = d ? Number(d).toLocaleString("id-ID") : "";
  });
  div.querySelector(".b-del").addEventListener("click", () => {
    div.remove();
    bulkCount--;
  });
  // Foto struk per baris — belum ada foto: tap = pilih; sudah ada: tap = preview besar
  const photoBtn = div.querySelector(".b-photo");
  const fileInput = div.querySelector(".b-file");
  photoBtn.addEventListener("click", () => {
    const img = photoBtn.querySelector("img");
    if (img && fileInput.files[0]) {
      openLightbox({
        src: img.src,
        onRemove: () => {
          fileInput.value = "";
          photoBtn.textContent = "📷";
          photoBtn.title = "Foto struk (opsional)";
        },
      });
    } else {
      fileInput.click();
    }
  });
  fileInput.addEventListener("change", () => {
    const f = fileInput.files[0];
    if (f) {
      photoBtn.innerHTML = `<img src="${URL.createObjectURL(f)}" alt="struk" />`;
      photoBtn.title = "Tap untuk preview";
    } else {
      photoBtn.textContent = "📷";
      photoBtn.title = "Foto struk (opsional)";
    }
  });
  $("#bulk-rows").appendChild(div);
}

function resetBulkRows() {
  $("#bulk-rows").innerHTML = "";
  bulkCount = 0;
  for (let i = 0; i < 3; i++) addBulkRow();
}

$("#mode-single").addEventListener("click", () => setEntryMode("single"));
$("#mode-bulk").addEventListener("click", () => setEntryMode("bulk"));
$("#bulk-add").addEventListener("click", addBulkRow);
$("#bulk-submit").addEventListener("click", async () => {
  const items = [];
  for (const row of document.querySelectorAll("#bulk-rows .bulk-row")) {
    const amount = parseInt((row.querySelector(".b-amount").value || "").replace(/\D/g, ""), 10);
    if (!amount) continue; // baris kosong dilewati otomatis
    items.push({
      row,
      date: row.querySelector(".b-date").value,
      type: row.querySelector(".b-type").value,
      category: row.querySelector(".b-cat").value,
      amount,
      note: row.querySelector(".b-note").value.trim(),
      file: row.querySelector(".b-file").files[0] || null,
    });
  }
  if (!items.length) {
    toast("Isi dulu minimal 1 baris", false);
    return;
  }
  const input_by = ownerInputter();
  const btn = $("#bulk-submit");
  const btnLabel = btn.textContent;
  btn.disabled = true;
  try {
    // 1. Upload foto tiap baris yang ada fotonya (paralel).
    //    One-shot: foto + caption notifikasi dikirim sekali jalan via Telegram.
    btn.textContent = "Mengupload struk…";
    const uploaded = await Promise.all(
      items.map(async (it, i) => {
        if (!it.file) return { ...it, receipt_key: "", notified: false };
        const fd = new FormData();
        fd.append("file", await toUploadFile(it.file));
        fd.append("date", it.date);
        fd.append("type", it.type);
        fd.append("category", it.category);
        fd.append("amount", String(it.amount));
        fd.append("note", it.note);
        fd.append("input_by", input_by);
        const up = await fetch("/api/upload", {
          method: "POST",
          headers: { Authorization: "Bearer " + state.token },
          body: fd,
        });
        const ud = await up.json().catch(() => ({}));
        if (!up.ok) throw new Error(ud.error || `Upload struk baris ${i + 1} gagal`);
        return { ...it, receipt_key: ud.key || "", notified: ud.notified === true };
      })
    );
    // 2. Simpan semua sekaligus (rekap teks hanya untuk baris tanpa foto)
    btn.textContent = "Menyimpan…";
    const payload = uploaded.map(({ row, file, ...rest }) => rest);
    const r = await api("/api/transactions/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: payload, input_by, owner: state.owner }),
    });
    const nPhoto = uploaded.filter((x) => x.receipt_key).length;
    toast(
      `${r.count} transaksi tersimpan ✅` +
        (r.telegram
          ? nPhoto
            ? ` — ${nPhoto} struk terkirim ke Telegram`
            : " — rekap dikirim ke Telegram"
          : "")
    );
    resetBulkRows();
  } catch (e) {
    toast(e.message, false);
  }
  btn.textContent = btnLabel;
  btn.disabled = false;
});

// ---------------- form tambah / ubah ----------------
function setFormType(t) {
  state.formType = t;
  $("#type-in").classList.toggle("active", t === "in");
  $("#type-out").classList.toggle("active", t === "out");
  $("#tx-category").innerHTML = state.categories
    .filter((c) => c.type === t)
    .map((c) => `<option>${escHtml(c.name)}</option>`)
    .join("");
}
$("#type-in").addEventListener("click", () => setFormType("in"));
$("#type-out").addEventListener("click", () => setFormType("out"));

$("#tx-amount").addEventListener("input", (e) => {
  const digits = e.target.value.replace(/\D/g, "").slice(0, 15);
  e.target.value = digits ? Number(digits).toLocaleString("id-ID") : "";
});

// Preview foto struk di form satu-satu
function clearTxPhoto() {
  $("#tx-file").value = "";
  $("#tx-preview-wrap").hidden = true;
  $("#tx-preview").src = "";
  if (state.editingId) state.removeReceipt = true; // saat ubah: tandai struk dihapus
}
$("#tx-file").addEventListener("change", () => {
  const f = $("#tx-file").files[0];
  state.removeReceipt = false;
  if (f) {
    $("#tx-preview").src = URL.createObjectURL(f);
    $("#tx-preview-wrap").hidden = false;
  } else {
    $("#tx-preview-wrap").hidden = true;
    $("#tx-preview").src = "";
  }
});
$("#tx-preview").addEventListener("click", () => {
  const src = $("#tx-preview").src;
  if (!src || $("#tx-preview-wrap").hidden) return;
  openLightbox({ src, fullUrl: src, onRemove: clearTxPhoto });
});
$("#tx-preview-del").addEventListener("click", clearTxPhoto);

function resetForm() {
  state.editingId = null;
  state.removeReceipt = false;
  $("#form-title").textContent = "Tambah Transaksi";
  $("#tx-submit").textContent = "Simpan";
  $("#tx-cancel").hidden = true;
  $("#tx-form").reset();
  $("#tx-date").value = todayStr();
  $("#tx-preview-wrap").hidden = true;
  $("#tx-preview").src = "";
  setFormType("out");
}
$("#tx-cancel").addEventListener("click", resetForm);

function startEdit(id) {
  const t = findTx(id);
  if (!t) return;
  state.editingId = id;
  setFormType(t.type);
  $("#tx-date").value = t.date;
  $("#tx-category").value = t.category;
  $("#tx-amount").value = Number(t.amount).toLocaleString("id-ID");
  $("#tx-note").value = t.note || "";
  // Preview struk yang sudah ada (kalau ada)
  state.removeReceipt = false;
  if (t.receipt_key) {
    $("#tx-preview").src = "/api/receipt/" + t.receipt_key;
    $("#tx-preview-wrap").hidden = false;
  } else {
    $("#tx-preview-wrap").hidden = true;
    $("#tx-preview").src = "";
  }
  $("#form-title").textContent = "Ubah Transaksi";
  $("#tx-submit").textContent = "Simpan Perubahan";
  $("#tx-cancel").hidden = false;
  switchTab("tambah");
  window.scrollTo(0, 0);
}

// Kompres gambar ke WebP biar hemat storage KV.
// HP zaman now foto struk bisa 3-5MB; sesudah kompres (maks 1280px, q75)
// rata-rata cuma 50-150KB. 1GB KV = 10.000+ struk. Gagal → file asli.
async function compressToWebp(file, maxDim = 1280, quality = 0.75) {
  try {
    if (!("createImageBitmap" in window)) return file;
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: "fromImage" });
    } catch {
      bitmap = await createImageBitmap(file);
    }
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    if (bitmap.close) bitmap.close();
    const blob = await new Promise((res) => canvas.toBlob(res, "image/webp", quality));
    return blob || file;
  } catch {
    return file;
  }
}

// Siapkan file untuk upload: kalau kompres berhasil → WebP; kalau gagal →
// pakai file asli APA ADANYA (nama & tipe asli) supaya tidak dilabeli webp keliru.
async function toUploadFile(file) {
  const out = await compressToWebp(file);
  if (out === file) return file;
  return new File([out], "struk.webp", { type: "image/webp" });
}

$("#tx-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#tx-submit");
  const btnLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Menyimpan…";
  try {
    const amount = parseInt(($("#tx-amount").value || "").replace(/\D/g, ""), 10);
    if (!amount || amount <= 0) throw new Error("Nominal harus lebih dari 0");
    const txData = {
      date: $("#tx-date").value,
      type: state.formType,
      category: $("#tx-category").value,
      amount,
      note: $("#tx-note").value.trim(),
      input_by: ownerInputter(),
      owner: state.owner,
    };
    let receipt_key = "";
    let notified = false;
    let via = "";
    const file = $("#tx-file").files[0];
    if (file) {
      // Kompres ke WebP dulu — hemat storage (gagal → file asli apa adanya)
      const fd = new FormData();
      fd.append("file", await toUploadFile(file));
      // Meta transaksi ikut dikirim: kalau upload via Telegram, foto + caption
      // notifikasi langsung dikirim sekali jalan (tidak dobel saat transaksi dibuat)
      fd.append("date", txData.date);
      fd.append("type", txData.type);
      fd.append("category", txData.category);
      fd.append("amount", String(txData.amount));
      fd.append("note", txData.note);
      fd.append("input_by", txData.input_by);
      const up = await fetch("/api/upload", {
        method: "POST",
        headers: { Authorization: "Bearer " + state.token },
        body: fd,
      });
      const ud = await up.json().catch(() => ({}));
      if (!up.ok) throw new Error(ud.error || "Upload struk gagal");
      receipt_key = ud.key;
      notified = ud.notified === true;
      via = ud.via || "";
    }
    const body = { ...txData };
    if (receipt_key) {
      body.receipt_key = receipt_key;
      body.notified = notified;
    } else if (state.editingId && state.removeReceipt) {
      body.receipt_key = ""; // struk dihapus saat ubah
    }
    if (state.editingId) {
      await api("/api/transactions/" + state.editingId, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      toast("Transaksi diperbarui ✅");
    } else {
      const rTx = await api("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      toast(
        !rTx.telegram
          ? "Tersimpan ✅"
          : via === "telegram"
            ? "Tersimpan ✅ — struk & notif terkirim via Telegram"
            : "Tersimpan ✅ — notif dikirim ke Telegram"
      );
    }
    resetForm();
  } catch (err) {
    toast(err.message, false);
  }
  btn.textContent = btnLabel;
  btn.disabled = false;
});

// ---------------- init ----------------
initTheme();
if (state.token) showApp().catch(() => logout());
