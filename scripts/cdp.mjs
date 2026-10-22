// @ts-check
// A tiny Chrome DevTools Protocol driver for the dev scripts (push check, screenshots):
// launch headless Chrome with a throwaway profile, open pages in isolated contexts, run
// JavaScript, click, type, upload a file and take screenshots. No dependencies.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** Launch Chrome and connect. */
export async function launch({ headless = true } = {}) {
  const port = 9300 + Math.floor(Math.random() * 600);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ct-chrome-"));
  const proc = spawn(CHROME, [...(headless ? ["--headless=new"] : []), `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
  let version;
  for (let i = 0; i < 60 && !version; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    } catch {
      await sleep(250);
    }
  }
  if (!version) throw new Error("Chrome did not start");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  /** @type {Map<number, (m: any) => void>} */
  const waiting = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.id && waiting.has(m.id)) {
      waiting.get(m.id)?.(m);
      waiting.delete(m.id);
    }
  };
  /** @returns {Promise<any>} */
  const send = (/** @type {string} */ method, params = {}, /** @type {string|undefined} */ sessionId = undefined) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      waiting.set(n, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
      ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  /**
   * A page in its own browser context (its own storage), with a phone viewport.
   * @param {{ width?: number, height?: number, scale?: number, dark?: boolean }} [o]
   */
  async function page({ width = 390, height = 844, scale = 2, dark = false } = {}) {
    const { browserContextId } = await send("Target.createBrowserContext", { disposeOnDetach: true });
    const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const s = (/** @type {string} */ m, p = {}) => send(m, p, sessionId);
    await s("Page.enable");
    await s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: true });
    await s("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await s("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36", platform: "Linux armv8l" });
    await s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }, { name: "prefers-reduced-motion", value: "reduce" }] });
    const run = async (/** @type {string} */ expression) => {
      const r = await s("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    const api = {
      send: s,
      run,
      async go(/** @type {string} */ url, wait = 1800) {
        await s("Page.navigate", { url });
        await sleep(wait);
      },
      /** wait until a CSS selector (or a text) is on the page */
      async waitFor(/** @type {string} */ selector, { text = "", timeoutMs = 60000 } = {}) {
        const t0 = Date.now();
        while (Date.now() - t0 < timeoutMs) {
          const ok = await run(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(selector)})]; return els.some((e) => !${JSON.stringify(text)} || e.textContent.includes(${JSON.stringify(text)})); })()`);
          if (ok) return true;
          await sleep(300);
        }
        throw new Error(`timed out waiting for ${selector} ${text}`);
      },
      /** click the first element matching a selector (and containing a text) */
      async click(/** @type {string} */ selector, text = "") {
        const ok = await run(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => !${JSON.stringify(text)} || e.textContent.includes(${JSON.stringify(text)})); if (!el) return false; el.scrollIntoView({ block: "center" }); el.click(); return true; })()`);
        if (!ok) throw new Error(`nothing to click: ${selector} ${text}`);
      },
      /** set a controlled input's value the way typing does */
      async type(/** @type {string} */ selector, /** @type {string} */ value) {
        const ok = await run(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.focus(); const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
        if (!ok) throw new Error(`no field ${selector}`);
      },
      async upload(/** @type {string} */ selector, /** @type {string} */ file) {
        const { root } = await s("DOM.getDocument", {});
        const { nodeId } = await s("DOM.querySelector", { nodeId: root.nodeId, selector });
        await s("DOM.setFileInputFiles", { nodeId, files: [path.resolve(file)] });
      },
      async scrollTo(/** @type {string} */ selector, block = "start") {
        await run(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.scrollIntoView({ block: ${JSON.stringify(block)} }); else window.scrollTo(0, 0); })()`);
        await sleep(400);
      },
      /** close this page and its browser context */
      async close() {
        await send("Target.closeTarget", { targetId }).catch(() => {});
        await send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
      },
      async shot(/** @type {string} */ file) {
        const { data } = await s("Page.captureScreenshot", { format: "png" });
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.from(data, "base64"));
        return file;
      },
    };
    return api;
  }

  return {
    send,
    page,
    async close() {
      try {
        ws.close();
      } catch {}
      proc.kill();
      await sleep(300);
      fs.rmSync(profile, { recursive: true, force: true });
    },
  };
}
