// @ts-check
// The basic version: plain HTML pages, rendered on the server, for browsers that do not run
// the app. Opera Mini in its default "extreme" mode renders pages on Opera's servers and runs
// a page's JavaScript there for only a few seconds, with no service worker
// (help.opera.com/en/opera-mini-and-javascript/, checked 21 Oct 2026); a phone with
// JavaScript off gets nothing from a single-page app. About a fifth of Nigerian mobile
// browsing is Opera (Statcounter, Sep 2026), and Statcounter does not say how much of it is
// Opera Mini. So the links people tap in WhatsApp also work as plain pages:
//   - view a plan (when, where, the price or entry, the weather, who is going);
//   - say "I'm going", "Maybe" or "Not going" with a form;
//   - join the crew with a name and a neighbourhood, if the link is an invite;
//   - see the crew's coming plans.
// Served for /c/<slug> and /c/<slug>/p/<id> when the browser is Opera Mini (its User-Agent
// says "Opera Mini", or Opera's proxy sends X-OperaMini-Phone-UA) or the URL has ?basic=1
// (the link the app's <noscript> offers). Forms post to /basic/... and redirect back (303).
//
// Everything printed is escaped. No scripts, no external styles, one small inline style.

import { AppError } from "../app/errors.mjs";
import { DAY_NAMES, localParts, parseInstant } from "../core/time.mjs";
import { clockWords } from "../core/weather.mjs";
import { BASE_HEADERS, compress, pickEncoding } from "./http.mjs";

/** @typedef {import("node:http").IncomingMessage} Req */
/** @typedef {import("node:http").ServerResponse} Res */

export const PAGE_ROUTE = /^\/c\/([a-z0-9-]{1,64})(?:\/p\/([A-Za-z0-9_-]{1,64})(?:\/(in|maybe))?|\/join)?\/?$/;
/** Any other page of the app (no file extension): the basic version says what needs the full app. */
export const APP_ROUTE = /^\/(?:[a-z0-9-]+(?:\/[A-Za-z0-9_-]+)*)?\/?$/;

/** True when this request should get the basic pages. */
export function wantsBasic(/** @type {Req} */ req, /** @type {URL} */ url) {
  if (url.searchParams.get("basic") === "1") return true;
  if (req.headers["x-operamini-phone-ua"]) return true;
  return /Opera Mini/i.test(String(req.headers["user-agent"] || ""));
}

