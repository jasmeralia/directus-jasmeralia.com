/**
 * Minimal webhook receiver for rebuild + publish.
 *
 * Security:
 * - Require X-Webhook-Secret header to match WEBHOOK_SECRET env var.
 * - Keep this service LAN-only (no public exposure).
 *
 * Usage:
 * - POST http://<truenas>:8099/build
 *   Header: X-Webhook-Secret: <secret>
 *   Body: anything (ignored)
 */
const http = require("http");
const { spawn } = require("child_process");

const PORT = parseInt(process.env.PORT || "8099", 10);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const DEBOUNCE_SECONDS = parseInt(process.env.DEBOUNCE_SECONDS || "300", 10);

if (!WEBHOOK_SECRET || WEBHOOK_SECRET.length < 16) {
  console.error("ERROR: WEBHOOK_SECRET must be set (and should be long/random).");
  process.exit(1);
}

let debounceTimer = null;
let buildRunning = false;
let queued = false;

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function runBuild() {
  if (buildRunning) {
    queued = true;
    log("Build already running; queued another run.");
    return;
  }

  buildRunning = true;
  queued = false;

  log("Starting build/publish...");
  const child = spawn("/bin/bash", ["/srv/run-build.sh"], { stdio: "inherit" });

  child.on("exit", (code) => {
    buildRunning = false;
    if (code === 0) log("Build/publish completed successfully.");
    else log(`Build/publish FAILED with exit code ${code}.`);

    // If another request arrived during the run, trigger again (once).
    if (queued) {
      log("Running queued build...");
      scheduleBuild(0);
    }
  });
}

function scheduleBuild(delaySeconds) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    runBuild();
  }, Math.max(0, delaySeconds) * 1000);
}

function extractReason(body) {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed.reason === "string") return parsed.reason;
  } catch (err) {
    // Fall through to form parsing.
  }
  try {
    const params = new URLSearchParams(body);
    const reason = params.get("reason");
    return typeof reason === "string" ? reason : null;
  } catch (err) {
    return null;
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/build") {
    const secret = req.headers["x-webhook-secret"];
    if (secret !== WEBHOOK_SECRET) {
      res.writeHead(401, { "Content-Type": "text/plain" });
      res.end("Unauthorized\n");
      return;
    }

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.socket.destroy();
      }
    });
    req.on("end", () => {
      const reason = extractReason(body);
      if (reason === "manual") {
        log("Build requested via webhook (manual; bypass debounce).");
        scheduleBuild(0);
      } else {
        log("Build requested via webhook (debounced).");
        scheduleBuild(DEBOUNCE_SECONDS);
      }
      res.writeHead(202, { "Content-Type": "text/plain" });
      res.end("Accepted\n");
    });
    return;
  }

  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok\n");
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found\n");
});

server.listen(PORT, "0.0.0.0", () => {
  log(`Webhook builder listening on :${PORT}`);
});
