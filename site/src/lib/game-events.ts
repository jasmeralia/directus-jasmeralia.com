import type { Activity, Revision } from "./changelog";

export type GameEventType =
  | "game_added" | "game_updated"
  | "link_added" | "link_updated"
  | "genre_added"
  | "sections_changed"
  | "review_published" | "review_updated"
  | "member_added" | "member_updated" | "member_removed"
  | "tier_entry_added";

export type GameEvent = {
  type: GameEventType;
  title: string;
  subject?: string;
  body: string;
};

const LINK_KIND_LABELS: Record<string, string> = {
  download: "Download",
  walkthrough: "Walkthrough",
  "text-note": "Walkthrough note",
  other: "Other link",
  gamestorylog: "GameStoryLog",
};

const LINK_EVENT_TITLES: Record<string, string> = {
  walkthrough: "Walkthrough Link",
  "text-note": "Walkthrough Link",
  other: "Other Link",
  gamestorylog: "GameStoryLog Link",
};

function fmtLinkDelta(
  delta: Record<string, unknown>,
  prev: Record<string, unknown> | null,
  data: Record<string, unknown> | null,
  isCreate: boolean,
  currentUrl: string | undefined,
): string {
  const show = (field: string, value: unknown) =>
    field === "kind" ? (LINK_KIND_LABELS[String(value)] ?? String(value)) : String(value);
  const dash = "\u2014";
  const lines: string[] = [];
  if (isCreate) {
    const source = data ?? delta;
    for (const [field, label] of [["url", "URL"], ["kind", "Kind"], ["label", "Label"]] as const) {
      const value = source[field];
      if (value !== null && value !== undefined && value !== "") lines.push(`**${label}**: ${show(field, value)}`);
    }
    return lines.join("\n");
  }
  const changes: string[] = [];
  for (const [field, label] of [["kind", "Kind"], ["label", "Label"]] as const) {
    if (!(field in delta) || delta[field] === (prev?.[field] ?? null)) continue;
    const before = prev?.[field] ?? null;
    const next = delta[field];
    changes.push(
      `**${label}**: ${before === null ? dash : show(field, before)} \u2192 ${next === null ? dash : show(field, next)}`,
    );
  }
  const urlChanged = "url" in delta && delta.url !== prev?.url;
  if (!urlChanged && !changes.length) return "";
  const url = (data?.url ?? currentUrl) as string | undefined;
  const urlLine = urlChanged
    ? `**URL**: ${prev?.url ? String(prev.url) : dash} \u2192 ${String(delta.url)}`
    : url
      ? `**URL**: ${url}`
      : "";
  return [urlLine, ...changes].filter(Boolean).join("\n");
}

export function describeLinkEvent(input: {
  action: "create" | "update" | string;
  link: { url?: string; kind?: string };
  revision?: Revision | null;
  previousData?: Record<string, unknown> | null;
}): GameEvent | null {
  const { action, link, revision } = input;
  const isCreate = action !== "update";
  const kind = link.kind ?? "download";
  const title = `${LINK_EVENT_TITLES[kind] ?? "Download Link"} ${isCreate ? "Added" : "Updated"}`;
  let body = "";
  if (revision) {
    body = fmtLinkDelta(
      revision.delta ?? {},
      input.previousData ?? null,
      revision.data ?? null,
      isCreate,
      link.url,
    );
    if (!isCreate && !body) return null;
  } else if (link.url) {
    body = `**URL**: ${link.url}`;
  }
  return { type: isCreate ? "link_added" : "link_updated", title, body };
}

export const GENRE_CREATION_WINDOW_MS = 5 * 60 * 1000;

export function partitionGameGenres(input: {
  genreLinks: { id: number; name: string }[];
  activities: Activity[];
  createdAt: Date | null;
}): { initial: string[]; added: { name: string; at: Date; activityId: number }[] } {
  const activitiesByItem = new Map(input.activities.map((activity) => [Number(activity.item), activity]));
  const initial: string[] = [];
  const added: { name: string; at: Date; activityId: number }[] = [];
  for (const genre of input.genreLinks) {
    const activity = activitiesByItem.get(genre.id);
    if (!activity || !input.createdAt) {
      initial.push(genre.name);
      continue;
    }
    const at = new Date(activity.timestamp);
    if (at.getTime() - input.createdAt.getTime() <= GENRE_CREATION_WINDOW_MS) {
      initial.push(genre.name);
    } else {
      added.push({ name: genre.name, at, activityId: activity.id });
    }
  }
  return { initial, added };
}

export function describeGenreAdded(name: string): GameEvent {
  return { type: "genre_added", title: "Genre Added", body: `**Genre**: ${name}` };
}
