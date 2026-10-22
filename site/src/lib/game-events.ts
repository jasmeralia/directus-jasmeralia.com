import { fmtDelta, type Activity, type Revision } from "./changelog";
import type { GameSection } from "./game-sections";

export type GameEventType =
  | "game_added" | "game_updated"
  | "link_added" | "link_updated"
  | "genre_added"
  | "sections_changed"
  | "music_list_added" | "music_list_updated" | "music_tracks_changed"
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

export function isCreateRevision(revision: Revision, isOldestKnownForItem: boolean): boolean {
  return revision.activity?.action === "create" || isOldestKnownForItem;
}

export function describeReviewEvent(input: {
  revision: Revision;
  previousData?: Record<string, unknown> | null;
  includeGame: boolean;
  gameTitle?: string;
}): GameEvent | null {
  const { revision, previousData } = input;
  const data = revision.data ?? {};
  if (data.status !== "published" && revision.delta?.status !== "published") return null;

  const isPublished = revision.activity?.action === "create" || revision.delta?.status === "published";
  const subject = typeof data.title === "string" && data.title.trim() ? data.title : "Untitled";
  if (isPublished) {
    const lines: string[] = [];
    if (input.includeGame && input.gameTitle) lines.push(`**Game**: ${input.gameTitle}`);
    if (data.rating) lines.push(`**Rating**: ${String(data.rating)}/10`);
    if (data.published_at) lines.push(`**Published**: ${String(data.published_at).slice(0, 10)}`);
    return {
      type: "review_published",
      title: "Review Published",
      subject,
      body: lines.join("\n") || "New review published.",
    };
  }

  const body = fmtDelta(revision.delta ?? {}, previousData ?? null);
  if (!body.trim()) return null;
  return { type: "review_updated", title: "Review Updated", subject, body };
}

const bundleDelta = (record: Record<string, unknown> | null): Record<string, unknown> => {
  if (!record) return {};
  const fields = [
    "title",
    "release_year",
    "cover_image",
    "player_status",
    "section_data_status",
    "section_noun",
    "current_section",
  ];
  return Object.fromEntries(
    fields
      .filter((field) => Object.prototype.hasOwnProperty.call(record, field))
      .map((field) => [field, record[field]]),
  );
};

export function describeMemberEvent(input: {
  revision: Revision;
  previousData: Record<string, unknown> | null;
  sections: GameSection[] | null;
  isCreate: boolean;
  isDelete: boolean;
}): GameEvent | null {
  const { revision, previousData, sections, isCreate, isDelete } = input;
  const data = revision.data ?? {};
  const subject = typeof data.title === "string" && data.title.trim() ? data.title : "Untitled";
  if (isDelete) {
    return { type: "member_removed", title: "Included Game Removed", subject, body: "Included game removed." };
  }
  if (isCreate) {
    return {
      type: "member_added",
      title: "Included Game Added",
      subject,
      body: fmtDelta(bundleDelta(data), null, data, sections),
    };
  }
  const body = fmtDelta(
    bundleDelta(revision.delta),
    bundleDelta(previousData),
    data,
    sections,
  );
  if (!body.trim()) return null;
  return { type: "member_updated", title: "Included Game Updated", subject, body };
}

export function describeTierEntryAdded(input: { tierListTitle: string; rating: string }): GameEvent {
  return {
    type: "tier_entry_added",
    title: "Added to Tier List",
    subject: input.tierListTitle,
    body: `**Tier**: ${input.rating}`,
  };
}
