import { test } from "node:test";
import assert from "node:assert/strict";
import { formatIDR, txMessage, batchMessage, debtMessage } from "../src/telegram.js";

test("formatIDR: format Indonesia", () => {
  assert.equal(formatIDR(1500000), "Rp1.500.000");
  assert.equal(formatIDR(0), "Rp0");
  assert.equal(formatIDR(500), "Rp500");
});

test("txMessage: XSS di-escape", () => {
  const msg = txMessage({
    type: "out",
    amount: 25000,
    category: '<script>alert("x")</script>',
    date: "2026-10-20",
    note: "<b>tebal</b>",
    input_by: "bobby",
  });
  assert.ok(!msg.includes("<script>"), "tag script lolos!");
  assert.ok(msg.includes("&lt;script&gt;"), "escape tidak jalan");
  assert.ok(msg.includes("&lt;b&gt;tebal&lt;/b&gt;"));
  assert.ok(msg.includes("Rp25.000"));
  assert.ok(msg.includes("UANG KELUAR"));
});

test("txMessage: tipe masuk", () => {
  const msg = txMessage({ type: "in", amount: 100000, category: "Gaji", date: "2026-10-01" });
  assert.ok(msg.includes("UANG MASUK"));
  assert.ok(msg.includes("Rp100.000"));
});

test("batchMessage: rekap & total benar", () => {
  const txs = [
    { type: "in", amount: 100000, category: "Gaji", note: "" },
    { type: "out", amount: 25000, category: "Makan & Minum", note: "siang" },
    { type: "out", amount: 15000, category: "Vape", note: "" },
  ];
  const msg = batchMessage(txs, "bobby");
  assert.ok(msg.includes("3 TRANSAKSI BARU"));
  assert.ok(msg.includes("Rp100.000"), "total masuk salah");
  assert.ok(msg.includes("Rp40.000"), "total keluar salah");
  assert.ok(msg.includes("Makan &amp; Minum"), "& tidak di-escape");
});

test("debtMessage: hutang vs piutang", () => {
  const hutang = debtMessage({
    type: "hutang", person: "Budi", amount: 500000,
    start_date: "2026-10-01", due_date: "2026-11-01", note: "", input_by: "",
  });
  assert.ok(hutang.includes("HUTANG BARU"));
  assert.ok(hutang.includes("Budi"));
  const piutang = debtMessage({
    type: "piutang", person: "<img>", amount: 100000,
    start_date: "2026-10-01", due_date: "", note: "", input_by: "",
  });
  assert.ok(piutang.includes("PIUTANG BARU"));
  assert.ok(!piutang.includes("<img>"), "XSS lolos di nama orang!");
});
