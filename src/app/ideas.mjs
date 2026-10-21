// @ts-check
// "The sloth has 3 ideas": the use case. GET /api/crews/:slug/ideas?when=tonight|weekend
// answers with one card of three ideas (docs/SPEC.md, "Ideas"). This shell gathers the
// candidates through the ports, lets the core (src/core/ideas.mjs) filter and order them,
// asks Gemma to rank, and caches the card per crew and slot for three hours.
//
// Sources, in the order they are gathered:
//   1. open-data places near the crew's middle, through the service's own places pipeline
//      (OpenStreetMap, Wikidata, a pack's curated spots), given at most 15 s on a request;
//   2. the crew's own history: places it used, plans people came to;
//   3. for packs with curated weekly guides (Lagos: Awe Lagos and Nothing To Do In Lagos),
//      the events in their latest posts, read from the RSS feeds at most once a day.
//      Gemma lists a post's events once; only the checked facts are kept (14 days), keyed
//      by the post's link, and the post's text is dropped right away.
//
// Gemma being away is not an error: the card comes back in the code's own order with the
// code's own reasons, and the events already read stay usable.

import { centroid, haversineKm, isLatLon } from "../core/geo.mjs";
import { EVENTS_MAX_TOKENS, EVENTS_SCHEMA, eventsMessages, freshItems, postText, readEvents } from "../core/feeds.mjs";
import { IDEAS_TTL_MS, RANK_MAX_TOKENS, RANK_SCHEMA, eventCandidates, ideaView, placeCandidates, pool, rankMessages, readRanking, slotFor, usualCandidates } from "../core/ideas.mjs";
import { recentPlaces } from "../core/plans.mjs";
import { localisePrompt } from "../core/tasks.mjs";
import { localParts } from "../core/time.mjs";
import { packFor, regionOf } from "../packs/index.mjs";
import { feedsFor } from "../packs/sources.mjs";
import { badToken, invalid, noToken, notFound } from "./errors.mjs";
import { safeEqual } from "./ids.mjs";

/** @typedef {import("../core/types.mjs").Crew} Crew */
/** @typedef {import("../core/types.mjs").Member} Member */
/** @typedef {import("../core/types.mjs").Plan} Plan */
/** @typedef {import("../core/feeds.mjs").FeedSource} FeedSource */
/** @typedef {import("../core/feeds.mjs").FeedEvent} FeedEvent */

const FACTS_TTL_MS = 14 * 24 * 3_600_000;
const INDEX_TTL_MS = 30 * 24 * 3_600_000;
/** How long a request waits for the places pipeline before going on without it. */
export const PLACES_BUDGET_MS = 15_000;

/**
 * @param {object} deps
 * @param {import("../adapters/store.mjs").Store} deps.store
 * @param {import("../adapters/http.mjs").Cache} deps.cache   ideas, feed facts and feed bookkeeping (the store's "cache" collection in production)
 * @param {import("../adapters/gemini.mjs").AiPort} deps.ai
 * @param {import("../adapters/feeds.mjs").FeedsPort|null} deps.feeds  null: no curated guides (offline, tests)
 * @param {{ hourly(at: { lat: number, lon: number }, opts?: { tz?: string, days?: number }): Promise<any[]> }} deps.weather
 * @param {{ lookup(q: string, ctx?: any): Promise<any>, lookupArea(q: string, ctx?: any): Promise<any> }} deps.geocoder
 * @param {(center: { lat: number, lon: number }, pack: any) => Promise<any[]>} deps.candidatesNear  the service's places pipeline
 * @param {Record<string, import("../core/tasks.mjs").Prompt>} deps.prompts
 * @param {() => number} deps.now
 * @param {(event: string, fields?: Record<string, any>) => void} [deps.log]
 * @param {number} [deps.placesBudgetMs]
 */
