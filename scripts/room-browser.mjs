import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";

export const roomOrigin = process.env.ROOM_ORIGIN ?? "http://127.0.0.1:3009";
export const roomUrl = `${roomOrigin}/public/friend9s-room`;
export const artifactDirectory = path.resolve(process.env.ARTIFACT_DIR ??
  path.join(tmpdir(), `friend9-playwright-${randomUUID()}`));

export async function openBrowser() {
  await mkdir(artifactDirectory, { recursive: true });
  return chromium.launch({
    executablePath: process.env.BROWSER_PATH ??
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
    args: ["--mute-audio", "--disable-background-networking", "--disable-component-update"],
  });
}

export async function openNativeVisibilityBrowser() {
  const profile = path.join(artifactDirectory, `native-visibility-${randomUUID()}`);
  await mkdir(profile, { recursive: true });
  const child = spawn(process.env.BROWSER_PATH ??
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
    "--headless=new", "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--mute-audio", "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  const exited = once(child, "exit");
  const endpoint = await new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => reject(new Error("The owned visibility browser did not start.")), 15_000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", () => { clearTimeout(timer); reject(new Error("The owned visibility browser exited early.")); });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-8192);
      const match = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[a-f\d-]+)/i.exec(stderr);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  // Playwright ordinarily forces each page to remain focused. That override
  // cannot prove real tab hiding; the owned default context opts out of it.
  const browser = await chromium.connectOverCDP(endpoint, { noDefaults: true });
  return {
    browser,
    async close() {
      if (browser.isConnected()) {
        const session = await browser.newBrowserCDPSession();
        try { await session.send("Browser.close"); } catch (error) {
          if (!/closed|disconnected/i.test(error.message)) throw error;
        }
      }
      if (child.exitCode === null) {
        await Promise.race([exited, sleep(3000).then(() => {
          if (child.exitCode === null) child.kill();
        })]);
      }
    },
  };
}

export async function openRoom(browser, options = {}, useDefaultContext = false) {
  const settings = {
    viewport: { width: 1440, height: 1050 },
    colorScheme: "light",
    reducedMotion: "reduce",
    ...options,
  };
  const context = useDefaultContext ? browser.contexts()[0] : await browser.newContext(settings);
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  const page = await context.newPage();
  if (useDefaultContext) {
    await page.setViewportSize(settings.viewport);
    await page.emulateMedia({ colorScheme: settings.colorScheme, reducedMotion: settings.reducedMotion });
  }
  const errors = [];
  const requests = [];
  const violations = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (request) => requests.push(request.url()));
  await page.exposeFunction("__recordCspViolation", (directive) => violations.push(directive));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) =>
      window.__recordCspViolation(event.violatedDirective));
  });
  const responses = [];
  page.on("response", (response) => {
    if (response.status() >= 400) responses.push({ url: response.url(), status: response.status() });
  });
  return { context, page, errors, requests, violations, responses };
}

export async function visitRoom(page) {
  await page.goto(roomUrl, { waitUntil: "load" });
  await page.locator('html[data-ready="true"]').waitFor();
}

export async function capture(page, name, selector) {
  if (selector) {
    await page.locator(selector).screenshot({ path: path.join(artifactDirectory, `${name}.png`) });
  } else {
    const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
    await page.screenshot({ path: path.join(artifactDirectory, `${name}.png`), fullPage: true });
    await page.evaluate(({ x, y }) => window.scrollTo({ left: x, top: y, behavior: "instant" }), scroll);
  }
}
