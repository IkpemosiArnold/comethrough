// @ts-check
// WhatsApp is the delivery channel: every "tell the crew" is a wa.me link carrying the plan's link.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
// @ts-ignore: a browser module with plain functions
import { planMessage, whatsappUrl } from "../web/src/lib/share.js";

const url = "https://comethrough.tech/c/yaba-lot/p/p_1?t=inv_x";
const plan = { title: "Highlife Under Mangoes", when: "Saturday, 5 to 9pm", place: "The Mango Yard", url };

test("the WhatsApp messages carry the plan link, read naturally, and have no dashes", () => {
  const posted = planMessage({ ...plan, posted: true });
  assert.equal(posted, `New plan: Highlife Under Mangoes, Saturday, 5 to 9pm, The Mango Yard. Tap the link and say if you're coming: ${url}`);
  assert.equal(planMessage({ ...plan, mine: "going" }), `I'm going to Highlife Under Mangoes, Saturday, 5 to 9pm, The Mango Yard. Come through: ${url}`);
  assert.equal(planMessage(plan), `Highlife Under Mangoes\nSaturday, 5 to 9pm, The Mango Yard\nCome through: ${url}`);
  for (const m of [posted, planMessage(plan)]) assert.ok(!/[—–]/.test(m));
  const wa = new URL(whatsappUrl(posted));
  assert.equal(wa.origin + wa.pathname, "https://wa.me/");
  assert.equal(wa.searchParams.get("text"), posted);
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
