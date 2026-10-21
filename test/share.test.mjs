// @ts-check
// WhatsApp is the delivery channel: every "tell the crew" is a wa.me link carrying the plan's link.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
// @ts-ignore: a browser module with plain functions
import { inviteMessage, planLinks, planMessage, whatsappUrl } from "../web/src/lib/share.js";

const plan = { title: "Highlife Under Mangoes", when: "Saturday, 5 to 9pm", place: "The Mango Yard" };

test("the WhatsApp messages lead with the plan, then one link per answer, and have no dashes", () => {
  const links = planLinks("https://comethrough.tech", "yaba-lot", "p_1", "inv_x");
  assert.deepEqual(links, { url: "https://comethrough.tech/c/yaba-lot/p/p_1?t=inv_x", in: "https://comethrough.tech/c/yaba-lot/p/p_1/in?t=inv_x", maybe: "https://comethrough.tech/c/yaba-lot/p/p_1/maybe?t=inv_x" });
  const msg = planMessage({ ...plan, links });
  assert.equal(msg, `Highlife Under Mangoes, Saturday, 5 to 9pm at The Mango Yard. Come through?\nI'm in: ${links.in}\nMaybe: ${links.maybe}`);
  assert.equal(planMessage({ ...plan, links, mine: "going" }), `I'm going to Highlife Under Mangoes, Saturday, 5 to 9pm at The Mango Yard. Come through?\nI'm in: ${links.in}\nMaybe: ${links.maybe}`);
  const pick = { title: "Saturday at Muri Okunola Park", when: "Saturday, 3 to 6pm", place: "Muri Okunola Park", kind: "ritual", links };
  const invite = inviteMessage({ crewName: "The uni guys", url: "https://x/c/uni?t=k", plan: pick });
  assert.ok(invite.startsWith("Saturday, 3 to 6pm at Muri Okunola Park. Come through?\nI'm in: "), "the sloth's pick is the first line");
  assert.match(inviteMessage({ crewName: "The uni guys", url: "https://x/c/uni?t=k" }), /^Plans for The uni guys live here now.*https:\/\/x\/c\/uni\?t=k$/);
  for (const m of [msg, invite]) {
    assert.ok(!/[—–]/.test(m));
    assert.ok(!/check the app|open come through/i.test(m), "never sends people to the app");
  }
  const wa = new URL(whatsappUrl(msg));
  assert.equal(wa.origin + wa.pathname, "https://wa.me/");
  assert.equal(wa.searchParams.get("text"), msg);
});

test("the plan page leads with WhatsApp: after posting, after I'm going; the calendar is an extra", () => {
  const src = fs.readFileSync(new URL("../web/src/screens/PlanPage.jsx", import.meta.url), "utf8");
  assert.match(src, /Tell the crew on WhatsApp/);
  // the going bar's main button is WhatsApp, not the calendar
  const bar = src.slice(src.indexOf("function ActionBar"));
  assert.match(bar, /btn whatsapp big grow[^>]*>\s*<WhatsAppIcon \/> Tell the crew/);
  assert.ok(!/Add to my calendar/.test(bar), "the calendar is not in the bar");
  assert.match(src, /btn ghost block cal-extra/);
  const home = fs.readFileSync(new URL("../web/src/screens/CrewHome.jsx", import.meta.url), "utf8");
  assert.match(home, /invite-btn" href=\{whatsappUrl\(/, "the crew's Invite button opens WhatsApp");
});