export function createIdeas({ store, cache, ai, feeds, weather, geocoder, candidatesNear, prompts, now, log = () => {}, placesBudgetMs = PLACES_BUDGET_MS }) {
  /** @type {Map<string, Promise<any>>} */
  const inflight = new Map();
  /** @type {Map<string, Promise<void>>} */
  const refreshing = new Map();

  const once = (/** @type {Map<string, Promise<any>>} */ m, /** @type {string} */ key, /** @type {() => Promise<any>} */ fn) => {
    let p = m.get(key);
    if (!p) {
      p = fn().finally(() => m.delete(key));
      m.set(key, p);
    }
    return p;
  };

  /** The crew and who is asking (an invite or a member token), as everywhere else. */
  async function viewerOf(/** @type {string} */ slug, /** @type {string|null} */ token) {
    if (!token) throw noToken();
    const crew = /** @type {Crew|null} */ (await store.findOne("crews", { slug: String(slug) }));
    if (!crew) throw notFound("That crew");
    if (safeEqual(token, crew.inviteToken)) return { crew, member: null };
    const member = /** @type {Member|null} */ (await store.findOne("members", { token: String(token) }));
    if (member && member.crewId === crew.id) return { crew, member };
    throw badToken();
  }

  /** Where the crew is: members' areas once two have joined, else the areas named at setup too. */
  function crewPoints(/** @type {Crew} */ crew, /** @type {Member[]} */ members) {
    const fromMembers = members.filter((m) => isLatLon(m.area)).map((m) => ({ id: m.id, name: m.name, area: m.area }));
    if (fromMembers.length >= 2) return fromMembers;
    const declared = (crew.areas || []).filter(isLatLon).map((a, i) => ({ id: `area${i}`, name: a.label, area: a }));
    return [...fromMembers, ...declared.filter((d) => !fromMembers.some((m) => haversineKm(m.area, d.area) < 2))];
  }

  // ------------------------------------------------------------ curated guides

  /**
   * Read a guide's newest posts into facts, at most once a day. Facts per post are kept 14
   * days; a post whose facts could not be read is tried again on the next day's fetch.
   * @param {FeedSource} source
   * @param {{ pack: any, region: any, local: any, tz: string }} where
   */
  async function refreshFeed(source, where) {
    if (!feeds) return;
    const indexKey = `feedposts:${source.id}`;
    /** @type {{ posts: { link: string, published: string|null }[], failed: boolean }} */
    const index = (await cache.get(indexKey)) || { posts: [], failed: false };
    const got = await feeds.pull(source, { conditional: !index.failed });
    if (!got.items) return;
    const today = localParts(now(), where.tz).date;
    let failed = false;
    for (const item of freshItems(got.items, today)) {
      if (await cache.get(`feedfacts:${item.link}`)) continue;
      const { text, links } = postText(item.html, { ownHost: new URL(item.link).host });
      if (text.length < 200) continue;
      const prompt = localisePrompt(prompts["extract-events"], where.local);
      let data = null;
      const t0 = now();
      try {
        const r = await ai.generate({ task: "extract-events", messages: eventsMessages(prompt, { source, item, text, today }), schema: EVENTS_SCHEMA, maxTokens: EVENTS_MAX_TOKENS, temperature: 0.1 });
        data = r.data;
        log("gemma", { task: "extract-events", model: r.model, sec: r.wallSec, parsed: r.data != null });
      } catch (e) {
        log("gemma_error", { task: "extract-events", message: String(/** @type {any} */ (e).message).slice(0, 160) });
      }
      if (!data) {
        failed = true;
        continue;
      }
      const { events, dropped } = readEvents(data, { source, item, text, links });
      // where each venue is, for the distance cap and the trips (cached by the geocoder)
      for (const e of events) e.at = await locate(e, where);
      await cache.set(`feedfacts:${item.link}`, { events, readAt: new Date(now()).toISOString() }, FACTS_TTL_MS);
      log("feed_read", { feed: source.id, post: item.link, events: events.length, dropped: dropped.length, ms: now() - t0 });
      if (!index.posts.some((p) => p.link === item.link)) index.posts.unshift({ link: item.link, published: item.published });
    }
    index.posts = index.posts.slice(0, 6);
    index.failed = failed;
    await cache.set(indexKey, index, INDEX_TTL_MS);
  }

  /** A venue on the map, or its area, or null. Never throws. */
  async function locate(/** @type {FeedEvent} */ e, /** @type {{ pack: any, region: any }} */ where) {
    const ctx = where.pack.geocode(where.region);
    for (const [q, area] of [[e.venue, false], [e.area, true]]) {
      if (!q || /shared|ticket holders|tba|secret/i.test(String(q))) continue;
      try {
        const hit = area ? await geocoder.lookupArea(String(q), ctx) : await geocoder.lookup(String(q), ctx);
        if (hit && isLatLon(hit)) return { lat: hit.lat, lon: hit.lon };
      } catch {}
    }
    return null;
  }

  /** The facts from a guide's recent posts. */
  async function eventsFrom(/** @type {FeedSource} */ source) {
    const index = (await cache.get(`feedposts:${source.id}`)) || { posts: [] };
    /** @type {FeedEvent[]} */
    const out = [];
    for (const p of index.posts.slice(0, 3)) {
      const facts = await cache.get(`feedfacts:${p.link}`);
      if (facts?.events) out.push(...facts.events);
    }
    return out;
  }

  // ------------------------------------------------------------ the card

  /**
   * The crew's three ideas for tonight or the weekend. `onMiss` is called before any new
   * card is made (the HTTP layer charges Gemma's rate limits there); a cached card is free.
   * @param {{ slug: string, token: string|null, when: string|null, onMiss?: () => void }} input
   */
  async function getIdeas({ slug, token, when, onMiss = () => {} }) {
    const w = when === "tonight" || when === "weekend" ? when : null;
    if (!w) throw invalid([{ field: "when", message: 'Ask for "tonight" or "weekend".' }]);
    const { crew } = await viewerOf(slug, token);
    const key = `ideas:${crew.id}:${w}`;
    const hit = await cache.get(key);
    if (hit) return { ...hit, cached: true };
    return once(inflight, key, async () => {
      onMiss();
      const card = await makeCard(crew, w);
      await cache.set(key, card, IDEAS_TTL_MS);
      return { ...card, cached: false };
    });
  }

  /** @param {Crew} crew @param {"tonight"|"weekend"} when */
  async function makeCard(crew, when) {
    const t = now();
    const region = regionOf(crew);
    const pack = packFor(region);
    const local = pack.local(region);
    const tz = crew.tz || region.timezone;
    const slot = slotFor(when, t, tz, pack.social);
    /** @type {string[]} */
    const notes = [];
    const base = { when, generatedAt: new Date(t).toISOString(), validUntil: new Date(t + IDEAS_TTL_MS).toISOString(), slot: slot.days };
    if (!slot.days.length) {
      return { ...base, ideas: [], by: "code", sources: [], notes: [when === "tonight" ? "Tonight is nearly over. Try the weekend." : "The weekend is nearly over."] };
    }
    const members = /** @type {Member[]} */ (await store.find("members", { crewId: crew.id }));
    const points = crewPoints(crew, members);
    const center = centroid(points.map((p) => p.area)) ?? region.center;
    if (!center) return { ...base, ideas: [], by: "code", sources: [], notes: ["Add your areas first, so the sloth knows where the crew is."] };

    // curated guides: refresh (at most daily) while the rest is gathered
    const guides = feedsFor(pack);
    const refresh = Promise.all(guides.map((g) => once(refreshing, g.id, () => refreshFeed(g, { pack, region, local, tz })).catch((e) => log("feed_error", { feed: g.id, message: String(e?.message).slice(0, 120) }))));
    const plans = /** @type {Plan[]} */ (await store.find("plans", { crewId: crew.id }));
    let hours = null;
    try {
      hours = await weather.hourly(center, { tz, days: 7 });
    } catch {}
    const placesP = candidatesNear(center, pack).catch(() => /** @type {any[]} */ ([]));
    const places = await Promise.race([placesP, new Promise((r) => setTimeout(() => r(null), placesBudgetMs).unref?.())]);
    if (places === null) notes.push("The map was slow, so fewer places were checked.");
    await refresh;
    const events = (await Promise.all(guides.map(eventsFrom))).flat();

    const ctx = { slot, center, points, hours, model: pack.travel };
    const ev = eventCandidates(events, ctx);
    const pl = placeCandidates(/** @type {any[]} */ (places || []), { ...ctx, crew, recent: recentPlaces(plans, t), now: t });
    const us = usualCandidates(plans, { ...ctx, now: t });
    if (pl.wet) notes.push("Rain is forecast for the open-air hours, so outdoor places are left out.");
    const cands = pool({ events: ev, places: pl.candidates, usual: us }, slot.today);
    const sources = guides.map((g) => ({ name: g.name, url: g.home }));
    if (!cands.length) return { ...base, ideas: [], by: "code", sources, notes: [...notes, "Nothing fits this time. Try the other slot, or add a plan yourself."] };

    const crewFacts = { vibe: crew.vibe ?? null, likes: crew.vibeTags ?? [], budget: crew.budget ?? "any", when };
    let data = null;
    if (ai.available && cands.length > 1) {
      try {
        const r = await ai.generate({ task: "rank-ideas", messages: rankMessages(localisePrompt(prompts["rank-ideas"], local), { crew, when, candidates: cands }), schema: RANK_SCHEMA, maxTokens: RANK_MAX_TOKENS });
        data = r.data;
        log("gemma", { task: "rank-ideas", model: r.model, sec: r.wallSec, parsed: r.data != null });
      } catch (e) {
        log("gemma_error", { task: "rank-ideas", message: String(/** @type {any} */ (e).message).slice(0, 160) });
      }
    }
    const ranked = readRanking(data, cands, crewFacts);
    const ideas = ranked.picks.map((p) => ideaView(p, { today: slot.today, tz }));
    if (ideas.length < 3) notes.push(`Only ${ideas.length === 1 ? "one idea fits" : `${ideas.length} ideas fit`} this time.`);
    log("ideas", { crew: crew.id, when, events: ev.length, places: pl.candidates.length, usual: us.length, by: ranked.by });
    return { ...base, ideas, by: ranked.by, sources, notes };
  }

  /** The heartbeat's part: refresh every guide for packs that have them (at most daily each). */
  async function refreshAll(/** @type {{ pack: any, region: any }[]} */ targets) {
    for (const { pack, region } of targets) {
      for (const g of feedsFor(pack)) {
        await once(refreshing, g.id, () => refreshFeed(g, { pack, region, local: pack.local(region), tz: region.timezone })).catch(() => {});
      }
    }
  }

  return { getIdeas, refreshAll, _internal: { refreshFeed, eventsFrom } };
}

