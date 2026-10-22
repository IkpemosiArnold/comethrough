// @ts-check
// A tiny local page for scoring the blind human sheet on a phone.
//
//   node eval/score.mjs                 the test set's sheet (eval/results/v2-human-sheet.json)
//   node eval/score.mjs --sheet dev     the dev set's sheet
//   node eval/score.mjs --sheet after-fix   the second scored test run's sheet
//   node eval/score.mjs --summary       print the scores so far
//
// It listens on the local network and prints an address with a key in it; open that on the
// phone (same Wi-Fi). Each crew gets a fit from 1 to 5 and an optional flag. Every tap is
// saved to eval/results/v2-human-scores.json (or v2-dev-human-scores.json); the plain form
// works without JavaScript too.

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const which = argv.includes("--sheet") ? argv[argv.indexOf("--sheet") + 1] : "test";
const sheetFile = path.join(here, "results", which === "dev" ? "v2-dev-human-sheet.json" : which === "after-fix" ? "v2-human-sheet-after-fix.json" : "v2-human-sheet.json");
const scoresFile = path.join(here, "results", which === "dev" ? "v2-dev-human-scores.json" : which === "after-fix" ? "v2-human-scores-after-fix.json" : "v2-human-scores.json");
const port = Number(argv.includes("--port") ? argv[argv.indexOf("--port") + 1] : 8787);

if (!fs.existsSync(sheetFile)) {
  console.error(`No sheet yet: ${path.relative(process.cwd(), sheetFile)}. Run the ${which} set first.`);
  process.exit(2);
}
const sheet = JSON.parse(fs.readFileSync(sheetFile, "utf8"));
/** @type {Record<string, { fit: number|null, flag: string, at: string }>} */
const scores = fs.existsSync(scoresFile) ? JSON.parse(fs.readFileSync(scoresFile, "utf8")).scores || {} : {};
const save = () => fs.writeFileSync(scoresFile, `${JSON.stringify({ set: sheet.set, sheetAt: sheet.at, scores }, null, 1)}\n`);

if (argv.includes("--summary")) {
  const fits = sheet.crews.map((/** @type {any} */ c) => scores[c.key]?.fit).filter((/** @type {any} */ f) => Number.isFinite(f));
  const mean = fits.length ? fits.reduce((/** @type {number} */ s, /** @type {number} */ x) => s + x, 0) / fits.length : null;
  const dist = [1, 2, 3, 4, 5].map((v) => `${v}: ${fits.filter((/** @type {number} */ f) => f === v).length}`).join(", ");
  console.log(`${fits.length} of ${sheet.crews.length} scored; mean fit ${mean == null ? "n/a" : mean.toFixed(2)}; ${dist}`);
  for (const c of sheet.crews) if (scores[c.key]?.flag) console.log(`crew ${c.n}: ${scores[c.key].flag}`);
  process.exit(0);
}

