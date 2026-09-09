import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  openBrowser, openNativeVisibilityBrowser, openRoom, visitRoom, capture, roomUrl, roomOrigin, artifactDirectory,
} from "./room-browser.mjs";
import { freshState, OBJECT_IDS, SCRAP_IDS, STORAGE_KEY } from "../public/room-state.js";

const results = [];
const selectedScenarios = process.env.ROOM_SCENARIOS?.split(",") ?? null;
const timeout = 10_000;
const scenarioIds = new Set([
  "01-first-look", "02-mobile-visit", "03-reversible-choices", "04-little-plans",
  "05-lore-trail", "06-keyboard", "07-reading-comfort", "08-radio",
  "09-resilient-visit", "10-finishing-the-visit", "09b-no-javascript",
]);
if (selectedScenarios?.some((id) => !scenarioIds.has(id))) {
  throw new Error(`Unknown ROOM_SCENARIOS selection: ${selectedScenarios.join(",")}`);
}
const assetFingerprints = {};
for (const suffix of ["", "/room.css", "/room.js", "/room-state.js", "/room-content.js", "/room.svg", "/favicon.svg"]) {
  const response = await fetch(roomUrl + suffix, { signal: AbortSignal.timeout(timeout) });
  assert.equal(response.status, 200, `Source artifact ${suffix || "document"} is available.`);
  assetFingerprints[suffix || "document"] = response.headers.get("etag");
  await response.body.cancel();
}
const browser = await openBrowser();

async function getState(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
}

async function select(page, id) {
  await page.locator(`[data-object="${id}"]`).click();
  await page.waitForFunction((name) =>
    document.querySelector(`[data-object="${name}"]`).getAttribute("aria-pressed") === "true", id);
}

async function action(page, id) {
  await page.locator(`[data-action="${id}"]`).click();
}

async function layout(page) {
  return page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    contentWidth: document.documentElement.scrollWidth,
    font: parseFloat(getComputedStyle(document.querySelector("#note-body")).fontSize),
    targets: [...document.querySelectorAll(".hotspot, .choice-button, .corner-button")].map((element) => {
      const rect = element.getBoundingClientRect();
      return { label: element.textContent.trim(), width: rect.width, height: rect.height };
    }).filter((target) => target.width && target.height),
    selected: document.querySelector('.hotspot[aria-pressed="true"]')?.dataset.object,
    active: document.activeElement.id || document.activeElement.dataset.object,
    detailsOpen: document.querySelector("#note-more").open,
  }));
}

async function noOverflow(page) {
  const measured = await layout(page);
  assert.ok(measured.contentWidth <= measured.width + 1, JSON.stringify(measured));
  assert.ok(measured.font >= 16, "Story text remains at least 16 CSS pixels.");
  assert.ok(measured.targets.every((target) => target.width >= 43.5 && target.height >= 43.5),
    `Object and action hit targets remain at least 44px: ${JSON.stringify(measured.targets)}`);
  return measured;
}

async function screenshotRegion(page, name, region) {
  const rect = await page.locator(".room-illustration").boundingBox();
  assert.ok(rect);
  const scale = rect.width / 1200;
  await page.screenshot({
    path: path.join(artifactDirectory, `${name}.png`),
    clip: {
      x: rect.x + region[0] * scale,
      y: rect.y + region[1] * scale,
      width: region[2] * scale,
      height: region[3] * scale,
    },
  });
}

