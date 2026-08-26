import assert from "node:assert/strict";
import test from "node:test";

import {
  logRouteTimingSummary,
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