const key = crypto.randomBytes(9).toString("base64url");
const esc = (/** @type {any} */ s) => String(s ?? "").replace(/[&<>"']/g, (c) => /** @type {any} */ ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function pageHtml() {
  const done = sheet.crews.filter((/** @type {any} */ c) => Number.isFinite(scores[c.key]?.fit)).length;
  const cards = sheet.crews.map((/** @type {any} */ c) => {
    const s = scores[c.key] || { fit: null, flag: "" };
    const rit = c.ritual ? `<p><b>The sloth's pick:</b> ${c.ritual.skipped ? `skipped (${esc(c.ritual.note ?? "rain")})` : `${esc(c.ritual.place)}, ${esc(c.ritual.when)}`}${c.ritual.why ? `. ${esc(c.ritual.why)}` : ""}</p>` : "";
    const inv = c.invite ? `<p class="small"><b>Invite:</b> ${esc(c.invite)}</p>` : "";
    const ideas = c.ideas.length ? `<ol>${c.ideas.map((/** @type {any} */ i) => `<li><b>${esc(i.title)}</b> <span class="small">(${esc(i.when)}${i.price ? `, ${esc(i.price)}` : ""})</span><br>${esc(i.why)}</li>`).join("")}</ol>` : "<p class=small>No ideas.</p>";
    const radios = [1, 2, 3, 4, 5].map((v) => `<label class="r"><input type="radio" name="fit_${c.key}" value="${v}"${s.fit === v ? " checked" : ""}><span>${v}</span></label>`).join("");
    return `<section id="c${c.n}"><h2>Crew ${c.n}</h2><blockquote>${esc(c.sentence)}</blockquote>${rit}${inv}<p><b>3 ideas</b></p>${ideas}
<fieldset><legend>Fit, 1 (wrong) to 5 (exactly right)</legend><div class="rs">${radios}</div></fieldset>
<label class="f">Anything off?<input name="flag_${c.key}" value="${esc(s.flag)}" placeholder="optional"></label></section>`;
  }).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Persona scores</title>
<style>
:root{--bg:#F4F1EA;--card:#FFFFFF;--ink:#1D2321;--muted:#5B6661;--line:#D9D3C7;--accent:#0E6B4F}
@media (prefers-color-scheme: dark){:root{--bg:#141716;--card:#1E2321;--ink:#ECEAE4;--muted:#A6AFAA;--line:#38403C;--accent:#5CC59E}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,Roboto,"Segoe UI",sans-serif}
main{max-width:40em;margin:0 auto;padding:12px 16px 96px}
h1{font-size:1.3em;margin:.4em 0}
section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin:14px 0}
h2{font-size:1.05em;margin:.2em 0 .4em}
blockquote{margin:0 0 .6em;padding:.4em .7em;border-left:3px solid var(--accent);color:var(--ink);font-style:italic}
ol{padding-left:1.2em;margin:.3em 0}li{margin:.35em 0}
.small{font-size:.9em;color:var(--muted)}
fieldset{border:0;padding:0;margin:.6em 0 .2em}legend{font-weight:600;font-size:.95em}
.rs{display:flex;gap:8px;margin-top:6px}
.r{flex:1}.r input{position:absolute;opacity:0}.r span{display:block;text-align:center;padding:12px 0;border:2px solid var(--line);border-radius:10px;font-weight:700;min-height:24px;touch-action:manipulation}
.r input:checked+span{background:var(--accent);border-color:var(--accent);color:var(--card)}
.r input:focus-visible+span{outline:3px solid var(--accent);outline-offset:2px}
.f{display:block;margin-top:8px;font-size:.95em}.f input{display:block;width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:10px;border:2px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink);margin-top:4px}
.bar{position:fixed;left:0;right:0;bottom:0;background:var(--card);border-top:1px solid var(--line);padding:10px 16px calc(10px + env(safe-area-inset-bottom));display:flex;gap:12px;align-items:center;justify-content:space-between}
button{font:inherit;font-weight:700;padding:10px 18px;border-radius:999px;border:0;background:var(--accent);color:var(--card)}
#st{font-size:.9em;color:var(--muted)}
</style></head><body><main>
<h1>Persona eval v2${sheet.set === "dev" ? " (dev)" : ""}: does the plan fit the crew?</h1>
<p class="small">${sheet.crews.length} crews, blind and in random order. Tap a fit for each; flags are optional. Every tap is saved.</p>
<form method="post" action="/save?k=${key}" id="f">${cards}
<div class="bar"><span id="st">${done} of ${sheet.crews.length} scored</span><button>Save</button></div></form></main>
<script>
const f=document.getElementById("f"),st=document.getElementById("st");
async function send(){const r=await fetch(f.action,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded","x-js":"1"},body:new URLSearchParams(new FormData(f))});if(r.ok){const j=await r.json();st.textContent=j.done+" of "+j.total+" scored, saved";}else st.textContent="Not saved. Try again.";}
f.addEventListener("change",send);f.addEventListener("submit",e=>{e.preventDefault();send();});
</script></body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://local");
  if (url.searchParams.get("k") !== key) {
    res.writeHead(403, { "content-type": "text/plain" }).end("Open the address the script printed (it has a key in it).");
    return;
  }
  if (req.method === "POST" && url.pathname === "/save") {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 200_000) break;
    }
    const form = new URLSearchParams(body);
    for (const c of sheet.crews) {
      const fit = Number(form.get(`fit_${c.key}`));
      const flag = String(form.get(`flag_${c.key}`) ?? "").slice(0, 500);
      if (Number.isInteger(fit) && fit >= 1 && fit <= 5) scores[c.key] = { fit, flag, at: new Date().toISOString() };
      else if (flag) scores[c.key] = { fit: scores[c.key]?.fit ?? null, flag, at: new Date().toISOString() };
    }
    save();
    const done = sheet.crews.filter((/** @type {any} */ c) => Number.isFinite(scores[c.key]?.fit)).length;
    if (req.headers["x-js"]) res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ done, total: sheet.crews.length }));
    else res.writeHead(303, { location: `/?k=${key}` }).end();
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(pageHtml());
});
server.listen(port, "0.0.0.0", () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => /** @type {any} */ (i).address);
  console.log(`Scoring ${sheet.crews.length} crews (${sheet.set}); saving to ${path.relative(process.cwd(), scoresFile)}`);
  for (const ip of ["localhost", ...ips]) console.log(`  http://${ip}:${port}/?k=${key}`);
  console.log("Open one of these on your phone (same Wi-Fi). Ctrl+C to stop; scores are already saved.");
});