async function run(name, options, callback, { scripts = true, seed, nativeVisibility = false } = {}) {
  if (selectedScenarios && !selectedScenarios.includes(name)) return;
  const native = nativeVisibility ? await openNativeVisibilityBrowser() : null;
  const session = await openRoom(native?.browser ?? browser, {
    ...options,
    ...(seed ? { storageState: { cookies: [], origins: [{
      origin: new URL(roomOrigin).origin,
      localStorage: [{ name: STORAGE_KEY, value: JSON.stringify(seed) }],
    }] } } : {}),
  }, nativeVisibility);
  const { context, page, errors, requests, violations, responses } = session;
  const record = {
    name, capturedAt: new Date().toISOString(), origin: roomOrigin, assetFingerprints,
    checks: [], screenshots: [], errors, requests, violations, responses,
  };
  const note = async (label, value) => {
    assert.ok(value, label);
    record.checks.push(label);
  };
  const shot = async (suffix, selector) => {
    const filename = `${name}-${suffix}`;
    await capture(page, filename, selector);
    record.screenshots.push(`${filename}.png`);
  };
  try {
    if (scripts) await visitRoom(page);
    else await page.goto(roomUrl, { waitUntil: "load" });
    await callback({ ...session, note, shot, record });
    assert.deepEqual(errors, [], `${name}: no browser errors`);
    assert.deepEqual(violations, [], `${name}: strict CSP without violations`);
    assert.deepEqual(responses, [], `${name}: all requested page assets load`);
    assert.ok(requests.filter((url) => url.startsWith("http")).every((url) =>
      new URL(url).origin === new URL(roomOrigin).origin), `${name}: no third-party requests`);
    record.passed = true;
    console.log(`PASS ${name} (${record.checks.length} assertions)`);
  } catch (error) {
    record.passed = false;
    record.error = error.stack;
    await capture(page, `${name}-failure`);
    throw error;
  } finally {
    record.finalLayout = scripts ? await layout(page) : null;
    record.visibleText = await page.locator("body").innerText();
    record.accessibleTree = await page.locator("body").ariaSnapshot();
    await writeFile(path.join(artifactDirectory, `${name}.json`), JSON.stringify(record, null, 2));
    await context.tracing.stop({ path: path.join(artifactDirectory, `${name}-trace.zip`) });
    results.push(record);
    if (native) await native.close();
    else await context.close();
  }
}

