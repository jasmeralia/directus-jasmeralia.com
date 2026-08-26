import { describe, expect, it, beforeEach } from "vitest";

import {
  logDirectusFetchSummary,
  logRouteTimingSummary,
  normalizeDirectusPath,
  parseRouteTimings,
  recordDirectusFetch,
  resetBuildMetrics,
  setBuildMetricsEnabled,
  summarizeDirectusFetches,
  summarizeRouteTimings,
} from "./build-metrics";

describe("build metrics helpers", () => {
  beforeEach(() => {
    resetBuildMetrics();
  });

  it("normalizes Directus paths by collection", () => {
    expect(normalizeDirectusPath("/items/games?fields=id&limit=-1")).toBe("/items/games");
    expect(normalizeDirectusPath("/items/tier_list_games?filter[game_id][_eq]=1")).toBe(
      "/items/tier_list_games",
    );
    expect(normalizeDirectusPath("/revisions?filter[collection][_eq]=games")).toBe("/revisions");
    expect(normalizeDirectusPath("/activity?limit=10")).toBe("/activity");
    expect(normalizeDirectusPath("/custom/endpoint")).toBe("/custom/endpoint");
  });

  it("records and summarizes Directus fetch timings when enabled", () => {
    setBuildMetricsEnabled(true);
    recordDirectusFetch("/items/games?limit=-1", 120);
    recordDirectusFetch("/items/games?fields=id", 80);
    recordDirectusFetch("/items/reviews?limit=-1", 40);

    expect(summarizeDirectusFetches()).toEqual({
      totalCalls: 3,
      totalMs: 240,
      endpoints: [
        { path: "/items/games", stat: { count: 2, totalMs: 200, maxMs: 120 } },
        { path: "/items/reviews", stat: { count: 1, totalMs: 40, maxMs: 40 } },
      ],
    });
  });

  it("ignores fetch recordings when metrics are disabled", () => {
    recordDirectusFetch("/items/games", 100);
    expect(summarizeDirectusFetches().totalCalls).toBe(0);
  });

  it("logs a Directus summary with endpoint lines", () => {
    setBuildMetricsEnabled(true);
    recordDirectusFetch("/items/games", 50);
    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(String(args[0]));
    };
    try {
      logDirectusFetchSummary();
    } finally {
      console.log = original;
    }

    expect(logs[0]).toBe("[timing] directus_summary calls=1 total_ms=50");
    expect(logs[1]).toBe(
      "[timing] directus_endpoint path=/items/games calls=1 total_ms=50 max_ms=50",
    );
  });

  it("logs an empty Directus summary when no fetches were recorded", () => {
    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(String(args[0]));
    };
    try {
      logDirectusFetchSummary();
    } finally {
      console.log = original;
    }

    expect(logs).toEqual(["[timing] directus_summary calls=0 total_ms=0"]);
  });

  it("logs route timing summaries for Astro build output", () => {
    const lines = [
      "05:49:31   ├─ /about/index.html (+26ms)",
      "05:49:31   └─ /games/foo/index.html (+180ms)",
    ];
    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(String(args[0]));
    };

    try {
      const summary = logRouteTimingSummary(lines, 1);
      expect(summary).toEqual({
        count: 2,
        totalMs: 206,
        slowest: [{ route: "/games/foo/index.html", durationMs: 180 }],
      });
      expect(logs).toEqual([
        "[timing] route_summary pages=2 total_ms=206",
        "[timing] route_slow path=/games/foo/index.html duration_ms=180",
      ]);
    } finally {
      console.log = original;
    }
  });

  it("logs an empty route summary when Astro output has no route lines", () => {
    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(String(args[0]));
    };

    try {
      expect(logRouteTimingSummary(["generating static routes"])).toEqual({
        count: 0,
        totalMs: 0,
        slowest: [],
      });
      expect(logs).toEqual(["[timing] route_summary pages=0 total_ms=0"]);
    } finally {
      console.log = original;
    }
  });

  it("parses Astro route timing lines and ranks the slowest routes", () => {
    const lines = [
      "05:49:31 generating static routes",
      "05:49:31   ├─ /about/index.html (+26ms)",
      "05:49:31   ├─ /games/foo/index.html (+180ms)",
      "05:49:31   └─ /games/bar/index.html (+40ms)",
    ];

    expect(parseRouteTimings(lines)).toEqual([
      { route: "/about/index.html", durationMs: 26 },
      { route: "/games/foo/index.html", durationMs: 180 },
      { route: "/games/bar/index.html", durationMs: 40 },
    ]);
    expect(summarizeRouteTimings(parseRouteTimings(lines), 2)).toEqual({
      count: 3,
      totalMs: 246,
      slowest: [
        { route: "/games/foo/index.html", durationMs: 180 },
        { route: "/games/bar/index.html", durationMs: 40 },
      ],
    });
  });
});
