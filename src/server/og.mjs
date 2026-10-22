// @ts-check
// Link previews (Open Graph) for WhatsApp, Facebook, X, iMessage and Slack. Every crew
// link and plan link gets its own og:title, og:description and a 1200x630 og:image drawn
// on the server: the sloth on the branch, the plan's title, day, time and place, and the
// people going as their sloth avatars (never a photo), with the site's address, small.
//
// Why satori and resvg-js, not @napi-rs/canvas: the card is a layout (a title that wraps to
// two lines, a row of faces, a footer), and satori lays it out with flexbox and measures the
// text with the bundled fonts, so no text is guessed at. Its output is SVG, so the sloth
// and the avatars, which are SVG already (src/core/avatar.mjs, shared with the web app),
// go in as they are. resvg-js turns that into a PNG with one small prebuilt binary (about
// 4 MB per platform, against Skia's 37 MB for @napi-rs/canvas on Linux). Fonts: Shrikhand
// (the app's display face) and Noto Sans Bold, both under the SIL Open Font License, in
// assets/fonts with their licences.
//
// Discreet crews get the same generic card ("A plan with your crew"): no title, no place, no
// crew name, no names, no faces. Image links are signed with the crew's own invite key, so
// a card can be fetched only through a link someone was given; they carry a version, so a
// change (a new title, someone going) is a new image, and an unchanged card is drawn once.
// The preview never answers for anyone: the pages behind "I'm in" only answer from their
// script (docs/SPEC.md, "One tap from the chat"), and these tags are plain HTML.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BRANCH, SLOTH } from "../core/art.mjs";
import { avatarInner } from "../core/avatar.mjs";
import { discreetCard } from "../core/growth.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.resolve(here, "../../assets/fonts");

export const OG_W = 1200;
export const OG_H = 630;
const INK = "#14302a";
const INK2 = "#3d574e";
const WALL = "#e3ebd2";
const PAPER = "#f8faf1";
const DANFO = "#ffc21a";

/** The app routes that get a preview of their own. */
const LINK = /^\/c\/([a-z0-9-]{1,64})(?:\/p\/([A-Za-z0-9_-]{1,64})(?:\/(?:in|maybe))?)?\/?$/;

