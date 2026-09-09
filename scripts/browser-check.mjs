import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const browserPath = process.env.BROWSER_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const origin = process.env.ROOM_ORIGIN ?? "http://127.0.0.1:3009";
const targetUrl = `${origin}/public/friend9s-room`;
const artifactDirectory = path.resolve(process.env.ARTIFACT_DIR ??
  path.join(tmpdir(), `friend9-evidence-${randomUUID()}`));
const profileDirectory = path.join(artifactDirectory, `isolated-profile-${randomUUID()}`);
const cdpPort = Number(process.env.CDP_PORT ?? 9229);
assert.ok(Number.isInteger(cdpPort) && cdpPort > 1024 && cdpPort < 65536);
await mkdir(profileDirectory, { recursive: true });

// Refuse an occupied debugging port instead of attaching to someone's browser.
const portProbe = createServer();
await new Promise((resolve, reject) => {
  portProbe.once("error", reject);
  portProbe.listen(cdpPort, "127.0.0.1", resolve);
});
await new Promise((resolve) => portProbe.close(resolve));
const chrome = spawn(browserPath, [
  "--headless=new",
  `--remote-debugging-port=${cdpPort}`,
  "--remote-debugging-address=127.0.0.1",
  `--user-data-dir=${profileDirectory}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--disable-component-update",
  "--mute-audio",
  "about:blank",
], { stdio: "ignore", windowsHide: true });
let browserError;
let exited = false;
chrome.once("error", (error) => { browserError = error; });
chrome.once("exit", () => { exited = true; });

const checks = [];
const pageErrors = [];
const responseFailures = [];
const dialogFocus = [];
const visitedOrigins = new Set();
let client;
let stage = "starting an isolated browser";
const record = (name, condition = true) => {
  assert.ok(condition, name);
  checks.push(name);
};

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const operation = pending.get(message.id);
      if (!operation) return;
      clearTimeout(operation.timer);
      pending.delete(message.id);
      if (message.error) operation.reject(new Error(JSON.stringify(message.error)));
      else operation.resolve(message.result);
    } else {
      listeners.get(message.method)?.(message.params);
    }
  });
  socket.addEventListener("close", () => {
    for (const operation of pending.values()) {
      clearTimeout(operation.timer);
      operation.reject(new Error("The isolated browser connection closed."));
    }
    pending.clear();
  });
  return {
    on: (event, callback) => listeners.set(event, callback),
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }, 10_000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close: () => socket.close(),
  };
}

async function evaluate(expression) {
  const result = await client.send("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function waitFor(expression, description, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await sleep(80);
  }
  throw new Error(`Timed out: ${description}`);
}

async function click(selector) {
  const literal = JSON.stringify(selector);
  await evaluate(`document.querySelector(${literal}).scrollIntoView({block:"center",behavior:"instant"})`);
  await sleep(60);
  const point = await evaluate(`(() => {
    const element = document.querySelector(${literal});
    const r = element.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    return { x, y, disabled: element.disabled === true,
      hit: element.contains(document.elementFromPoint(x, y)) };
  })()`);
  assert.ok(point.hit && !point.disabled, `The real pointer can reach ${selector}`);
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await sleep(180);
}

async function key(key, code, virtualKey, text) {
  await client.send("Input.dispatchKeyEvent", {
    type: "keyDown", key, code, windowsVirtualKeyCode: virtualKey,
    ...(text === undefined ? {} : { text }),
  });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: virtualKey });
}

async function viewport(width, height, mobile = false) {
  await client.send("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: 1, mobile,
  });
  await sleep(150);
}

async function screenshot(filename, full = true) {
  const previousScroll = await evaluate("({x: window.scrollX, y: window.scrollY})");
  if (full) await evaluate("window.scrollTo({top:0,left:0,behavior:'instant'})");
  await sleep(220);
  const metrics = await client.send("Page.getLayoutMetrics");
  const clip = full ? {
    x: 0, y: 0,
    width: Math.ceil(metrics.cssContentSize.width),
    height: Math.min(7000, Math.ceil(metrics.cssContentSize.height)),
    scale: 1,
  } : undefined;
  const image = await client.send("Page.captureScreenshot", {
    format: "png", captureBeyondViewport: full, fromSurface: true,
    ...(clip ? { clip } : {}),
  });
  await writeFile(path.join(artifactDirectory, filename), Buffer.from(image.data, "base64"));
  if (full) await evaluate(`window.scrollTo({left:${previousScroll.x},top:${previousScroll.y},behavior:"instant"})`);
}

async function navigate() {
  await client.send("Page.navigate", { url: targetUrl });
  await waitFor("document.documentElement.dataset.ready === 'true'", "the external room script initialized");
  await evaluate("document.fonts.ready");
}

async function layoutCheck(label) {
  const layout = await evaluate(`(() => {
    const controls = [...document.querySelectorAll(".hotspot")].map(element => {
      const r = element.getBoundingClientRect();
      return { label: element.dataset.object, width: r.width, height: r.height };
    });
    return {
      viewport: document.documentElement.clientWidth,
      width: document.documentElement.scrollWidth,
      controls,
      svgCount: document.querySelectorAll(".room-illustration").length,
      svgHeight: document.querySelector(".room-illustration").getBoundingClientRect().height,
      noteFont: parseFloat(getComputedStyle(document.querySelector("#note-body")).fontSize)
    };
  })()`);
  record(`${label}: no horizontal overflow`, layout.width <= layout.viewport + 1);
  record(`${label}: nine reachable-size object controls`, layout.controls.length === 9 &&
    layout.controls.every((control) => control.width >= 43.5 && control.height >= 43.5));
  record(`${label}: illustration and readable story text`, layout.svgCount === 1 && layout.svgHeight > 100 && layout.noteFont >= 16);
}

async function contrastCheck(label) {
  const pairs = await evaluate(`(() => {
    function rgb(value) { return value.match(/[\\d.]+/g).slice(0,3).map(Number); }
    function luminance(value) {
      const c = rgb(value).map(channel => {
        const v = channel / 255;
        return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
      });
      return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
    }
    return ["#note-body", "#note-extra", "#resident-reply", ".intro-description", ".small-pleasures p", ".fridge-note li"].map(selector => {
      const element = document.querySelector(selector);
      let parent = element;
      let background;
      do {
        background = getComputedStyle(parent).backgroundColor;
        parent = parent.parentElement;
      } while (parent && (background === "rgba(0, 0, 0, 0)" || background === "transparent"));
      const a = luminance(getComputedStyle(element).color);
      const b = luminance(background);
      return { selector, ratio: (Math.max(a,b) + .05) / (Math.min(a,b) + .05) };
    });
  })()`);
  for (const pair of pairs) record(`${label}: ${pair.selector} text contrast >= 4.5 (${pair.ratio.toFixed(2)})`, pair.ratio >= 4.5);
}

try {
  const deadline = Date.now() + 25_000;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    if (browserError) throw browserError;
    if (exited) throw new Error("The isolated browser exited during startup.");
    try {
      ready = (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok;
    } catch (error) {
      if (error.cause?.code !== "ECONNREFUSED") throw error;
    }
    if (!ready) await sleep(150);
  }
  assert.ok(ready, "The isolated browser has a responsive debugging endpoint.");
  const tab = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: "PUT" })).json();
  client = await connect(tab.webSocketDebuggerUrl);
  client.on("Runtime.exceptionThrown", (event) => pageErrors.push(event.exceptionDetails));
  client.on("Log.entryAdded", ({ entry }) => {
    if (entry.level === "error") pageErrors.push(entry.text);
  });
  client.on("Network.responseReceived", ({ response }) => {
    if (response.url.startsWith("http")) visitedOrigins.add(new URL(response.url).origin);
    if (response.status >= 400) responseFailures.push({ url: response.url, status: response.status });
  });
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Log.enable");
  await client.send("Network.enable");
  await client.send("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.__roomCsp = [];
    window.__roomAudioNodes = 0;
    document.addEventListener("securitypolicyviolation", event => window.__roomCsp.push(event.violatedDirective));
    if (window.AudioContext) {
      const original = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function (...args) {
        window.__roomAudioNodes += 1;
        return original.apply(this, args);
      };
    }
  ` });
  await viewport(1365, 1000);
  await client.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await navigate();
  record("The afternoon fixture actually uses the daylight theme", await evaluate('document.documentElement.dataset.theme === "day"'));
  record("The document is visible in its own browser", await evaluate("document.visibilityState === 'visible'"));
  record("No sound starts on arrival", await evaluate("document.documentElement.dataset.sound === 'off' && window.__roomAudioNodes === 0"));
  record("No CSP violations on arrival", await evaluate("window.__roomCsp.length === 0"));
  await layoutCheck("desktop");
  record("The envelope illustration is not reduced to a toolbar icon", await evaluate('document.querySelector(".envelope-art").getBoundingClientRect().height > 100'));
  await contrastCheck("afternoon");
  await screenshot("desktop-afternoon.png");

  stage = "trying the nine actual room interactions";
  const inspect = async (id) => {
    await click(`[data-object="${id}"]`);
    await waitFor(`document.querySelector('[data-object="${id}"]').getAttribute("aria-pressed") === "true"`, `selected ${id}`);
  };
  await inspect("window");
  await click('[data-action="rain"]');
  record("The window really changes to drizzle", await evaluate('document.documentElement.dataset.weather === "rain" && getComputedStyle(document.querySelector(".window-rain")).display !== "none"'));
  await inspect("postcards");
  await click('[data-action="turn"]');
  await click('[data-action="pin"]');
  record("The second postcard is illustrated and pinned", await evaluate('document.documentElement.dataset.postcard === "1" && document.documentElement.dataset.pinned === "true" && getComputedStyle(document.querySelector(".postcard-bakery")).display !== "none"'));
  await inspect("plant");
  await click('[data-action="water"]');
  record("Watering changes the plant and guards repeat watering", await evaluate('document.documentElement.dataset.watered === "true" && document.querySelector(\'[data-action="water"]\').disabled && getComputedStyle(document.querySelector(".plant-happy")).display !== "none"'));
  await inspect("radio");
  record("Discovering the radio does not require audio", await evaluate("window.__roomAudioNodes === 0"));
  await click('[data-action="station"]');
  record("Changing stations updates the actual selected track and copy", await evaluate('document.documentElement.dataset.track === "1" && document.getElementById("note-result").textContent.includes("Slow Sunday")'));
  await click('[data-action="sound"]');
  await waitFor('document.documentElement.dataset.sound === "on"', "explicitly requested audio");
  record("The radio generates original audio nodes only on request", await evaluate("window.__roomAudioNodes >= 6"));
  await click("#sound-toggle");
  await waitFor('document.documentElement.dataset.sound === "off" && !document.getElementById("sound-toggle").disabled', "sound stopped");
  await inspect("lamp");
  await click('[data-action="evening"]');
  record("The lamp changes both room light and page palette", await evaluate('document.documentElement.dataset.theme === "evening" && getComputedStyle(document.querySelector(".lamp-glow")).display !== "none"'));
  await contrastCheck("evening");
  await inspect("tea");
  await click('[data-action="mint"]');
  record("Making tea fills the cup and changes the resident's pose", await evaluate('document.documentElement.dataset.tea === "mint" && getComputedStyle(document.querySelector(".resident-mug")).display !== "none"'));
  await inspect("book");
  await click('[data-action="read"]');
  record("The original mystery passage and bookmark are visible", await evaluate('document.getElementById("note-body").textContent.includes("sugar bowl") && getComputedStyle(document.querySelector(".book-bookmark")).display !== "none"'));
  await inspect("mending");
  await click('[data-action="stitch"]');
  record("The red repair appears in the room", await evaluate('document.documentElement.dataset.mended === "true" && getComputedStyle(document.querySelector(".mended-thread")).display !== "none"'));
  await inspect("cat");
  await click('[data-action="chair"]');
  record("Crumb really moves to the chair", await evaluate('document.documentElement.dataset.cat === "chair" && getComputedStyle(document.querySelector(".crumb-chair")).display !== "none" && getComputedStyle(document.querySelector(".crumb-rug")).display === "none"'));
  await click('[data-prompt="joy"]');
  record("The resident remembers the shared tea", await evaluate('document.getElementById("resident-reply").textContent.includes("This, actually")'));
  record("Exactly nine distinct objects unlock the envelope", await evaluate('document.getElementById("discovery-count").textContent === "9 / 9" && document.getElementById("envelope-button").classList.contains("is-ready")'));
  await screenshot("desktop-evening.png");
  await inspect("cat");
  record("Revisiting does not inflate the discovery count", await evaluate('document.getElementById("discovery-count").textContent === "9 / 9"'));
  await click("#envelope-button");
  record("The real reward letter opens", await evaluate('document.getElementById("letter-dialog").open'));
  await screenshot("sunday-letter.png", false);
  await key("Escape", "Escape", 27);
  await waitFor('!document.getElementById("letter-dialog").open', "Escape closes the letter");
  record("The reward returns focus to its opener", await evaluate('document.activeElement.id === "envelope-button"'));

  stage = "keyboard behavior and persisted state";
  await evaluate('document.getElementById("discovery-toggle").focus()');
  await key("Enter", "Enter", 13, "\r");
  await waitFor('document.getElementById("discoveries-dialog").open', "keyboard opened the discovery list");
  for (let index = 0; index < 12; index++) {
    await key("Tab", "Tab", 9);
    const focus = await evaluate(`({
      inDialog: document.activeElement.closest("dialog")?.id === "discoveries-dialog",
      documentHasFocus: document.hasFocus(),
      tag: document.activeElement.tagName,
      id: document.activeElement.id
    })`);
    dialogFocus.push(focus);
    // Native dialogs may yield to browser chrome, but never to the inert page.
    record(`Modal Tab ${index + 1} never reaches the background page`,
      focus.inDialog || (!focus.documentHasFocus && focus.tag === "BODY"));
  }
  await key("Escape", "Escape", 27);
  await waitFor('!document.getElementById("discoveries-dialog").open', "discovery dialog closed");
  record("Discovery dialog returns keyboard focus", await evaluate('document.activeElement.id === "discovery-toggle"'));
  await navigate();
  record("Discoveries and meaningful room changes persist after reload", await evaluate('document.getElementById("discovery-count").textContent === "9 / 9" && document.documentElement.dataset.tea === "mint" && document.documentElement.dataset.cat === "chair" && document.documentElement.dataset.mended === "true"'));
  record("Reload never resumes the radio", await evaluate('document.documentElement.dataset.sound === "off" && window.__roomAudioNodes === 0'));
  await key("9", "Digit9", 57, "9");
  record("The optional keyboard Easter egg finds Crumb", await evaluate('document.querySelector(\'[data-object="cat"]\').getAttribute("aria-pressed") === "true"'));
  await evaluate("window.scrollTo(0, 0)");
  await client.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 650, y: 650, deltaX: 0, deltaY: 400 });
  await sleep(200);
  record("Real wheel input scrolls the page", await evaluate("window.scrollY > 100"));

  stage = "mobile, large text and reduced motion";
  await viewport(390, 844, true);
  await layoutCheck("390px mobile");
  await screenshot("mobile-room.png");
  await click(".settings summary");
  await click("#size-toggle");
  await click("#contrast-toggle");
  await click(".settings summary");
  record("Large text and high contrast are independent preferences", await evaluate('document.documentElement.dataset.largeText === "true" && document.documentElement.dataset.contrast === "true" && getComputedStyle(document.documentElement).fontSize === "20px"'));
  await layoutCheck("390px mobile with large text");
  await contrastCheck("large-text high-contrast evening");
  await screenshot("mobile-large-text.png");
  await viewport(320, 740, true);
  await layoutCheck("320px with large text");
  await viewport(390, 844, true);
  await client.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await waitFor('document.documentElement.dataset.reducedMotion === "true"', "OS reduced motion is honored");
  record("Reduced motion removes illustration animations and button transitions", await evaluate('getComputedStyle(document.querySelector(".tea-steam")).animationName === "none" && getComputedStyle(document.querySelector(".hotspot")).transitionDuration === "0s"'));
  await inspect("window");
  record("Mobile interaction brings a readable story into view", await evaluate('document.getElementById("note-title").textContent.includes("outside") && document.activeElement.id === "note-title"'));
  await click("#back-to-room");
  record("Back to room restores the exact selected object", await evaluate('document.activeElement.dataset.object === "window"'));

  stage = "unavailable and malformed browser storage";
  await evaluate('localStorage.setItem("friend9.room.v1", "{broken")');
  await navigate();
  record("Malformed saved data produces an honest fresh visit", await evaluate('document.getElementById("discovery-count").textContent === "0 / 9" && !document.getElementById("storage-notice").hidden'));
  const storageProbe = await client.send("Page.addScriptToEvaluateOnNewDocument", { source: `
    Storage.prototype.getItem = function () { throw new DOMException("Disabled for this isolated test", "SecurityError"); };
    Storage.prototype.setItem = function () { throw new DOMException("Disabled for this isolated test", "QuotaExceededError"); };
  ` });
  await navigate();
  await inspect("tea");
  await click('[data-action="ginger"]');
  record("Blocked storage does not prevent room interactions", await evaluate('document.documentElement.dataset.tea === "ginger" && !document.getElementById("storage-notice").hidden'));
  await client.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: storageProbe.identifier });
  record("No CSP violations throughout interaction checks", await evaluate("window.__roomCsp.length === 0"));
  record("No application runtime errors", pageErrors.length === 0);
  record("No failed page or asset requests", responseFailures.length === 0);
  record("All page resources stayed on the room's own origin", [...visitedOrigins].every((entry) => entry === new URL(origin).origin));
  await writeFile(path.join(artifactDirectory, "browser-results.json"),
    JSON.stringify({ origin, checks, dialogFocus, pageErrors, responseFailures, visitedOrigins: [...visitedOrigins] }, null, 2));
  console.log(JSON.stringify({ result: "passed", checks: checks.length, artifacts: artifactDirectory }, null, 2));
} catch (error) {
  if (client) {
    try { await screenshot("failure.png", false); } catch (captureError) { console.error("Failure screenshot:", captureError.message); }
  }
  await writeFile(path.join(artifactDirectory, "browser-results.json"),
    JSON.stringify({ origin, stage, checks, dialogFocus, error: error.message, pageErrors, responseFailures }, null, 2));
  console.error(`Browser check failed while ${stage}: ${error.stack}`);
  process.exitCode = 1;
} finally {
  if (client) {
    try { await client.send("Browser.close"); } catch (error) {
      if (!/closed|timeout/i.test(error.message)) console.error(error.message);
    }
    client.close();
  }
  if (!exited && chrome.pid) {
    await sleep(1000);
    if (!exited) chrome.kill();
  }
}
