// @ts-check
// The growth use cases (docs/SPEC.md, "Growth"): rename a crew, the sloth's name ideas, a
// member's own photo (members and the crew's link only), what a member has already seen,
// and what the crew page and the preview cards may know. The rules live in
// src/core/growth.mjs; this file checks who is asking, loads, saves and calls Gemma.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkCrewName, crewCard, fallbackNames, groundedNames, growthView, linkupIds, mergeLinkups, nameVocab, planCard } from "../core/growth.mjs";
import { isExpired } from "../core/plans.mjs";
import { localisePrompt, splitPrompt } from "../core/tasks.mjs";
import { DAY_NAMES } from "../core/time.mjs";
import { packFor, regionOf } from "../packs/index.mjs";
import { AppError, badToken, invalid, noToken, notFound } from "./errors.mjs";
import { safeEqual } from "./ids.mjs";

/** A face is a small square picture made on the phone (128 px, about 20 KB). */
export const FACE_MAX_BYTES = 48 * 1024;
export const FACE_TYPES = ["image/webp", "image/jpeg", "image/png"];
/** Keys a member can mark as seen: "another-crew", "status:<plan id>". */
const SEEN_KEY = /^(another-crew|status:p_[a-z0-9]{4,40})$/;
const SEEN_MAX = 40;

/** Words that give a Lagos crew's name ideas a little flavour (the vocabulary check allows them). */
const FLAVOUR = { lagos: ["owambe", "jollof", "suya", "danfo", "gbedu", "enjoyment", "vibes", "linkup"] };

const NAME_PROMPT = () => fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../core/prompts/name-crew.md"), "utf8");

export const NAME_SCHEMA = {
  type: "object",
  properties: { names: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 } },
  required: ["names"],
};

/**
 * @param {object} deps
 * @param {import("../adapters/store.mjs").Store} deps.store
 * @param {{ available: boolean, generate(req: any): Promise<any> }} deps.ai
 * @param {() => number} deps.now
 * @param {(event: string, fields?: Record<string, any>) => void} [deps.log]
 * @param {string} [deps.promptText]  the name prompt (default: src/core/prompts/name-crew.md)
 * @param {number} [deps.gemmaMs]   how long someone waits for the name ideas
 */