const esc = (/** @type {string} */ s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const svgUrl = (/** @type {string} */ svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

const avatarUrl = (/** @type {string} */ id) => svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 48 48"><clipPath id="c"><circle cx="24" cy="24" r="24"/></clipPath><g clip-path="url(#c)">${avatarInner(id)}</g></svg>`);

/** A satori element. */
const h = (/** @type {string} */ type, /** @type {Record<string, any>} */ style, /** @type {any} */ children = undefined, /** @type {Record<string, any>} */ extra = {}) => ({ type, props: { style, children, ...extra } });

/**
 * The card's element tree.
 * @param {ReturnType<typeof discreetCard>} card
 * @param {string} domain
 */
export function cardTree(card, domain) {
  const len = [...card.title].length;
  const size = len <= 22 ? 78 : len <= 40 ? 64 : 52;
  const shown = card.going.slice(0, 7);
  const rest = card.going.length - shown.length;
  const faces = shown.map((id, i) => h("img", { width: 84, height: 84, borderRadius: 42, border: `5px solid ${PAPER}`, marginLeft: i ? -14 : 0 }, undefined, { src: avatarUrl(id), width: 84, height: 84 }));
  if (rest > 0) faces.push(h("div", { display: "flex", alignItems: "center", justifyContent: "center", width: 84, height: 84, borderRadius: 42, border: `5px solid ${PAPER}`, marginLeft: -14, background: "#d6e2c0", color: INK, fontFamily: "Noto Sans", fontSize: 28 }, `+${rest}`));
  return h("div", { width: OG_W, height: OG_H, display: "flex", position: "relative", background: WALL, fontFamily: "Noto Sans" }, [
    h("img", { position: "absolute", left: 0, top: 0, width: 1200, height: 170 }, undefined, { src: svgUrl(BRANCH), width: 1200, height: 170 }),
    h("img", { position: "absolute", left: 900, top: 22, width: 240, height: 280 }, undefined, { src: svgUrl(SLOTH), width: 240, height: 280 }),
    h("div", { position: "absolute", left: 64, top: 150, width: card.discreet ? 820 : 800, display: "flex", flexDirection: "column" }, [
      h("div", { fontFamily: "Shrikhand", fontSize: size, lineHeight: 1.08, color: INK, textShadow: `4px 5px 0 ${DANFO}`, lineClamp: 2, display: "block" }, card.title),
      card.when ? h("div", { marginTop: 22, fontSize: 34, color: INK, display: "flex" }, card.when) : null,
      card.place ? h("div", { marginTop: 6, fontSize: 34, color: INK2, display: "flex" }, card.place) : null,
      card.discreet ? h("div", { marginTop: 22, fontSize: 34, color: INK2, display: "flex" }, "Tap to see it and say if you're coming.") : null,
    ].filter(Boolean)),
    faces.length || card.count
      ? h("div", { position: "absolute", left: 64, bottom: 52, display: "flex", alignItems: "center" }, [
          ...(faces.length ? [h("div", { display: "flex", alignItems: "center" }, faces)] : []),
          card.count ? h("div", { marginLeft: faces.length ? 22 : 0, fontSize: 32, color: INK, display: "flex" }, card.count) : null,
        ].filter(Boolean))
      : null,
    h("div", { position: "absolute", right: 48, bottom: 40, fontSize: 24, color: INK2, display: "flex" }, domain),
  ].filter(Boolean));
}

/**
 * @param {{ growth: ReturnType<typeof import("../app/growth.mjs").createGrowth>, publicUrl: string, log?: (event: string, fields?: Record<string, any>) => void, cacheSize?: number }} opts
 */
export function createOg({ growth, publicUrl, log = () => {}, cacheSize = 120 }) {
  const domain = (() => {
    try {
      const host = new URL(publicUrl).hostname;
      return /^(localhost|127\.|\[|.*\.test$)/.test(host) ? "comethrough.ikpemosi.work" : host.replace(/^www\./, "");
    } catch {
      return "comethrough.ikpemosi.work";
    }
  })();
  /** @type {Promise<{ satori: any, Resvg: any, fonts: any[] }>|null} */
  let tools = null;
  const load = () =>
    (tools ??= (async () => {
      const [{ default: satori }, { Resvg }] = await Promise.all([import("satori"), import("@resvg/resvg-js")]);
      const fonts = [
        { name: "Shrikhand", data: fs.readFileSync(path.join(FONT_DIR, "Shrikhand-Regular.ttf")), weight: 400, style: "normal" },
        { name: "Noto Sans", data: fs.readFileSync(path.join(FONT_DIR, "NotoSans-Bold.ttf")), weight: 700, style: "normal" },
      ];
      return { satori, Resvg, fonts };
    })());

  /** Drawn cards by version: an unchanged card is drawn once. @type {Map<string, Buffer>} */
  const drawn = new Map();

  const version = (/** @type {any} */ card) => crypto.createHash("sha1").update(JSON.stringify([card.title, card.when, card.place, card.going, card.count, domain])).digest("base64url").slice(0, 10);
  const sign = (/** @type {any} */ crew, /** @type {string} */ kind, /** @type {string} */ id) => crypto.createHmac("sha256", String(crew.inviteToken)).update(`og:${kind}:${id}`).digest("base64url").slice(0, 22);

  /**
   * The card as a PNG.
   * @param {any} card
   */
  async function render(card) {
    const v = version(card);
    const hit = drawn.get(v);
    if (hit) return { png: hit, v };
    const t0 = Date.now();
    const { satori, Resvg, fonts } = await load();
    const svg = await satori(cardTree(card, domain), { width: OG_W, height: OG_H, fonts });
    const png = new Resvg(svg, { fitTo: { mode: "width", value: OG_W }, font: { loadSystemFonts: false } }).render().asPng();
    drawn.set(v, png);
    if (drawn.size > cacheSize) drawn.delete(/** @type {string} */ (drawn.keys().next().value));
    log("og_drawn", { ms: Date.now() - t0, bytes: png.length });
    return { png, v };
  }

  /**
   * The <head> tags for an app page (description, Open Graph, Twitter): the plan's or the crew's card for a link with a key,
   * else the generic one. Absolute URLs, because preview fetchers need them.
   * @param {string} pathname
   * @param {string} search
   */
  async function headFor(pathname, search) {
    const m = LINK.exec(pathname);
    const token = new URLSearchParams(search).get("t");
    let found = null;
    if (m) {
      try {
        found = await growth.cardFor({ slug: m[1], planId: m[2] || null, token });
      } catch (e) {
        log("og_error", { message: String(/** @type {any} */ (e)?.message).slice(0, 120) });
      }
    }
    if (!found) return tags({ title: "Come Through", description: "The lazy way to link up. You send one sentence, your crew taps once.", image: `${publicUrl}/api/og/default.png` });
    const { crew, card, ref } = found;
    const image = card.discreet ? `${publicUrl}/api/og/discreet-${card.kind}.png` : `${publicUrl}/api/og/${ref.kind}/${encodeURIComponent(ref.id)}.png?v=${version(card)}&k=${sign(crew, ref.kind, ref.id)}`;
    return tags({ title: card.ogTitle, description: card.ogDescription, image });
  }

  /**
   * The image behind a tag: a signed plan or crew card, the discreet card, or the generic one.
   * @param {{ name: string, key: string|null }} p  name: "p/<id>", "c/<slug>", "discreet-plan", "discreet-crew", "default"
   */
  async function imageFor({ name, key }) {
    if (name === "discreet-plan" || name === "discreet-crew") return render(discreetCard(name === "discreet-plan" ? "plan" : "crew"));
    if (name === "default") return render({ ...discreetCard("crew"), title: "Come through", discreet: true, ogTitle: "Come Through" });
    const m = /^(p|c)\/([A-Za-z0-9_-]{1,64})$/.exec(name);
    if (!m) return null;
    const card = await growth.cardBySignature({ kind: /** @type {"p"|"c"} */ (m[1]), id: m[2], key, sign });
    return card ? render(card) : null;
  }

  return { headFor, imageFor, render, sign, version, domain };
}

/**
 * The tags, for <head>. og:image:width and height let WhatsApp show the big card at once.
 * @param {{ title: string, description: string, image: string }} p
 */
export function tags({ title, description, image }) {
  return [
    `<meta name="description" content="${esc(description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Come Through" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:width" content="${OG_W}" />`,
    `<meta property="og:image:height" content="${OG_H}" />`,
    `<meta property="og:image:alt" content="${esc(title)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
  ].join("\n    ");
}

/**
 * index.html with its description, Open Graph and Twitter tags swapped for these. The page's
 * <title> stays "Come Through" (the tab's name; every fetcher here reads og:title first).
 * @param {string} html
 * @param {string} head
 */
export function withHead(html, head) {
  const stripped = html
    .replace(/\s*<meta\s+(?:name|property)="(?:description|og:[^"]+|twitter:[^"]+)"[^>]*>/gi, "");
  // after the charset, which must come first
  const charset = /<meta\s+charset=[^>]*>/i.exec(stripped);
  if (charset) return stripped.replace(charset[0], `${charset[0]}\n    ${head}`);
  if (/<head>/i.test(stripped)) return stripped.replace(/<head>/i, `<head>\n    ${head}`);
  const doctype = /^<!doctype html>/i.exec(stripped);
  return doctype ? `${doctype[0]}${head}${stripped.slice(doctype[0].length)}` : `${head}${stripped}`;
}
