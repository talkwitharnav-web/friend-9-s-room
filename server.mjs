import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

export const ROOM_PATH = "/public/friend9s-room";
const PUBLIC_DIRECTORY = new URL("./public/", import.meta.url);
const ALLOWED_HOSTS = new Set([
  "itsvibed.com",
  "www.itsvibed.com",
  "localhost",
  "127.0.0.1",
  "[::1]",
]);

export const SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy": [
    "default-src 'none'",
    "script-src 'self'",
    "script-src-attr 'none'",
    "style-src 'self'",
    "style-src-attr 'none'",
    "img-src 'self'",
    "font-src 'none'",
    "connect-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
});

function loadAssets() {
  const illustration = readFileSync(new URL("room.svg", PUBLIC_DIRECTORY), "utf8");
  const entries = [
    ["", "index.html", "text/html; charset=utf-8"],
    ["/room.css", "room.css", "text/css; charset=utf-8"],
    ["/room.js", "room.js", "text/javascript; charset=utf-8"],
    ["/room.svg", "room.svg", "image/svg+xml"],
    ["/favicon.svg", "favicon.svg", "image/svg+xml"],
  ];
  // Requests never become filesystem paths. Only these shipped files are public.
  return new Map(
    entries.map(([suffix, filename, contentType]) => {
      let body = readFileSync(new URL(filename, PUBLIC_DIRECTORY));
      if (filename === "index.html") {
        const html = body.toString("utf8");
        if (html.split("<!-- ROOM_ILLUSTRATION -->").length !== 2) {
          throw new Error("The room document must have exactly one illustration slot.");
        }
        body = Buffer.from(html.replace("<!-- ROOM_ILLUSTRATION -->", illustration));
      }
      const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
      return [`${ROOM_PATH}${suffix}`, { body, contentType, etag }];
    }),
  );
}

function validHost(host) {
  if (typeof host !== "string") return false;
  const match = /^(\[[a-f\d:]+\]|[a-z\d.-]+)(?::(\d{1,5}))?$/i.exec(host);
  if (!match || (match[2] && Number(match[2]) > 65535)) return false;
  return ALLOWED_HOSTS.has(match[1].toLowerCase());
}

export function createRoomServer() {
  const assets = loadAssets();
  const server = createServer(
    {
      maxHeaderSize: 8192,
      headersTimeout: 10_000,
      requestTimeout: 10_000,
      connectionsCheckingInterval: 1000,
      keepAliveTimeout: 3000,
    },
    (request, response) => {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        response.setHeader(name, value);
      }
      // Keep the edge from injecting analytics or inline detection scripts.
      response.setHeader("Cache-Control", "no-store, no-transform");

      const send = (status, content, contentType = "text/plain; charset=utf-8") => {
        response.writeHead(status, {
          "Content-Type": contentType,
          "Content-Length": Buffer.byteLength(content),
        });
        response.end(request.method === "HEAD" ? undefined : content);
      };
      const refuse = (status, message) => {
        response.setHeader("Connection", "close");
        send(status, message);
      };

      if (!validHost(request.headers.host)) {
        refuse(400, "Invalid host.");
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("Allow", "GET, HEAD");
        refuse(405, "This room only accepts visits.");
        return;
      }
      if (
        request.headers["transfer-encoding"] !== undefined ||
        (request.headers["content-length"] !== undefined &&
          request.headers["content-length"] !== "0")
      ) {
        refuse(413, "Request bodies are not accepted.");
        return;
      }
      const target = request.url ?? "";
      if (
        target.length > 2048 ||
        !target.startsWith("/") ||
        target.startsWith("//") ||
        /[\\\u0000-\u0020\u007f]/.test(target)
      ) {
        refuse(400, "Invalid visit.");
        return;
      }

      // Do not decode or normalize paths: even encoded traversal gets no asset.
      const pathname = target.split("?", 1)[0];
      if (
        pathname === "/friend9s-room" ||
        pathname === "/friend9s-room/" ||
        pathname === `${ROOM_PATH}/`
      ) {
        response.setHeader("Location", ROOM_PATH);
        send(302, "The door is just over here.");
        return;
      }
      if (pathname === "/health") {
        send(200, '{"status":"ok","service":"friend9-room"}', "application/json");
        return;
      }
      const asset = assets.get(pathname);
      if (!asset) {
        send(404, "Nothing tucked away here.");
        return;
      }

      // Revalidate assets across releases; HTML and redirects are never cached.
      if (pathname !== ROOM_PATH) {
        response.setHeader("Cache-Control", "public, max-age=0, must-revalidate, no-transform");
      }
      response.setHeader("ETag", asset.etag);
      if (request.headers["if-none-match"] === asset.etag) {
        response.writeHead(304);
        response.end();
        return;
      }
      send(200, asset.body, asset.contentType);
    },
  );
  server.maxConnections = 96;
  server.maxRequestsPerSocket = 100;
  server.setTimeout(10_000, (socket) => socket.destroy());
  server.on("clientError", (_error, socket) => {
    if (!socket.writable || socket.destroyed) return;
    socket.end(
      "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    );
  });
  return server;
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3009);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  const server = createRoomServer();
  server.on("error", (error) => {
    console.error(`[friend9] ${error.code ?? "startup"}: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`[friend9] http://127.0.0.1:${port}${ROOM_PATH}`);
    console.log(`[friend9] Serving ${fileURLToPath(PUBLIC_DIRECTORY)}`);
  });
  const shutdown = () => {
    server.close();
    server.closeIdleConnections();
    setTimeout(() => server.closeAllConnections(), 5000).unref();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
