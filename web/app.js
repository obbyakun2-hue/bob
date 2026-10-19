"use strict";
// Catatan Uang — frontend vanilla JS.

const $ = (s) => document.querySelector(s);
const state = {
  token: localStorage.getItem("uang_token") || "",
  categories: [],
  chart: null,
  editingId: null,
  formType: "out",
  lastTx: [],
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

let toastTimer;
function toast(msg, ok = true) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "show " + (ok ? "ok" : "err");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ""), 2600);
}

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

async function showApp() {
  $("#login-view").hidden = true;
  $("#app-view").hidden = false;
  try {
    const { categories } = await api("/api/categories");
    state.categories = categories;
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
}

// ---------------- dashboard ----------------
$("#dash-month").addEventListener("change", () => loadDashboard().catch((e) => toast(e.message, false)));

async function loadDashboard() {
  const month = $("#dash-month").value || todayStr().slice(0, 7);
  const s = await api("/api/summary?month=" + encodeURIComponent(month));
  $("#stat-in").textContent = fmtIDR(s.totalIn);
  $("#stat-out").textContent = fmtIDR(s.totalOut);
  const balEl = $("#stat-balance");
  balEl.textContent = (s.balance < 0 ? "-" : "") + fmtIDR(Math.abs(s.balance));
  balEl.closest(".stat").classList.toggle("neg", s.balance < 0);

  if (window.Chart) {
    if (state.chart) state.chart.destroy();
    state.chart = new Chart($("#chart-daily"), {
      type: "bar",
      data: {
        labels: s.daily.map((d) => parseInt(d.date.slice(8), 10)),
        datasets: [
          { label: "Masuk", data: s.daily.map((d) => d.in), backgroundColor: "#16a34a" },
          { label: "Keluar", data: s.daily.map((d) => d.out), backgroundColor: "#e11d48" },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom" },
          tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmtIDR(c.parsed.y)}` } },
        },
        scales: {
          y: {
            ticks: {
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
        <div class="cat-head"><span>${c.type === "in" ? "💰" : "💸"} ${escHtml(c.category)}</span><span>${fmtIDR(c.total)}</span></div>
        <div class="bar"><i style="width:${Math.round((c.total / max) * 100)}%;background:${c.type === "in" ? "#16a34a" : "#e11d48"}"></i></div>
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
    <div class="tx-ico">${t.type === "in" ? "💰" : "💸"}</div>
    <div class="tx-main"><b>${escHtml(t.category)}</b>
      <span class="muted">${fmtDate(t.date)}${t.note ? " • " + escHtml(t.note) : ""}</span>
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

async function loadTx() {
  const p = new URLSearchParams({ limit: 200, offset: 0 });
  if ($("#f-from").value) p.set("from", $("#f-from").value);
  if ($("#f-to").value) p.set("to", $("#f-to").value);
  if ($("#f-type").value) p.set("type", $("#f-type").value);
  if ($("#f-cat").value) p.set("category", $("#f-cat").value);
  if ($("#f-q").value.trim()) p.set("q", $("#f-q").value.trim());
  const { transactions } = await api("/api/transactions?" + p.toString());
  state.lastTx = transactions;
  $("#tx-list").innerHTML = transactions.length
    ? transactions
        .map(
          (t) => `
    <div class="tx-row ${t.type}">
      <div class="tx-ico">${t.type === "in" ? "💰" : "💸"}</div>
      <div class="tx-main"><b>${escHtml(t.category)}</b>
        <span class="muted">${fmtDate(t.date)}${t.note ? " • " + escHtml(t.note) : ""}${
            t.receipt_key ? ` • <a href="/api/receipt/${t.receipt_key}" target="_blank">🧾 struk</a>` : ""
          }</span>
      </div>
      <div class="tx-amt">${t.type === "in" ? "+" : "-"}${fmtIDR(t.amount)}</div>
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
}

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
  const rows = [["Tanggal", "Tipe", "Kategori", "Nominal", "Catatan"]];
  for (const t of state.lastTx)
    rows.push([t.date, t.type === "in" ? "Masuk" : "Keluar", t.category, t.amount, t.note || ""]);
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" }));
  a.download = "transaksi.csv";
  a.click();
  toast("CSV diunduh");
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

function resetForm() {
  state.editingId = null;
  $("#form-title").textContent = "Tambah Transaksi";
  $("#tx-submit").textContent = "Simpan";
  $("#tx-cancel").hidden = true;
  $("#tx-form").reset();
  $("#tx-date").value = todayStr();
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
  $("#form-title").textContent = "Ubah Transaksi";
  $("#tx-submit").textContent = "Simpan Perubahan";
  $("#tx-cancel").hidden = false;
  switchTab("tambah");
  window.scrollTo(0, 0);
}

$("#tx-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#tx-submit");
  btn.disabled = true;
  try {
    const amount = parseInt(($("#tx-amount").value || "").replace(/\D/g, ""), 10);
    if (!amount || amount <= 0) throw new Error("Nominal harus lebih dari 0");
    let receipt_key = "";
    const file = $("#tx-file").files[0];
    if (file) {
      const fd = new FormData();
      fd.append("file", file);
      const up = await fetch("/api/upload", {
        method: "POST",
        headers: { Authorization: "Bearer " + state.token },
        body: fd,
      });
      const ud = await up.json().catch(() => ({}));
      if (!up.ok) throw new Error(ud.error || "Upload struk gagal");
      receipt_key = ud.key;
    }
    const body = {
      date: $("#tx-date").value,
      type: state.formType,
      category: $("#tx-category").value,
      amount,
      note: $("#tx-note").value.trim(),
      ...(receipt_key ? { receipt_key } : {}),
    };
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
      toast("Tersimpan ✅ — notif dikirim ke Telegram");
    }
    resetForm();
  } catch (err) {
    toast(err.message, false);
  }
  btn.disabled = false;
});

// ---------------- init ----------------
if (state.token) showApp().catch(() => logout());
