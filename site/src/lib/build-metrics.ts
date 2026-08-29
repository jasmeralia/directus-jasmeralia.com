export type DirectusEndpointStat = {
  count: number;
  totalMs: number;
  maxMs: number;
};

export type DirectusFetchSummary = {
  totalCalls: number;
  totalMs: number;
  endpoints: Array<{ path: string; stat: DirectusEndpointStat }>;
};

export type RouteTiming = {
  route: string;
  durationMs: number;
};

export type RouteTimingSummary = {
  count: number;
  totalMs: number;
  slowest: RouteTiming[];
};

type MetricsState = {
  enabled: boolean;
  endpoints: Map<string, DirectusEndpointStat>;
  totalCalls: number;
  totalMs: number;
};

// Astro loads astro.config.mjs (and this module, via the build-metrics
// integration) through a separate config-bundling step from the Vite SSR
// pipeline that later compiles/runs directus.ts and the page files. That
// produces two distinct instances of this module in the same process, so a
// plain module-scoped object would silently fork state between the
// integration (which flips `enabled`) and directusFetch (which records
// calls). Stash state on globalThis, which is shared across both.
const GLOBAL_METRICS_KEY = Symbol.for("jasmeralia.buildMetricsState");

type GlobalWithMetrics = typeof globalThis & {
  [GLOBAL_METRICS_KEY]?: MetricsState;
};

const getMetricsState = (): MetricsState => {
  const g = globalThis as GlobalWithMetrics;
  if (!g[GLOBAL_METRICS_KEY]) {
    g[GLOBAL_METRICS_KEY] = {
      enabled: false,
      endpoints: new Map<string, DirectusEndpointStat>(),
      totalCalls: 0,
      totalMs: 0,
    };
  }
  return g[GLOBAL_METRICS_KEY];
};

export const setBuildMetricsEnabled = (enabled: boolean): void => {
  getMetricsState().enabled = enabled;
};

export const resetBuildMetrics = (): void => {
  const state = getMetricsState();
  state.endpoints.clear();
  state.totalCalls = 0;
  state.totalMs = 0;
  state.enabled = false;
};

export const normalizeDirectusPath = (path: string): string => {
  const bare = path.split("?")[0] ?? path;
  const itemsMatch = bare.match(/^\/items\/([^/?]+)/);
  if (itemsMatch) return `/items/${itemsMatch[1]}`;
  const systemMatch = bare.match(/^\/(revisions|activity)(?:\/|$)/);
  if (systemMatch) return `/${systemMatch[1]}`;
  return bare;
};

export const recordDirectusFetch = (path: string, durationMs: number): void => {
  const state = getMetricsState();
  if (!state.enabled) return;

  const key = normalizeDirectusPath(path);
  const existing = state.endpoints.get(key) ?? {
    count: 0,
    totalMs: 0,
    maxMs: 0,
  };
  existing.count += 1;
  existing.totalMs += durationMs;
  existing.maxMs = Math.max(existing.maxMs, durationMs);
  state.endpoints.set(key, existing);
  state.totalCalls += 1;
  state.totalMs += durationMs;
};

export const summarizeDirectusFetches = (topN = 10): DirectusFetchSummary => {
  const state = getMetricsState();
  const endpoints = [...state.endpoints.entries()]
    .map(([path, stat]) => ({ path, stat }))
    .sort(
      (left, right) => right.stat.totalMs - left.stat.totalMs
        || right.stat.count - left.stat.count,
    )
    .slice(0, topN);

  return {
    totalCalls: state.totalCalls,
    totalMs: state.totalMs,
    endpoints,
  };
};

export const logDirectusFetchSummary = (topN = 10): void => {
  const { totalCalls, totalMs, endpoints } = summarizeDirectusFetches(topN);
  if (totalCalls === 0) {
    console.log("[timing] directus_summary calls=0 total_ms=0");
    return;
  }

  console.log(`[timing] directus_summary calls=${totalCalls} total_ms=${totalMs}`);
  for (const { path, stat } of endpoints) {
    console.log(
      `[timing] directus_endpoint path=${path} calls=${stat.count} total_ms=${stat.totalMs} max_ms=${stat.maxMs}`,
    );
  }
};

const ROUTE_TIMING_RE = /[├└]─\s+(\S+)\s+\(\+(\d+)ms\)/;

export const parseRouteTimings = (lines: string[]): RouteTiming[] => {
  const routes: RouteTiming[] = [];
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

export const summarizeRouteTimings = (
  routes: RouteTiming[],
  topN = 15,
): RouteTimingSummary => {
  const slowest = [...routes]
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, topN);
  return {
    count: routes.length,
    totalMs: routes.reduce((sum, route) => sum + route.durationMs, 0),
    slowest,
  };
};

export const logRouteTimingSummary = (
  lines: string[],
  topN = 15,
): RouteTimingSummary => {
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
