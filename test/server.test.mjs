import assert from "node:assert/strict";
import { once } from "node:events";
import { request } from "node:http";
import { after, before, test } from "node:test";
import { createRoomServer, ROOM_PATH, SECURITY_HEADERS } from "../server.mjs";

let server;
let port;
let origin;

before(async () => {
  server = createRoomServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  port = server.address().port;
  origin = `http://127.0.0.1:${port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

function visit(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: options.method ?? "GET",
        headers: options.headers ?? {},
        setHost: options.setHost ?? true,
        timeout: 3000,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Request timed out.")));
    req.end(options.body);
  });
}

test("short links redirect temporarily to the exact canonical room", async () => {
  for (const path of [
    "/friend9s-room",
    "/friend9s-room/",
    "/friend9s-room?next=https://example.com",
    `${ROOM_PATH}/`,
  ]) {
    const response = await visit(path);
    assert.equal(response.status, 302, path);
    assert.equal(response.headers.location, ROOM_PATH);
    assert.equal(response.headers["cache-control"], "no-store");
  }
  const response = await fetch(`${origin}/friend9s-room`);
  assert.equal(response.url, `${origin}${ROOM_PATH}`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Friend 9/);
});

test("the page and every namespaced asset load without a fallback document", async () => {
  const assets = [
    ["", "text/html", "<!doctype html>"],
    ["/room.css", "text/css", ":root"],
    ["/room.js", "text/javascript", "const "],
    ["/room.svg", "image/svg+xml", "<svg"],
    ["/favicon.svg", "image/svg+xml", "<svg"],
  ];
  for (const [suffix, contentType, marker] of assets) {
    const response = await visit(`${ROOM_PATH}${suffix}`);
    assert.equal(response.status, 200, suffix);
    assert.ok(response.headers["content-type"].startsWith(contentType), suffix);
    assert.ok(response.body.includes(marker), suffix);
  }
});

test("both published hostnames are accepted, including explicit HTTPS ports", async () => {
  for (const host of ["itsvibed.com", "www.itsvibed.com", "itsvibed.com:443"]) {
    assert.equal(
      (await visit(ROOM_PATH, { headers: { Host: host } })).status,
      200,
      host,
    );
  }
});

test("unapproved and malformed hosts fail regardless of forwarding claims", async () => {
  for (const host of [
    "example.com",
    "itsvibed.com.evil.example",
    "itsvibed.com@evil.example",
    "localhost:99999",
    "localhost.",
  ]) {
    const response = await visit(ROOM_PATH, {
      headers: {
        Host: host,
        "X-Forwarded-Host": "localhost",
        "X-Forwarded-For": "127.0.0.1",
      },
    });
    assert.equal(response.status, 400, host);
  }
  assert.equal((await visit(ROOM_PATH, { setHost: false })).status, 400);
});

test("unknown paths, admin routes, dotfiles and traversal expose no files", async () => {
  for (const path of [
    "/",
    "/admin",
    "/api/admin",
    "/.env",
    "/.git/config",
    "/server.mjs",
    "/friend9s-room-extra",
    `${ROOM_PATH}-extra`,
    `${ROOM_PATH}/admin`,
    `${ROOM_PATH}/../server.mjs`,
    `${ROOM_PATH}/%2e%2e/server.mjs`,
    `${ROOM_PATH}/%252e%252e/.env`,
    `${ROOM_PATH}/%00`,
    `${ROOM_PATH}/%zz`,
    `${ROOM_PATH}/missing.js`,
  ]) {
    const response = await visit(path);
    assert.equal(response.status, 404, path);
    assert.equal(response.body, "Nothing tucked away here.");
  }
});

test("HEAD has the same status and representation length without response bytes", async () => {
  for (const path of [ROOM_PATH, `${ROOM_PATH}/room.js`, "/missing", "/friend9s-room"]) {
    const get = await visit(path);
    const head = await visit(path, { method: "HEAD" });
    assert.equal(head.status, get.status);
    assert.equal(head.headers["content-length"], get.headers["content-length"]);
    assert.equal(head.body, "");
  }
});

test("assets revalidate and the canonical document is never stored", async () => {
  const asset = await visit(`${ROOM_PATH}/room.css`);
  const cached = await visit(`${ROOM_PATH}/room.css`, {
    headers: { "If-None-Match": asset.headers.etag },
  });
  assert.equal(cached.status, 304);
  assert.equal(cached.body, "");
  assert.equal(asset.headers["cache-control"], "public, max-age=0, must-revalidate");
  assert.equal((await visit(ROOM_PATH)).headers["cache-control"], "no-store");
});

test("methods and even GET bodies are refused without changing any state", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE"]) {
    const response = await visit(ROOM_PATH, { method });
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.allow, "GET, HEAD");
    assert.equal(response.headers.connection, "close");
  }
  for (const headers of [
    { "Content-Length": "3" },
    { "Transfer-Encoding": "chunked" },
  ]) {
    assert.equal((await visit(ROOM_PATH, { headers, body: "abc" })).status, 413);
  }
  assert.equal((await visit(ROOM_PATH)).status, 200);
});

test("every application response has strict browser protections and no cookies", async () => {
  for (const path of [ROOM_PATH, "/friend9s-room", "/missing", "/health"]) {
    const response = await visit(path);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      assert.equal(response.headers[name.toLowerCase()], value, `${path}: ${name}`);
    }
    assert.equal(response.headers["set-cookie"], undefined);
    assert.equal(response.headers["access-control-allow-origin"], undefined);
    assert.doesNotMatch(response.headers["content-security-policy"], /unsafe-inline|unsafe-eval/);
  }
});

test("query strings are inert and never reflected into the room", async () => {
  const normal = await visit(ROOM_PATH);
  const injected = await visit(`${ROOM_PATH}?name=%3Cscript%3Ealert(1)%3C/script%3E`);
  assert.equal(injected.status, 200);
  assert.equal(injected.body, normal.body);
});

test("health is minimal and the service only listens on loopback", async () => {
  assert.equal(server.address().address, "127.0.0.1");
  assert.deepEqual(JSON.parse((await visit("/health")).body), {
    status: "ok",
    service: "friend9-room",
  });
});

test("oversized request targets are bounded", async () => {
  assert.equal((await visit(`/${"a".repeat(2100)}`)).status, 400);
});
