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
};

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
  document.body.style.overflow = "";
}
$("#lightbox-close").addEventListener("click", closeLightbox);
$("#lightbox-backdrop").addEventListener("click", closeLightbox);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#lightbox").hidden) closeLightbox();
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
  btn.disabled = true;
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
  } catch (err) {
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
  switchTab("dashboard");
}

// ---------------- tabs ----------------
document.querySelectorAll(".nav-btn").forEach((b) =>
  b.addEventListener("click", () => switchTab(b.dataset.tab))
);
function switchTab(name) {
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab").forEach((t) => (t.hidden = t.id !== "tab-" + name));
  if (name === "dashboard") loadDashboard().catch((e) => toast(e.message, false));
  if (name === "transaksi") loadTx().catch((e) => toast(e.message, false));
  if (name === "hutang") loadDebts().catch((e) => toast(e.message, false));
}

// ---------------- dashboard ----------------
$("#dash-month").addEventListener("change", () => loadDashboard().catch((e) => toast(e.message, false)));

async function loadDashboard() {
  const month = $("#dash-month").value || todayStr().slice(0, 7);
  const [yy, mm] = month.split("-");
  $("#dash-subtitle").textContent = `Keuangan ${NAMA_BULAN[parseInt(mm, 10) - 1]} ${yy}`;
  const s = await api("/api/summary?month=" + encodeURIComponent(month));
  countUp($("#stat-in"), s.totalIn);
  countUp($("#stat-out"), s.totalOut);
  countUp($("#stat-balance"), s.balance);
  $("#stat-balance").closest(".stat").classList.toggle("neg", s.balance < 0);

  if (window.Chart) {
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

  const { transactions } = await api(`/api/transactions?limit=5&from=${month}-01&to=${month}-31`);
  $("#recent-list").innerHTML = transactions.length
    ? transactions.map(txRow).join("")
    : `<p class="muted">Belum ada transaksi.</p>`;
}

function txRow(t) {
  return `
  <div class="tx-row ${t.type}">
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
    const name = prompt("Nama penginput baru:");
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
    if (!confirm(`Hapus "${name}" dari daftar penginput?`)) return;
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
  const p = new URLSearchParams({ limit: 200, offset: 0 });
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
    <div class="tx-row ${t.type}">
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
}

// ---------------- pilih massal + hapus massal ----------------
const selectedIds = new Set();

function updateSelBar() {
  const n = selectedIds.size;
  $("#sel-count").textContent = `${n} dipilih`;
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
  if (!confirm(`Hapus ${n} transaksi yang dipilih?`)) return;
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
  if (!confirm("Hapus transaksi ini?")) return;
  try {
    await api("/api/transactions/" + id, { method: "DELETE" });
    toast("Transaksi dihapus");
    await loadTx();
  } catch (e) {
    toast(e.message, false);
  }
}

$("#f-export").addEventListener("click", () => {
  const rows = [["Tanggal", "Tipe", "Kategori", "Nominal", "Diinput oleh", "Catatan"]];
  for (const t of state.lastTx)
    rows.push([t.date, t.type === "in" ? "Masuk" : "Keluar", t.category, t.amount, t.input_by || "", t.note || ""]);
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" }));
  a.download = "transaksi.csv";
  a.click();
  toast("CSV diunduh");
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
  const { debts } = await api("/api/debts" + (status ? `?status=${status}` : ""));
  state.debts = debts;
  const today = todayStr();
  let owe = 0, owed = 0, overdue = 0;
  for (const d of debts) {
    if (d.status === "belum") {
      if (d.type === "piutang") owed += d.amount;
      else owe += d.amount;
      if (d.due_date && d.due_date < today) overdue++;
    }
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
      <span class="muted">${isHutang ? "Saya berhutang" : "Menghutangi"} • Mulai ${fmtDate(d.start_date)}${d.due_date ? " • Tenggat " + fmtDate(d.due_date) : " • Tanpa tenggat"}${d.input_by ? " • 👤 " + escHtml(d.input_by) : ""}${d.note ? " • " + escHtml(d.note) : ""}</span>
      <span class="debt-badge ${st.cls}">${st.label}</span>
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
  if (!confirm("Hapus data hutang ini?")) return;
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
  const inpSel = $("#debt-inputter");
  if (d.input_by && ![...inpSel.options].some((o) => o.value === d.input_by)) {
    const opt = document.createElement("option");
    opt.textContent = d.input_by;
    inpSel.appendChild(opt);
  }
  if (d.input_by) inpSel.value = d.input_by;
  $("#debt-submit").textContent = "Simpan Perubahan";
  window.scrollTo(0, document.body.scrollHeight);
}

$("#debt-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#debt-submit");
  btn.disabled = true;
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
      input_by: $("#debt-inputter").value || "",
    };
    if (state.editingDebtId) {
      await api("/api/debts/" + state.editingDebtId, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      toast("Hutang diperbarui ✅");
    } else {
      await api("/api/debts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      toast("Tersimpan ✅ — notif dikirim ke Telegram");
    }
    resetDebtForm();
    await loadDebts();
  } catch (err) {
    toast(err.message, false);
  }
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
  const input_by = $("#bulk-inputter").value || "";
  const btn = $("#bulk-submit");
  btn.disabled = true;
  try {
    // 1. Upload foto tiap baris yang ada fotonya (paralel).
    //    One-shot: foto + caption notifikasi dikirim sekali jalan via Telegram.
    const uploaded = await Promise.all(
      items.map(async (it, i) => {
        if (!it.file) return { ...it, receipt_key: "", notified: false };
        const webp = await compressToWebp(it.file);
        const fd = new FormData();
        fd.append("file", new File([webp], "struk.webp", { type: "image/webp" }));
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
    const payload = uploaded.map(({ row, file, ...rest }) => rest);
    const r = await api("/api/transactions/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: payload, input_by }),
    });
    const nPhoto = uploaded.filter((x) => x.receipt_key).length;
    toast(
      `${r.count} transaksi tersimpan ✅` +
        (nPhoto ? ` — ${nPhoto} struk terkirim ke Telegram` : " — rekap dikirim ke Telegram")
    );
    resetBulkRows();
  } catch (e) {
    toast(e.message, false);
  }
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
  const t = state.lastTx.find((x) => x.id === id);
  if (!t) return;
  state.editingId = id;
  setFormType(t.type);
  $("#tx-date").value = t.date;
  $("#tx-category").value = t.category;
  $("#tx-amount").value = Number(t.amount).toLocaleString("id-ID");
  $("#tx-note").value = t.note || "";
  const inpSel = $("#tx-inputter");
  if (t.input_by && ![...inpSel.options].some((o) => o.value === t.input_by)) {
    const opt = document.createElement("option");
    opt.textContent = t.input_by;
    inpSel.appendChild(opt);
  }
  if (t.input_by) inpSel.value = t.input_by;
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

$("#tx-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#tx-submit");
  btn.disabled = true;
  try {
    const amount = parseInt(($("#tx-amount").value || "").replace(/\D/g, ""), 10);
    if (!amount || amount <= 0) throw new Error("Nominal harus lebih dari 0");
    const txData = {
      date: $("#tx-date").value,
      type: state.formType,
      category: $("#tx-category").value,
      amount,
      note: $("#tx-note").value.trim(),
      input_by: $("#tx-inputter").value || "",
    };
    let receipt_key = "";
    let notified = false;
    let via = "";
    const file = $("#tx-file").files[0];
    if (file) {
      // Kompres ke WebP dulu — hemat storage
      const webp = await compressToWebp(file);
      const fd = new FormData();
      fd.append("file", new File([webp], "struk.webp", { type: "image/webp" }));
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
      await api("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      toast(
        via === "telegram"
          ? "Tersimpan ✅ — struk & notif terkirim via Telegram"
          : "Tersimpan ✅ — notif dikirim ke Telegram"
      );
    }
    resetForm();
  } catch (err) {
    toast(err.message, false);
  }
  btn.disabled = false;
});

// ---------------- init ----------------
initTheme();
if (state.token) showApp().catch(() => logout());