const esc = (/** @type {any} */ s) => String(s ?? "").replace(/[&<>"']/g, (c) => /** @type {any} */ ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** "Saturday 24 October, 3 pm to 6 pm" in the plan's zone. */
export function whenWords(start, end, tz) {
  const s = localParts(parseInstant(start), tz);
  const day = `${DAY_NAMES[s.weekday]} ${Number(s.date.slice(8, 10))} ${MONTHS[Number(s.date.slice(5, 7)) - 1]}`;
  if (!end) return `${day}, ${clockWords(s.time)}`;
  const e = localParts(parseInstant(end), tz);
  return `${day}, ${clockWords(s.time)} to ${clockWords(e.time)}`;
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function page(/** @type {string} */ title, /** @type {string} */ body) {
  return `<!doctype html>
<html lang="en-NG"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>body{font:16px/1.5 system-ui,-apple-system,Roboto,"Segoe UI",Arial,sans-serif;margin:0 auto;max-width:34em;padding:12px 16px 32px;background:#E3EBD2;color:#14302A}h1{font-size:1.5em;line-height:1.2;margin:.4em 0}h2{font-size:1.1em;margin:1.2em 0 .3em}.box{background:#F8FAF1;padding:10px 12px;border-radius:12px;margin:10px 0}button,.btn{display:inline-block;font:inherit;font-weight:bold;padding:10px 16px;margin:4px 6px 4px 0;border:2px solid #14302A;border-radius:999px;background:#FFC21A;color:#14302A;text-decoration:none}button.plain{background:#F8FAF1}input{font:inherit;padding:8px;width:100%;box-sizing:border-box;margin:4px 0 10px;border:2px solid #4F655B;border-radius:10px}.small{font-size:.875em;color:#3D574E}a{color:#1B6782}.wa{background:#0E7A3F;color:#fff;border-color:#0E7A3F}</style>
</head><body>
${body}
<p class="small">The basic version of Come Through, for Opera Mini and phones without JavaScript.</p>
</body></html>`;
}

/** Send an HTML page, compressed when the browser accepts it. */
function sendHtml(/** @type {Res} */ res, /** @type {Req} */ req, /** @type {number} */ status, /** @type {string} */ html) {
  const enc = pickEncoding(req.headers["accept-encoding"]);
  const body = enc ? compress(Buffer.from(html), enc, { fast: true }) : Buffer.from(html);
  res.writeHead(status, { ...BASE_HEADERS, "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-length": String(body.length), vary: "Accept-Encoding, User-Agent", ...(enc ? { "content-encoding": enc } : {}) });
  res.end(body);
}

const link = (/** @type {string} */ slug, /** @type {string|null} */ id, /** @type {string} */ token) => `/c/${encodeURIComponent(slug)}${id ? `/p/${encodeURIComponent(id)}` : ""}?t=${encodeURIComponent(token)}&basic=1`;

/** The WhatsApp message for a plan, as the app writes it: the plan first, one link per answer. */
function planShare(/** @type {any} */ plan, /** @type {any} */ crew, /** @type {string} */ webUrl) {
  const base = `${webUrl}/c/${crew.slug}/p/${plan.id}`;
  const q = `?t=${encodeURIComponent(crew.inviteToken)}`;
  const at = plan.place?.name && !plan.place?.hidden ? ` at ${plan.place.name}` : "";
  const first = plan.kind === "ritual" && at ? `${whenWords(plan.start, plan.end, plan.tz)}${at}` : `${plan.title}, ${whenWords(plan.start, plan.end, plan.tz)}${at}`;
  return `https://wa.me/?text=${encodeURIComponent(`${first}. Come through?\nI'm in: ${base}/in${q}\nMaybe: ${base}/maybe${q}`)}`;
}

/**
 * The one-tap answer from the chat (/c/<slug>/p/<id>/in or /maybe). A GET never answers, because
 * WhatsApp fetches links to draw their previews: a member gets one button, a new phone a name
 * and the same button, and the POST records it.
 */
function oneTapHtml({ plan, crew, you }, /** @type {string} */ token, /** @type {"going"|"maybe"} */ answer) {
  const label = answer === "going" ? "I'm in" : "Maybe";
  const already = you && plan.you === answer;
  const head = `<p class="small">${esc(crew.name)}</p><h1>${esc(plan.title)}</h1><p>${esc(whenWords(plan.start, plan.end, plan.tz))}${plan.place?.name ? `, ${esc(plan.place.name)}` : ""}</p>`;
  const going = (plan.going || []).join(", ");
  const who = `<p class="small">${going ? `Going: ${esc(going)}` : "Nobody on the branch yet."}</p>`;
  if (already) return page(`${plan.title}: Come Through`, `${head}<h2>${answer === "going" ? "You're in." : "You said maybe."}</h2>${who}<p><a href="${esc(link(crew.slug, plan.id, token))}">The plan and who's going</a></p>`);
  const form = you
    ? `<form method="post" action="/basic/rsvp/${esc(plan.id)}"><input type="hidden" name="t" value="${esc(token)}"><button name="rsvp" value="${answer}">${label}</button></form>`
    : `<form method="post" action="/basic/join/${esc(crew.slug)}"><input type="hidden" name="t" value="${esc(token)}"><input type="hidden" name="next" value="${esc(plan.id)}"><input type="hidden" name="rsvp" value="${answer}">
<label>What should the crew call you?<input name="name" maxlength="40" required></label>
<button>${label}</button></form><p class="small">No sign-up. The link this takes you to is yours: keep it to answer again.</p>`;
  return page(`${plan.title}: Come Through`, `${head}${who}${form}`);
}

/** The plan as a plain page. */
function planHtml({ plan, crew, you, members }, /** @type {string} */ token, /** @type {string} */ webUrl) {
  const slug = crew.slug;
  const where = plan.place?.hidden ? `${plan.place.name || "A member's place"} (the address shows once you join)` : [plan.place?.name, plan.place?.address].filter(Boolean).join(", ");
  const entry = plan.price ? plan.price.text : plan.place?.entry ? (plan.place.entry.free === true ? "Free to get in" : plan.place.entry.free === false ? plan.place.entry.note || "There is a fee to get in" : "Entry: check at the gate") : null;
  const going = (plan.going || []).join(", ");
  const maybe = (plan.maybe || []).join(", ");
  const share = planShare(plan, crew, webUrl);
  const rows = [
    `<p><b>When:</b> ${esc(whenWords(plan.start, plan.end, plan.tz))}</p>`,
    where ? `<p><b>Where:</b> ${esc(where)}</p>` : "",
    entry ? `<p><b>Price:</b> ${esc(entry)}</p>` : "",
    plan.weather && plan.place?.outdoor ? `<p><b>Weather:</b> ${esc(plan.weather.summary)}</p>` : "",
    plan.rainPlan ? `<p>${esc(plan.rainPlan.note)}</p>` : "",
    plan.status === "cancelled" && plan.rainPlan?.kind !== "skip" ? "<p><b>This plan is called off.</b></p>" : "",
    plan.invite ? `<p>${esc(plan.invite)}</p>` : "",
  ].join("\n");
  const who = `<h2>Who's going</h2><p>${going ? esc(going) : "Nobody yet."}${maybe ? `<br><span class="small">Maybe: ${esc(maybe)}</span>` : ""}</p>`;
  let act = "";
  if (plan.status !== "cancelled") {
    if (you) {
      const mine = plan.you;
      act = `<h2>${mine === "going" ? "You're going" : mine === "maybe" ? "You said maybe" : "Are you coming?"}</h2>
<form method="post" action="/basic/rsvp/${esc(plan.id)}"><input type="hidden" name="t" value="${esc(token)}">
<button name="rsvp" value="going">I'm going</button><button name="rsvp" value="maybe" class="plain">Maybe</button>${mine ? '<button name="rsvp" value="none" class="plain">Not going</button>' : ""}
</form><p class="small">Can't make it? No need to say anything.</p>`;
    } else {
      act = `<h2>Coming? Add your name</h2>
<form method="post" action="/basic/join/${esc(slug)}"><input type="hidden" name="t" value="${esc(token)}"><input type="hidden" name="next" value="${esc(plan.id)}">
<label>Your name<input name="name" maxlength="40" required></label>
<label>Where you're coming from (optional)<input name="area" maxlength="60"></label>
<button name="rsvp" value="going">I'm going</button><button name="rsvp" value="maybe" class="plain">Maybe</button></form>`;
    }
  }
  const back = `<p><a href="${esc(link(slug, null, token))}">All plans from ${esc(crew.name)}</a></p>`;
  return page(`${plan.title}: Come Through`, `<p class="small">${esc(crew.name)}</p><h1>${esc(plan.title)}</h1><div class="box">${rows}</div>${who}${act}
<p><a class="btn wa" href="${esc(share)}">Share on WhatsApp</a></p>${back}`);
}

function crewHtml({ crew, plans, you }, /** @type {string} */ token) {
  const live = plans.filter((/** @type {any} */ p) => p.status !== "cancelled" || p.rainPlan?.kind === "skip");
  const list = live.length
    ? `<ul>${live.map((/** @type {any} */ p) => `<li><a href="${esc(link(crew.slug, p.id, token))}">${esc(p.title)}</a><br><span class="small">${esc(whenWords(p.start, p.end, p.tz))}${p.you === "going" ? ", you're going" : ""}${p.rainPlan?.kind === "skip" ? ", skipped for rain" : ""}</span></li>`).join("")}</ul>`
    : "<p>Nothing planned yet.</p>";
  const join = you ? "" : `<h2>Join ${esc(crew.name)}</h2>
<form method="post" action="/basic/join/${esc(crew.slug)}"><input type="hidden" name="t" value="${esc(token)}">
<label>Your name<input name="name" maxlength="40" required></label>
<label>Where you're coming from (optional)<input name="area" maxlength="60"></label>
<button>Join the crew</button></form>`;
  return page(`${crew.name}: Come Through`, `<h1>${esc(crew.name)}</h1>${you ? `<p class="small">You're in as ${esc(you.name)}.</p>` : ""}<h2>Coming up</h2>${list}${join}`);
}

/** Read a small urlencoded form. */
async function readForm(/** @type {Req} */ req) {
  /** @type {Buffer[]} */
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > 8 * 1024) throw new AppError(413, "too_large", "That form is too large.");
    chunks.push(c);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

/**
 * Handle a basic request. Resolves true when it answered.
 * @param {{ service: any, webUrl: string }} deps
 */
export function basicHandler({ service, webUrl }) {
  return async (/** @type {Req} */ req, /** @type {Res} */ res, /** @type {URL} */ url) => {
    const token = url.searchParams.get("t") || "";
    try {
      if (req.method === "GET") {
        const m = PAGE_ROUTE.exec(url.pathname);
        if (!m) {
          if (!APP_ROUTE.test(url.pathname)) return false;
          sendHtml(res, req, 200, page("Come Through", "<h1>This part needs the full app</h1><p>Starting a crew and adding a plan need a browser that runs the full app, such as Chrome, or Opera with data savings set to off or high. Opera Mini's extreme mode cannot run it.</p><p>Plan links from the group chat work here: open one to see the plan and say if you're coming.</p>"));
          return true;
        }
        if (!token) {
          sendHtml(res, req, 401, page("Come Through", "<h1>This link is missing its key</h1><p>Open the link from the group chat again: it ends in ?t=...</p>"));
          return true;
        }
        if (m[2] && m[3]) sendHtml(res, req, 200, oneTapHtml(await service.getPlan({ id: m[2], token }), token, m[3] === "in" ? "going" : "maybe"));
        else if (m[2]) sendHtml(res, req, 200, planHtml(await service.getPlan({ id: m[2], token }), token, webUrl));
        else sendHtml(res, req, 200, crewHtml(await service.getCrew({ slug: m[1], token }), token));
        return true;
      }
      if (req.method === "POST") {
        const rsvp = /^\/basic\/rsvp\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname);
        const join = /^\/basic\/join\/([a-z0-9-]{1,64})$/.exec(url.pathname);
        if (!rsvp && !join) return false;
        const form = await readForm(req);
        const t = form.get("t") || "";
        if (rsvp) {
          const value = form.get("rsvp");
          const out = await service.patchPlan({ id: rsvp[1], token: t, body: { rsvp: value === "going" || value === "maybe" ? value : null } });
          const crewSlug = (await service.getPlan({ id: out.plan.id, token: t })).crew.slug;
          res.writeHead(303, { ...BASE_HEADERS, location: link(crewSlug, out.plan.id, t) }).end();
          return true;
        }
        const joined = await service.joinCrew({ slug: /** @type {RegExpExecArray} */ (join)[1], token: t, body: { name: form.get("name"), area: form.get("area") || null } });
        const next = form.get("next");
        // joining from a plan answers it in the same tap
        const answer = form.get("rsvp");
        if (next && /^[A-Za-z0-9_-]{1,64}$/.test(next) && (answer === "going" || answer === "maybe")) await service.patchPlan({ id: next, token: joined.memberToken, body: { rsvp: answer } });
        res.writeHead(303, { ...BASE_HEADERS, location: link(/** @type {RegExpExecArray} */ (join)[1], next && /^[A-Za-z0-9_-]{1,64}$/.test(next) ? next : null, joined.memberToken) }).end();
        return true;
      }
      return false;
    } catch (e) {
      const err = /** @type {any} */ (e);
      const status = Number.isInteger(err.status) ? err.status : 500;
      const msg = err instanceof AppError || err.code ? err.message : "Something went wrong on our side. Try again in a minute.";
      sendHtml(res, req, status, page("Come Through", `<h1>That didn't work</h1><p>${esc(msg)}</p><p>Open the link from the group chat again to start over.</p>`));
      return true;
    }
  };
}
