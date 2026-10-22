import type { Revision } from "./changelog";
import type { GameEvent } from "./game-events";
import { relationId } from "./section-events";

export type MusicList = {
  id: number;
  title?: string;
  games_id?: number | string | { id?: number } | null;
  tracks?: unknown[];
};

export type MusicTrackRun = {
  key: string;
  listId: number;
  timestamp: string;
  revisions: Revision[];
};

const runBucket = (timestamp: string): string => timestamp.slice(0, 16).replace(/[-:]/g, "");
const listTitle = (value: unknown): string => typeof value === "string" && value.trim() ? value : "Untitled";

export function describeMusicListEvent(input: {
  revision: Revision;
  previousData?: Record<string, unknown> | null;
}): GameEvent | null {
  const { revision, previousData } = input;
  const data = revision.data ?? {};
  const title = listTitle(data.title ?? previousData?.title);
  if (revision.activity?.action === "create") {
    const url = typeof data.url === "string" ? data.url : "";
    return {
      type: "music_list_added",
      title: "Music List Added",
      subject: title,
      body: url ? `**URL**: ${url}` : "New music list.",
    };
  }
  if (revision.activity?.action !== "update") return null;

  const delta = revision.delta ?? {};
  const lines: string[] = [];
  for (const [field, label] of [["title", "Title"], ["url", "URL"]] as const) {
    if (!(field in delta) || delta[field] === previousData?.[field]) continue;
    const before = previousData?.[field];
    const after = delta[field];
    lines.push(`**${label}**: ${before == null || before === "" ? "-" : String(before)} -> ${after == null || after === "" ? "-" : String(after)}`);
  }
  if ("description" in delta && delta.description !== previousData?.description) {
    lines.push("**Description**: updated");
  }
  if (!lines.length) return null;
  return { type: "music_list_updated", title: "Music List Updated", subject: title, body: lines.join("\n") };
}

export function resolveMusicListGames(
  listRevisions: Revision[],
  currentLists: MusicList[],
  currentGameId?: number,
): Map<number, number> {
  const gamesByList = new Map<number, number>();
  for (const revision of listRevisions) {
    const listId = Number(revision.item);
    const gameId = relationId(revision.data?.games_id);
    if (listId && gameId && !gamesByList.has(listId)) gamesByList.set(listId, gameId);
  }
  for (const list of currentLists) {
    const gameId = currentGameId ?? relationId(list.games_id);
    if (list.id && gameId) gamesByList.set(list.id, gameId);
  }
  return gamesByList;
}

export function groupMusicTrackRuns(revisions: Revision[]): MusicTrackRun[] {
  const listByTrack = new Map<number, number>();
  for (const revision of revisions) {
    const trackId = Number(revision.item);
    const listId = relationId(revision.data?.games_music_lists_id);
    if (trackId && listId && !listByTrack.has(trackId)) listByTrack.set(trackId, listId);
  }
  const runs = new Map<string, MusicTrackRun>();
  for (const revision of revisions) {
    const listId = listByTrack.get(Number(revision.item));
    const timestamp = revision.activity?.timestamp;
    if (!listId || !timestamp) continue;
    const key = `${listId}_${runBucket(timestamp)}`;
    let run = runs.get(key);
    if (!run) {
      run = { key, listId, timestamp, revisions: [] };
      runs.set(key, run);
    }
    run.revisions.push(revision);
    if (timestamp > run.timestamp) run.timestamp = timestamp;
  }
  return Array.from(runs.values());
}

export function describeMusicTrackRun(run: MusicTrackRun, subject: string): { event: GameEvent; at: string } | null {
  let added = 0;
  let updated = 0;
  let removed = 0;
  for (const revision of run.revisions) {
    const action = revision.activity?.action;
    if (action === "create") added += 1;
    else if (action === "delete") {
      removed += 1;
    } else if (action === "update") {
      const delta = revision.delta ?? {};
      if (Object.keys(delta).some((field) => field !== "sort" && field !== "id" && field !== "date_updated")) updated += 1;
    }
  }
  if (!added && !updated && !removed) return null;
  const kinds = Number(added > 0) + Number(updated > 0) + Number(removed > 0);
  const title = kinds > 1 ? "Tracks Changed" : added ? "Tracks Added" : updated ? "Tracks Updated" : "Tracks Changed";
  const lines = [
    added ? `${added} added` : "",
    updated ? `${updated} updated` : "",
    removed ? `${removed} removed` : "",
  ].filter(Boolean);
  return {
    event: { type: "music_tracks_changed", title, subject, body: `**Tracks**: ${lines.join(", ")}` },
    at: run.timestamp,
  };
}