try {
  await run("01-first-look", {}, async ({ page, note, shot, record }) => {
    await note("Both unwanted phrases are removed", !/Nothing to submit|No attendance taken|Things here have stories|None of them are urgent/.test(await page.locator("body").innerText()));
    await note("Nine primary discoveries remain", await page.locator("[data-object]").count() === 9);
    await note("Every primary target is reachable and the layout fits", await noOverflow(page));
    await note("No sound starts on arrival", await page.locator("html").getAttribute("data-sound") === "off");
    await shot("desktop");
    await shot("room", ".artwork");
    await page.locator(".artwork").scrollIntoViewIfNeeded();
    for (const [label, region] of Object.entries({
      window: [0, 20, 460, 470], desk: [310, 420, 525, 305],
      cat: [825, 505, 270, 210], bicycle: [1050, 270, 150, 390],
    })) {
      await screenshotRegion(page, `01-first-look-${label}`, region);
      record.screenshots.push(`01-first-look-${label}.png`);
    }
    const text = page.locator("#note-body");
    await text.scrollIntoViewIfNeeded();
    const box = await text.boundingBox();
    await page.mouse.move(box.x + 3, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 3, box.y + box.height - 5, { steps: 15 });
    await page.mouse.up();
    await note("Dragging text selects no page copy", await page.evaluate(() => getSelection().toString() === ""));
  });

  await run("02-mobile-visit", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    async ({ page, note, shot }) => {
      await note("Mobile room and target tray fit", await noOverflow(page));
      await shot("arrival");
      await page.locator('[data-object="tea"]').tap();
      await page.locator("#note-title").waitFor();
      await note("A tap brings the selected story into focus", await page.locator("#note-title").evaluate((element) => element === document.activeElement));
      await page.locator('[data-action="ginger"]').tap();
      await note("Touch makes ginger tea", (await getState(page)).tea === "ginger");
      await shot("tea");
      await page.locator("#back-to-room").tap();
      await note("Back returns to the same object", await page.locator('[data-object="tea"]').evaluate((element) => element === document.activeElement));
      await page.locator('[data-scrap="drawer"]').tap();
      await note("A corner opens a readable scrap", await page.locator("#scraps-dialog").isVisible());
      await shot("drawer");
      await page.locator('[data-close="scraps-dialog"]').tap();
      await note("Modal closes without losing the room", await page.locator("#scraps-dialog").isHidden());
    });

  await run("03-reversible-choices", {}, async ({ page, note, shot, record }) => {
    await select(page, "postcards");
    await action(page, "pin");
    await note("Pin button describes its next action", await page.locator('[data-action="pin"]').innerText() === "Unpin this one");
    await note("Pinned appearance matches stored state", (await getState(page)).pinnedPostcard === 0 &&
      await page.locator("html").getAttribute("data-pinned") === "true");
    await shot("pinned", "#notebook");
    await action(page, "pin");
    await note("A second click unpins", (await getState(page)).pinnedPostcard === null);
    await action(page, "turn");
    await action(page, "pin");
    await action(page, "turn");
    await note("Browsing another card does not move the pin", (await getState(page)).pinnedPostcard === 1 &&
      await page.locator("html").getAttribute("data-pinned") === "false");
    await action(page, "turn");
    await action(page, "turn");
    await note("Returning to the pinned card offers unpin", await page.locator('[data-action="pin"]').getAttribute("aria-pressed") === "true");
    await page.reload();
    await page.locator('html[data-ready="true"]').waitFor();
    await select(page, "postcards");
    await note("The selected card and its pin survive reload", (await getState(page)).pinnedPostcard === 1);
    for (const [object, control, key] of [["book", "read", "bookmarked"], ["mending", "stitch", "mended"]]) {
      await select(page, object);
      await action(page, control);
      await note(`${object}: first click changes the object`, (await getState(page))[key] === true);
      await action(page, control);
      await note(`${object}: second click reverses it`, (await getState(page))[key] === false);
      await note(`${object}: focus stays on the same control`, await page.locator(`[data-action="${control}"]`).evaluate((element) => document.activeElement === element));
    }
    await select(page, "cat");
    await action(page, "chair");
    await shot("chair-cat", ".artwork");
    await action(page, "chair");
    await note("Crumb returns to the rug", (await getState(page)).cat === "rug");
    record.persisted = await getState(page);
    await shot("notebook", "#notebook");
  });

  await run("04-little-plans", {}, async ({ page, note, shot, record }) => {
    record.branches = [];
    for (const [id, object] of [["scenic", "window"], ["radio", "radio"], ["mug", "tea"]]) {
      await select(page, object);
      const original = await page.locator("#note-body").innerText();
      await page.locator(`[data-plan="${id}"]`).setChecked(!(await getState(page)).plans[id]);
      const changed = await page.locator("#note-body").innerText();
      await note(`${id}: choice changes the connected story`, original !== changed);
      await shot(`${id}-changed`, ".room-frame");
      record.branches.push({
        id, checked: (await getState(page)).plans[id],
        story: changed, reaction: await page.locator("#plan-reaction").innerText(),
      });
      await page.locator(`[data-plan="${id}"]`).setChecked(!(await getState(page)).plans[id]);
      await note(`${id}: unchecking reverses the story`, await page.locator("#note-body").innerText() === original);
    }
    await page.locator('[data-prompt="plans"]').click();
    const before = await page.locator("#resident-reply").innerText();
    await page.locator('[data-plan="radio"]').check();
    await note("An already-open conversation reacts to a changed plan", await page.locator("#resident-reply").innerText() !== before);
    await shot("fridge", ".fridge-note");
    await page.reload();
    await page.locator('html[data-ready="true"]').waitFor();
    await note("Checklist state persists", await page.locator('[data-plan="radio"]').isChecked());
  });

  await run("05-lore-trail", {}, async ({ page, note, shot, record }) => {
    record.stories = [];
    for (const id of OBJECT_IDS) {
      await select(page, id);
      await note(`${id}: first glance is short`, (await page.locator("#note-body").innerText()).split(/\s+/).length <= 45);
      await note(`${id}: deeper lore starts folded`, await page.locator("#note-more").evaluate((element) => !element.open));
      await page.locator("#note-more summary").click();
      record.stories.push({
        id, title: await page.locator("#note-title").innerText(),
        glance: await page.locator("#note-body").innerText(),
        detail: await page.locator("#note-extra").innerText(),
        link: await page.locator("#story-link").innerText(),
      });
      if (["window", "radio", "book"].includes(id)) await shot(id, "#notebook");
    }
    await page.locator('[data-scrap="shelf"]').click();
    record.scraps = [];
    for (const id of SCRAP_IDS) {
      record.scraps.push({
        id, title: await page.locator("#scrap-title").innerText(),
        body: await page.locator("#scrap-body").innerText(),
        reaction: await page.locator("#scrap-reaction").innerText(),
      });
      await shot(id, "#scraps-dialog");
      await page.locator("#next-scrap").click();
    }
    await note("All six optional scraps are reachable", (await getState(page)).scraps.length === 6);
    await note("Bonus stories never inflate nine-object progress", (await getState(page)).seen.length === 9);
    await page.locator("#scrap-related").click();
    await note("A story connection leads somewhere real", await page.locator("#scraps-dialog").isHidden() ||
      await page.locator("#scrap-title").innerText() !== record.scraps[0].title);
  });

  await run("06-keyboard", {}, async ({ page, note, shot, record }) => {
    await page.keyboard.press("Tab");
    await note("Keyboard visitors get the skip link first", await page.locator(".skip-link").evaluate((element) => document.activeElement === element));
    await page.keyboard.press("Enter");
    await page.locator("#discovery-toggle").focus();
    await page.keyboard.press("Enter");
    await note("Enter opens the native discovery dialog", await page.locator("#discoveries-dialog").isVisible());
    record.focus = [];
    for (let index = 0; index < 13; index++) {
      await page.keyboard.press("Tab");
      const focus = await page.evaluate(() => ({
        name: document.activeElement.textContent.trim().slice(0, 80),
        tag: document.activeElement.tagName,
        dialog: document.activeElement.closest("dialog")?.id,
      }));
      record.focus.push(focus);
      await note(`Tab ${index + 1} does not reach an inert background control`, focus.dialog === "discoveries-dialog" || focus.tag === "BODY");
    }
    await shot("focus", "#discoveries-dialog");
    await page.keyboard.press("Escape");
    await note("Escape restores the opener", await page.locator("#discovery-toggle").evaluate((element) => document.activeElement === element));
    await page.locator(".settings summary").focus();
    await page.keyboard.press("Enter");
    await note("Enter opens settings", await page.locator(".settings").evaluate((element) => element.open));
    await page.keyboard.press("Escape");
    await note("Escape closes the settings disclosure", await page.locator(".settings").evaluate((element) => !element.open));
    await page.locator('[data-plan="scenic"]').focus();
    const before = await page.locator('[data-plan="scenic"]').isChecked();
    await page.keyboard.press("Space");
    await note("Space toggles a native checklist choice", (await getState(page)).plans.scenic !== before);
    await select(page, "postcards");
    await page.locator('[data-action="pin"]').focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await note("Keyboard pin/unpin behaves like pointer pin/unpin", (await getState(page)).pinnedPostcard === null);
  });

  await run("07-reading-comfort", { viewport: { width: 800, height: 1000 }, colorScheme: "dark" },
    async ({ page, note, shot, record }) => {
      await page.locator(".settings summary").click();
      await page.locator("#size-toggle").check();
      await page.locator("#contrast-toggle").check();
      await page.keyboard.press("Escape");
      await select(page, "window");
      await page.locator("#note-more summary").click();
      await note("Large text and high contrast coexist", await page.locator("html").getAttribute("data-large-text") === "true" &&
        await page.locator("html").getAttribute("data-contrast") === "true");
      record.tablet = await noOverflow(page);
      await shot("tablet");
      await page.setViewportSize({ width: 320, height: 740 });
      record.small = await noOverflow(page);
      await shot("320px");
      const contrast = await page.evaluate(() => {
        const luminance = (value) => {
          const components = value.match(/[\d.]+/g).slice(0, 3).map(Number).map((c) => {
            const v = c / 255;
            return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
          });
          return components[0] * .2126 + components[1] * .7152 + components[2] * .0722;
        };
        return ["#note-body", "#note-extra", "#resident-reply", "#plan-reaction"].map((selector) => {
          const element = document.querySelector(selector);
          let current = element;
          let background;
          do {
            background = getComputedStyle(current).backgroundColor;
            current = current.parentElement;
          } while (current && ["transparent", "rgba(0, 0, 0, 0)"].includes(background));
          const a = luminance(getComputedStyle(element).color);
          const b = luminance(background);
          return { selector, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
        });
      });
      record.contrast = contrast;
      await note("Actual story/plan contrast clears 4.5:1", contrast.every((entry) => entry.ratio >= 4.5));
    });

  await run("08-radio", { reducedMotion: "no-preference" }, async ({ page, context, note, shot, record }) => {
    await page.bringToFront();
    await page.evaluate(() => {
      window.__audioContexts = [];
      window.__frequencies = [];
      const original = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function () {
        if (!window.__audioContexts.includes(this)) window.__audioContexts.push(this);
        const oscillator = original.call(this);
        const start = oscillator.start.bind(oscillator);
        oscillator.start = (...args) => {
          window.__frequencies.push(oscillator.frequency.value);
          return start(...args);
        };
        return oscillator;
      };
    });
    await select(page, "radio");
    await note("Inspecting the radio does not play it", await page.evaluate(() => window.__audioContexts.length === 0));
    await action(page, "sound");
    await page.waitForFunction(() => document.documentElement.dataset.sound === "on", null, { timeout });
    const count = await page.evaluate(() => window.__frequencies.length);
    await action(page, "station");
    await note("Next station changes the actual playing melody immediately", await page.evaluate((previous) => window.__frequencies.length >= previous + 6, count));
    await shot("playing", "#notebook");
    const other = await context.newPage();
    await other.goto("about:blank");
    await other.bringToFront();
    record.visibilityBeforeWait = await page.evaluate(() => ({
      hidden: document.hidden, sound: document.documentElement.dataset.sound,
    }));
    await page.waitForFunction(() => document.hidden && document.documentElement.dataset.sound === "off",
      null, { polling: 100, timeout });
    await note("Hiding the tab closes its audio contexts", await page.evaluate(() => window.__audioContexts.every((audio) => audio.state === "closed")));
    await page.bringToFront();
    await page.waitForFunction(() => !document.hidden, null, { polling: 100, timeout });
    await note("Returning does not autoplay", await page.locator("html").getAttribute("data-sound") === "off");
    await other.close();
    await action(page, "sound");
    await page.waitForFunction(() => document.documentElement.dataset.sound === "on");
    await action(page, "sound");
    await page.waitForFunction(() => document.documentElement.dataset.sound === "off");
    await note("Both play/pause controls stay in sync", await page.locator("#sound-toggle").getAttribute("aria-pressed") === "false" &&
      await page.locator('[data-action="sound"]').getAttribute("aria-pressed") === "false");
    record.frequencies = await page.evaluate(() => window.__frequencies);
  }, { nativeVisibility: true });

  await run("09-resilient-visit", { viewport: { width: 390, height: 844 } },
    async ({ page, context, note, shot }) => {
      await note("Old version-one discoveries migrate without loss", (await getState(page))?.seen?.length === 2 ||
        await page.locator("#discovery-count").innerText() === "2 / 9");
      await select(page, "mending");
      await note("Saved reading preferences are preserved", await page.locator("html").getAttribute("data-large-text") === "true");
      await note("OS reduced motion always wins", await page.locator("html").getAttribute("data-reduced-motion") === "true");
      await note("Reduced motion stops decorative animation", await page.locator(".tea-steam").evaluate((element) => getComputedStyle(element).animationName === "none"));
      await shot("migrated");
      await context.addInitScript(() => {
        Storage.prototype.getItem = () => { throw new DOMException("Isolated test", "SecurityError"); };
        Storage.prototype.setItem = () => { throw new DOMException("Isolated test", "QuotaExceededError"); };
      });
      await page.reload();
      await page.locator('html[data-ready="true"]').waitFor();
      await select(page, "tea");
      await action(page, "mint");
      await note("Blocked storage leaves interactions usable", await page.locator("html").getAttribute("data-tea") === "mint");
      await note("Storage failure is visible", await page.locator("#storage-notice").isVisible());
      await shot("storage");
    }, { seed: (() => {
      const state = freshState(true);
      state.version = 1;
      delete state.plans;
      delete state.scraps;
      state.seen = ["window", "cat"];
      state.largeText = true;
      return state;
    })() });

  await run("10-finishing-the-visit", {}, async ({ page, note, shot, record }) => {
    await page.locator("#envelope-button").click();
    await note("An unopened envelope offers the missing discoveries", await page.locator("#discoveries-dialog").isVisible());
    await page.keyboard.press("Escape");
    for (const id of OBJECT_IDS) await select(page, id);
    await note("Nine unique discoveries unlock the envelope", await page.locator("#envelope-button").getAttribute("aria-label") === "Open the Sunday envelope");
    await page.locator("#envelope-button").click();
    await note("The thank-you letter has real content", (await page.locator("#letter-story").innerText()).length > 60);
    await shot("letter", "#letter-dialog");
    record.letter = await page.locator("#letter-dialog").innerText();
    await page.keyboard.press("Escape");
    await page.locator(".settings summary").click();
    await page.locator("#reset-visit").click();
    await note("Starting over offers a cancel before clearing anything", await page.locator("#reset-dialog").isVisible() &&
      (await getState(page)).seen.length === 9);
    await page.locator('#reset-dialog [data-close="reset-dialog"]').last().click();
    await note("Cancel preserves discoveries", (await getState(page)).seen.length === 9);
    await page.locator("#reset-visit").click();
    await page.locator("#confirm-reset").click();
    await note("Confirmed fresh visit clears only this room", (await getState(page)).seen.length === 0);
    await shot("fresh-visit", "#notebook");
    await note("No link advertises the room on the hub", (await page.locator(".home-link").getAttribute("href")) === "/");
  });

  await run("09b-no-javascript", { javaScriptEnabled: false, viewport: { width: 390, height: 844 } },
    async ({ page, note, shot }) => {
      await note("The whole room illustration remains visible without JavaScript", await page.locator(".room-illustration").isVisible());
      await note("Interactive controls are honestly disabled", await page.locator("[data-interactive]").evaluateAll((elements) => elements.every((element) => element.disabled)));
      await note("The no-JavaScript explanation is visible", await page.locator(".noscript-note").isVisible());
      await shot("room");
    }, { scripts: false });
} finally {
  await browser.close();
  await writeFile(path.join(artifactDirectory, "results.json"), JSON.stringify({
    origin: roomOrigin, passed: results.every((entry) => entry.passed),
    scenarios: results.map(({ name, passed, checks, error }) => ({ name, passed, checks: checks.length, error })),
  }, null, 2));
}
console.log(`Playwright evidence: ${artifactDirectory}`);