export function createGrowth({ store, ai, now, log = () => {}, promptText = NAME_PROMPT(), gemmaMs = 20_000 }) {
  const prompt = splitPrompt(promptText, "name-crew");

  async function crewBySlug(/** @type {string} */ slug) {
    const crew = await store.findOne("crews", { slug: String(slug) });
    if (!crew) throw notFound("That crew");
    return crew;
  }

  /** The crew and who is asking: a member (member token), a guest (invite token), or nobody. */
  async function viewer(/** @type {string} */ slug, /** @type {string|null} */ token) {
    if (!token) throw noToken();
    const crew = await crewBySlug(slug);
    if (safeEqual(token, crew.inviteToken)) return { crew, member: null };
    const member = await store.findOne("members", { token: String(token) });
    if (member && member.crewId === crew.id) return { crew, member };
    throw badToken();
  }

  async function asMember(/** @type {string} */ slug, /** @type {string|null} */ token) {
    const v = await viewer(slug, token);
    if (!v.member) throw new AppError(403, "members_only", "Join the crew first.");
    return /** @type {{ crew: any, member: any }} */ (v);
  }

  /** You, by your own token, for your own member id. */
  async function self(/** @type {string} */ memberId, /** @type {string|null} */ token) {
    if (!token) throw noToken();
    const member = await store.findOne("members", { token: String(token) });
    if (!member || member.id !== memberId) throw badToken();
    return member;
  }

  // ------------------------------------------------------------ the crew's name

  /** Rename the crew (any member). New messages, cards and calendars use the new name. */
  async function renameCrew({ slug, token, body }) {
    const { crew, member } = await asMember(slug, token);
    const { name, error } = checkCrewName(body?.name);
    if (!name) throw invalid([{ field: "name", message: /** @type {string} */ (error) }]);
    const previous = crew.name;
    if (name !== previous) {
      await store.put("crews", { ...crew, name, renamedAt: new Date(now()).toISOString() });
      log("crew_renamed", { crew: crew.id, member: member.id });
    }
    return { name, previous };
  }

  /** The facts the name prompt may see: areas, the regular day, vibe words and taste, never needs. */
  function nameFacts(/** @type {any} */ crew) {
    const t = crew.taste || {};
    const lines = [];
    if (crew.areas?.length) lines.push(`Neighbourhoods: ${crew.areas.map((/** @type {any} */ a) => a.label).join(", ")}`);
    if (crew.rhythm) lines.push(`They meet on: ${DAY_NAMES[crew.rhythm.day]}`);
    const vibe = [crew.vibe, ...(crew.vibeTags || [])].filter(Boolean);
    if (vibe.length) lines.push(`Vibe words: ${vibe.join(", ")}`);
    const into = [...(t.scenes || []), ...(t.likes || []), ...(t.placeKinds || [])];
    if (into.length) lines.push(`Into: ${into.join(", ")}`);
    if (t.energy) lines.push(`Energy: ${t.energy}`);
    lines.push(`Current name (suggest something else): ${crew.name}`);
    return lines.join("\n");
  }

  /** "Let the sloth name you": three grounded names; code's own when Gemma is away. */
  async function suggestNames({ slug, token }) {
    const { crew } = await asMember(slug, token);
    const region = regionOf(crew);
    const pack = packFor(region);
    const flavour = /** @type {Record<string, string[]>} */ (FLAVOUR)[pack.id] || [];
    const vocab = nameVocab(crew, { city: region.city, flavour });
    const local = localisePrompt(prompt, pack.local(region));
    const flavourLine = flavour.length
      ? `A light local flavour is welcome, using only these words if any: ${flavour.join(", ")}.`
      : "Keep the names neutral: plain words a group anywhere would use.";
    const messages = [
      { role: "system", content: local.system },
      { role: "user", content: local.user.replace("{{facts}}", nameFacts(crew)).replace("{{flavour}}", flavourLine) },
    ];
    let names = [];
    let fromAi = false;
    if (ai.available) {
      try {
        const call = ai.generate({ task: "name-crew", messages, schema: NAME_SCHEMA, maxTokens: 200 });
        const r = await Promise.race([call, new Promise((res) => setTimeout(() => res(null), gemmaMs).unref?.())]);
        names = groundedNames(r?.data, vocab, crew.name);
        fromAi = names.length > 0;
        log("gemma", { task: "name-crew", kept: names.length, offered: Array.isArray(r?.data?.names) ? r.data.names.length : 0 });
      } catch (e) {
        log("gemma_error", { task: "name-crew", message: String(/** @type {any} */ (e)?.message).slice(0, 120) });
      }
    }
    for (const n of fallbackNames(crew, { flavour })) if (names.length < 3 && !names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
    return { names: names.slice(0, 3), ai: fromAi };
  }

  // ------------------------------------------------------------ your face

  /** Save your photo: a small square picture made on your phone. Members only see it. */
  async function setFace({ memberId, token, image }) {
    const member = await self(memberId, token);
    if (!image?.data?.length) throw invalid([{ field: "face", message: "Pick a photo first." }]);
    if (!FACE_TYPES.includes(image.mimeType)) throw new AppError(415, "not_an_image", "That file is not a photo this app can use. Try another.");
    if (image.data.length > FACE_MAX_BYTES) throw new AppError(413, "too_large", "That photo is too large. Try again and it will be shrunk first.");
    const v = crypto.createHash("sha256").update(image.data).digest("base64url").slice(0, 10);
    await store.put("faces", { id: member.id, crewId: member.crewId, mimeType: image.mimeType, data: image.data.toString("base64"), v, updatedAt: new Date(now()).toISOString() });
    await store.put("members", { ...member, faceV: v });
    log("face_set", { crew: member.crewId, member: member.id, bytes: image.data.length });
    return { faceV: v };
  }

  /** Take your photo down. Your sloth comes back. */
  async function removeFace({ memberId, token }) {
    const member = await self(memberId, token);
    await store.delete("faces", member.id);
    const { faceV, ...rest } = member;
    await store.put("members", rest);
    log("face_removed", { crew: member.crewId, member: member.id });
    return null;
  }

  /** A member's photo, for someone with the crew's own link or a member's (never anyone else). */
  async function getFace({ memberId, token }) {
    if (!token) throw noToken();
    const face = await store.get("faces", String(memberId));
    if (!face) throw notFound("That photo");
    const crew = await store.get("crews", face.crewId);
    if (!crew) throw notFound("That photo");
    if (!safeEqual(token, crew.inviteToken)) {
      const asker = await store.findOne("members", { token: String(token) });
      if (!asker || asker.crewId !== face.crewId) throw badToken();
    }
    return { data: Buffer.from(face.data, "base64"), mimeType: face.mimeType, v: face.v };
  }

  // ------------------------------------------------------------ what you have seen

  /** Remember a one-time card as seen (dismissed or used), for this member on every phone. */
  async function markSeen({ memberId, token, body }) {
    const member = await self(memberId, token);
    const key = String(body?.key || "");
    if (!SEEN_KEY.test(key)) throw invalid([{ field: "key", message: "That is not something to remember." }]);
    const seen = Array.isArray(member.seen) ? member.seen : [];
    if (!seen.includes(key)) await store.put("members", { ...member, seen: [...seen, key].slice(-SEEN_MAX) });
    return { seen: seen.includes(key) ? seen : [...seen, key].slice(-SEEN_MAX) };
  }

  // ------------------------------------------------------------ the crew page

  /**
   * What the crew page adds for a member: how many linkups, the day-after plan, whether you
   * have come through yet, and what you have seen. The crew keeps the ids of its linkups,
   * because plans expire 30 days after they end.
   * @param {{ crew: any, member: any|null, plans: any[], tz: string }} p
   */
  async function crewExtras({ crew, member, plans, tz }) {
    if (!member) return null;
    const t = now();
    const merged = mergeLinkups(crew.linkups, linkupIds(plans, t));
    if (merged.length !== (crew.linkups || []).length) {
      crew.linkups = merged;
      // the latest crew document, so a rename made a moment ago is not undone
      const fresh = await store.get("crews", crew.id);
      if (fresh) await store.put("crews", { ...fresh, linkups: mergeLinkups(fresh.linkups, merged) });
    }
    return growthView({ crew, member, plans, now: t, tz });
  }

  // ------------------------------------------------------------ preview cards

  /**
   * What a link's preview may show: a plan's card or the crew invite's, for a link that
   * carries the crew's invite key or a member's. Null for anything else (the generic card).
   * @param {{ slug: string, planId?: string|null, token: string|null }} p
   */
  async function cardFor({ slug, planId = null, token }) {
    if (!token) return null;
    const crew = await store.findOne("crews", { slug: String(slug) });
    if (!crew) return null;
    if (!safeEqual(token, crew.inviteToken)) {
      const m = await store.findOne("members", { token: String(token) });
      if (!m || m.crewId !== crew.id) return null;
    }
    const members = await store.find("members", { crewId: crew.id });
    members.sort((a, b) => String(a.joinedAt).localeCompare(String(b.joinedAt)));
    const tz = regionOf(crew).timezone;
    if (planId) {
      const plan = await store.get("plans", String(planId));
      if (!plan || plan.crewId !== crew.id || isExpired(plan, now())) return null;
      return { crew, card: planCard({ crew, plan, members, tz }), ref: { kind: "p", id: plan.id } };
    }
    return { crew, card: crewCard({ crew, members }), ref: { kind: "c", id: crew.slug } };
  }

  /**
   * The card behind a signed image link (/api/og/p/<id>.png?k=...): the key is the crew's
   * own, so the link works only for a card someone was given.
   * @param {{ kind: "p"|"c", id: string, key: string|null, sign: (crew: any, kind: string, id: string) => string }} p
   */
  async function cardBySignature({ kind, id, key, sign }) {
    let crew, plan = null;
    if (kind === "p") {
      plan = await store.get("plans", String(id));
      if (!plan || isExpired(plan, now())) return null;
      crew = await store.get("crews", plan.crewId);
    } else crew = await store.findOne("crews", { slug: String(id) });
    if (!crew || !key || !safeEqual(key, sign(crew, kind, id))) return null;
    const members = await store.find("members", { crewId: crew.id });
    members.sort((a, b) => String(a.joinedAt).localeCompare(String(b.joinedAt)));
    const tz = regionOf(crew).timezone;
    return plan ? planCard({ crew, plan, members, tz }) : crewCard({ crew, members });
  }

  return { renameCrew, suggestNames, setFace, removeFace, getFace, markSeen, crewExtras, cardFor, cardBySignature };
}
