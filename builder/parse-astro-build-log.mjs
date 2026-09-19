#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROUTE_TIMING_RE = /[├└]─\s+(\S+)\s+\(\+(\d+)ms\)/;
const PAGE_GENERATION_START_RE = /generating static routes/i;
// Matches Astro's own top-level phase timer, e.g. "08:51:41 ✓ Completed in
// 47.81s." Deliberately anchored so it does NOT match the "[build] ✓
// Completed in ...s." wrapper line (build info + finalization) or the
// "[vite] ✓ built in ...ms" client-bundle lines, both of which include a
// bracketed prefix before the checkmark.
const PAGE_GENERATION_END_RE = /^(?:\d{2}:\d{2}:\d{2}\s+)?✓\s*Completed in ([\d.]+)s\.?$/;

export const parseRouteTimings = (lines) => {
  const routes = [];
  for (const line of lines) {
    const match = line.match(ROUTE_TIMING_RE);
    if (!match) continue;
    routes.push({
      route: match[1],
      durationMs: Number(match[2]),
    });
  }
  return routes;
};

export const summarizeRouteTimings = (routes, topN = 15) => {
  const slowest = [...routes]
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, topN);
  return {
    count: routes.length,
    totalMs: routes.reduce((sum, route) => sum + route.durationMs, 0),
    slowest,
  };
};

export const logRouteTimingSummary = (lines, topN = 15) => {
  const summary = summarizeRouteTimings(parseRouteTimings(lines), topN);
  if (summary.count === 0) {
    console.log("[timing] route_summary pages=0 total_ms=0");
    return summary;
  }

  console.log(
    `[timing] route_summary pages=${summary.count} total_ms=${summary.totalMs}`,
  );
  for (const route of summary.slowest) {
    console.log(
      `[timing] route_slow path=${route.route} duration_ms=${route.durationMs}`,
    );
  }
  return summary;
};

// Isolates the wall-clock time Astro itself reports for the static-route
// generation phase, separate from the Vite client-entrypoint bundling that
// precedes it within the same `astro build` invocation. Comparing this
// against route_summary's total_ms (the sum of each individual page's
// duration) is what tells us whether pages rendered with real overlap
// (e.g. under build.concurrency > 1) or effectively serially.
export const parsePageGenerationDurationMs = (lines) => {
  const startIndex = lines.findIndex((line) => PAGE_GENERATION_START_RE.test(line));
  if (startIndex === -1) return null;

  for (let i = startIndex; i < lines.length; i += 1) {
    const match = lines[i].trim().match(PAGE_GENERATION_END_RE);
    if (match) return Math.round(Number(match[1]) * 1000);
  }
  return null;
};

export const logPageGenerationSummary = (lines) => {
  const durationMs = parsePageGenerationDurationMs(lines);
  console.log(`[timing] page_generation_summary duration_ms=${durationMs ?? 0}`);
  return { durationMs };
};

const main = () => {
  const sourcePath = process.argv[2];
  const text = sourcePath
    ? readFileSync(sourcePath, "utf8")
    : readFileSync(0, "utf8");
  const lines = text.split(/\r?\n/);
  logRouteTimingSummary(lines);
  logPageGenerationSummary(lines);
};

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main();
}
