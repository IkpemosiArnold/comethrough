// Live check of real event pages through the app's own link reader (src/adapters/pagemeta.mjs)
// and the plan reader (readPlan), without Gemma: the page's own event data decides the fields.
//   node scripts/events-check.mjs <url> [<url> ...]
// Results of the 21 Oct 2026 run are in docs/LOCAL-FACTS.md, "Event sources".
import { createPageMeta } from "../src/adapters/pagemeta.mjs";
import { isLockedLink, lockedMessage, lockedSite } from "../src/core/netguard.mjs";
import { readPlan } from "../src/core/tasks.mjs";

const pages = createPageMeta({ contact: "https://github.com/IkpemosiArnold/comethrough" });
const today = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
for (const url of process.argv.slice(2)) {
  if (isLockedLink(url)) {
    console.log(JSON.stringify({ url, locked: lockedSite(url), message: lockedMessage(lockedSite(url)) }));
    continue;
  }
  const t0 = Date.now();
  try {
    const page = await pages.fetchPage(url);
    const r = readPlan({}, { url, pageMeta: page.meta, today, member: { id: "m", name: "Tester" } });
    const d = r.draft;
    console.log(JSON.stringify({ url, ms: Date.now() - t0, jsonLd: !!page.meta?.event, title: d.title, start: d.start, end: d.end, venue: d.place.name, address: d.place.address, price: d.price, image: d.source && page.meta?.event?.image ? "json-ld" : page.meta?.image ? "og" : null, notes: r.notes }));
  } catch (e) {
    console.log(JSON.stringify({ url, ms: Date.now() - t0, error: /** @type {any} */ (e).message }));
  }
}
