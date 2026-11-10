import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../js/data.js";

const rawIds = new Set(D.RAW.map(r => r.id));

test("every BOM line names a real raw material with a positive amount", () => {
  for (const j of D.JUICES) {
    assert.ok(Object.keys(j.bom).length >= 3, j.id);
    for (const [k, q] of Object.entries(j.bom)) { assert.ok(rawIds.has(k), `${j.id} uses unknown ${k}`); assert.ok(q > 0); }
  }
});

test("a juice bottle is one litre of liquid, one bottle and one cap", () => {
  for (const j of D.JUICES) {
    const liquid = Object.entries(j.bom).filter(([k]) => D.RAW.find(r => r.id === k).unit === "L").reduce((a, [, q]) => a + q, 0);
    assert.ok(Math.abs(liquid - 1) < 1e-9, `${j.id} liquid ${liquid}`);
    assert.equal(j.bom.bottles, 1); assert.equal(j.bom.caps, 1);
  }
});

test("each juice makes money at its reference price", () => {
  for (const j of D.JUICES) {
    const cost = Object.entries(j.bom).reduce((a, [k, q]) => a + q * D.RAW.find(r => r.id === k).cost, 0);
    assert.ok(j.ref > cost * 1.5, `${j.id} cost ${cost} ref ${j.ref}`);
  }
});

test("ids are unique across retail products, juices and raw materials", () => {
  const all = [...D.PRODUCTS, ...D.JUICES].map(p => p.id);
  assert.equal(new Set(all).size, all.length);
  assert.equal(rawIds.size, D.RAW.length);
});

test("machines match the spec: 1,000 and 3,000 a day", () => {
  assert.deepEqual(D.MACHINES.map(m => m.perDay), [1000, 3000]);
  for (const m of D.MACHINES) assert.ok(m.price > 0 && m.life > 0 && m.wear > 0 && m.pmDays > 0);
  assert.equal(D.MAINT.breakdownBelow, 30); assert.equal(D.MAINT.emergencyMult, 3);
});

test("raw vendors only sell raw materials that exist, and together cover all of them", () => {
  const sold = new Set();
  for (const v of D.RAW_VENDORS) for (const id of v.sells) { assert.ok(rawIds.has(id), id); sold.add(id); }
  assert.equal(sold.size, rawIds.size);
});

test("B2B buyers want known products; rival aggression is below the ceiling", () => {
  const prods = new Set([...D.PRODUCTS, ...D.JUICES].map(p => p.id));
  for (const b of D.B2B.buyers) for (const w of b.want) assert.ok(prods.has(w), w);
  const w = D.B2B.weights; assert.ok(Math.abs(w.price + w.reputation + w.reliability - 1) < 1e-9);
  for (const r of D.B2B.rivals) assert.ok(r.aggression > 0 && r.aggression < 1.2);
});

test("payment terms are COD, Net 7, 14, 30 with rising price", () => {
  assert.deepEqual(D.TERMS.map(t => t.days), [0, 7, 14, 30]);
  for (let i = 1; i < D.TERMS.length; i++) assert.ok(D.TERMS[i].price > D.TERMS[i - 1].price);
});

test("scoring weights cover 8 KPIs and sum to 1", () => {
  assert.equal(D.KPIS.length, 8);
  assert.ok(Math.abs(D.KPIS.reduce((a, k) => a + k.weight, 0) - 1) < 1e-9);
});

test("marketing has the five spec channels", () => {
  assert.deepEqual(D.MKT_CHANNELS.map(c => c.id), ["social", "search", "billboard", "radio", "influencer"]);
  assert.equal(D.HR_ROLES.length, 6);
});

test("index.html loads every module with the build number (import map) so cached old modules cannot mix with a new main.js", async () => {
  const fs = await import("node:fs"), html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const map = JSON.parse(html.match(/<script type="importmap">(.*?)<\/script>/s)[1]).imports, ver = html.match(/js\/main\.js\?v=(\w+)/)[1];
  const files = fs.readdirSync(new URL("../js/", import.meta.url)).filter(f => f.endsWith(".js") && f !== "main.js");
  for (const f of files) assert.equal(map["./js/" + f], `./js/${f}?v=${ver}`, f + " must be in the import map with the same version as main.js");
  assert.ok(!/modulepreload" href="js\/[a-z0-9]+\.js">/.test(html), "preload links carry the version too");
});

test("the page carries Open Graph and Twitter tags, and the preview files exist", async () => {
  const fs = await import("node:fs"), html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const k of ["og:title", "og:description", "og:image", "og:url", "og:type"]) assert.match(html, new RegExp(`property="${k}"`), k);
  for (const k of ["twitter:card", "twitter:image"]) assert.match(html, new RegExp(`name="${k}"`), k);
  assert.match(html, /<meta name="description" content="[^"]{60,}"/); assert.match(html, /og:image" content="https:\/\/[^"]+\/og\.png"/);
  for (const f of ["../og.png", "../favicon.svg"]) assert.ok(fs.statSync(new URL(f, import.meta.url)).size > 100, f);
  assert.equal(fs.readFileSync(new URL("../og.png", import.meta.url)).subarray(1, 4).toString(), "PNG");
});
