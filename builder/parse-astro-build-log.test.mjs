import assert from "node:assert/strict";
import test from "node:test";

import {
  logPageGenerationSummary,
  logRouteTimingSummary,
  parsePageGenerationDurationMs,
  parseRouteTimings,
  summarizeRouteTimings,
} from "./parse-astro-build-log.mjs";

test("parses Astro route timing lines from build output", () => {
  const lines = [
    "generating static routes",
    "05:49:31   ├─ /about/index.html (+26ms)",
    "05:49:31   └─ /games/foo/index.html (+180ms)",
  ];

  assert.deepEqual(parseRouteTimings(lines), [
    { route: "/about/index.html", durationMs: 26 },
    { route: "/games/foo/index.html", durationMs: 180 },
  ]);
});

test("logs a route summary with the slowest pages", () => {
  const lines = [
    "05:49:31   ├─ /about/index.html (+26ms)",
    "05:49:31   └─ /games/foo/index.html (+180ms)",
  ];
  const logs = [];
  const original = console.log;
  console.log = (...args) => {
    logs.push(args.join(" "));
  };

  try {
    const summary = logRouteTimingSummary(lines, 1);
    assert.equal(summary.count, 2);
    assert.equal(summary.totalMs, 206);
    assert.deepEqual(logs, [
      "[timing] route_summary pages=2 total_ms=206",
      "[timing] route_slow path=/games/foo/index.html duration_ms=180",
    ]);
  } finally {
    console.log = original;
  }
});

test("summarizeRouteTimings handles builds with no route lines", () => {
  assert.deepEqual(summarizeRouteTimings(parseRouteTimings(["no routes here"])), {
    count: 0,
    totalMs: 0,
    slowest: [],
  });
});

test("parses the page-generation phase duration from Astro's own completion line", () => {
  const lines = [
    "08:50:53 [build] Building static entrypoints...",
    "08:50:53 [vite] ✓ built in 405ms",
    "08:50:53 [build] Rearranging server assets...",
    " generating static routes ",
    "08:51:41   ├─ /about/index.html (+26ms)",
    "08:51:41   └─ /games/foo/index.html (+180ms)",
    "08:51:41 ✓ Completed in 47.81s.",
    "08:51:41 [build] ✓ Completed in 48.29s.",
    "08:51:41 [build] 4047 page(s) built in 48.51s",
  ];

  assert.equal(parsePageGenerationDurationMs(lines), 47810);
});

test("returns null for page-generation duration when markers are missing", () => {
  assert.equal(parsePageGenerationDurationMs(["no phase markers here"]), null);
});

test("logs the page-generation summary", () => {
  const lines = [" generating static routes ", "08:51:41 ✓ Completed in 47.81s."];
  const logs = [];
  const original = console.log;
  console.log = (...args) => {
    logs.push(args.join(" "));
  };

  try {
    assert.deepEqual(logPageGenerationSummary(lines), { durationMs: 47810 });
    assert.deepEqual(logs, ["[timing] page_generation_summary duration_ms=47810"]);
  } finally {
    console.log = original;
  }
});

test("logs a zero page-generation summary when markers are missing", () => {
  const logs = [];
  const original = console.log;
  console.log = (...args) => {
    logs.push(args.join(" "));
  };

  try {
    assert.deepEqual(logPageGenerationSummary(["no phase markers here"]), {
      durationMs: null,
    });
    assert.deepEqual(logs, ["[timing] page_generation_summary duration_ms=0"]);
  } finally {
    console.log = original;
  }
});
