import { buildSourceEntries } from "./feed-builder";
import type { SourceEntry, UpdateTag } from "./feed-builder";

export type { UpdateTag } from "./feed-builder";

const UPDATE_BURST_WINDOW_MS = 30 * 60 * 1000;

type DatedKeyed = { key: string; date: Date };

// Collapse anchored runs within each key, returning the newest entry in each run.
function collapseBursts<T extends DatedKeyed>(
  candidates: T[],
  windowMs: number,
  mergeSession: (session: T[], representative: T) => T,
): T[] {
  const byKey = new Map<string, T[]>();
  for (const candidate of candidates) {
    const group = byKey.get(candidate.key) ?? [];
    group.push(candidate);
    byKey.set(candidate.key, group);
  }

  const collapsed: T[] = [];
  for (const group of byKey.values()) {
    group.sort((a, b) => a.date.getTime() - b.date.getTime());
    let session: T[] = [];
    let anchor = 0;
    const flush = () => {
      collapsed.push(mergeSession(session, session[session.length - 1]));
      session = [];
    };
    for (const candidate of group) {
      if (session.length && candidate.date.getTime() - anchor > windowMs) flush();
      if (!session.length) anchor = candidate.date.getTime();
      session.push(candidate);
    }
    flush();
  }
  return collapsed;
}

export type UpdateEntry = {
  tag: UpdateTag;
  subject: string;
  link: string;
  timestamp: Date;
  nsfw: boolean;
};

export async function fetchRecentUpdates(limit = 10): Promise<UpdateEntry[]> {
  const sourceEntries = await buildSourceEntries();
  const entries: UpdateEntry[] = sourceEntries
    .filter((entry): entry is SourceEntry & { widget: { tag: UpdateTag; subject: string } } => entry.widget !== undefined)
    .map((entry) => ({
      tag: entry.widget.tag,
      subject: entry.widget.subject,
      link: entry.link,
      timestamp: entry.pubDate,
      nsfw: entry.nsfw,
    }));

  const tierCandidates = entries
    .filter((entry) => entry.tag === "tier-updated")
    .map((entry) => ({ key: entry.link, date: entry.timestamp, entry }));
  const tierEntries = collapseBursts(
    tierCandidates,
    UPDATE_BURST_WINDOW_MS,
    (session, representative) => ({
      ...representative,
      entry: {
        ...representative.entry,
        nsfw: session.some(({ entry }) => entry.nsfw),
      },
    }),
  ).map(({ entry }) => entry);
  const nonTierEntries = entries.filter((entry) => entry.tag !== "tier-updated");

  return [...nonTierEntries, ...tierEntries]
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, limit);
}

export function formatUpdateTimestamp(date: Date): string {
  const tz =
    (import.meta.env.SITE_TIMEZONE as string | undefined) ||
    "America/Los_Angeles";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
    timeZoneName: "short",
  });
}
