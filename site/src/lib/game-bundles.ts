import type { DirectusFile } from "./directus";
import type { GameSection } from "./game-sections";
import { sectionProgressPercent } from "./game-sections";
import { compareLabels } from "./list-format";

export type BundleSectionDataStatus = "unknown" | "not_applicable" | "tracked";
export type SectionDataState = "missing" | "partial" | "present" | "not_applicable";

export type BundleSourceGame = {
  id: number;
  title: string;
  slug: string;
  release_year?: number | null;
  cover_image?: DirectusFile | string | null;
};

export type GameBundleMember = {
  id: number;
  sort?: number | null;
  slug: string;
  title: string;
  release_year?: number | null;
  cover_image?: DirectusFile | string | null;
  player_status?: string | null;
  section_data_status?: BundleSectionDataStatus | null;
  section_noun?: string | null;
  current_section?: number | null;
  sections?: GameSection[] | null;
  source_game_id?: BundleSourceGame | number | null;
};

export type BundleAwareGame = {
  sections?: GameSection[] | null;
  bundle_members?: GameBundleMember[] | null;
};

export type BundleProgressSummary = {
  label: string;
  title: string;
  percent: number | null;
};

export const orderedBundleMembers = (
  members: GameBundleMember[] | null | undefined,
): GameBundleMember[] =>
  (members ?? []).slice().sort((a, b) => {
    const sortDelta = (a.sort ?? Number.MAX_SAFE_INTEGER)
      - (b.sort ?? Number.MAX_SAFE_INTEGER);
    return sortDelta || compareLabels(a.title ?? "", b.title ?? "");
  });

export const hasBundleMembers = (
  game: BundleAwareGame | null | undefined,
): boolean => (game?.bundle_members ?? []).length > 0;

export const sectionDataState = (
  game: BundleAwareGame | null | undefined,
): SectionDataState => {
  const members = game?.bundle_members ?? [];
  if (!members.length) {
    return (game?.sections ?? []).length > 0 ? "present" : "missing";
  }

  const states = members.map((member) => member.section_data_status ?? "unknown");
  if (states.every((state) => state === "unknown")) return "missing";
  if (states.some((state) => state === "unknown")) return "partial";
  if (states.every((state) => state === "not_applicable")) return "not_applicable";
  return "present";
};

export type SectionStyleAwareGame = BundleAwareGame & {
  section_style?: string | null;
};

// games.section_style defaults to "linear" in Directus so newly created games
// declare an intent even before any chapters exist -- don't surface that
// declared style anywhere (tags, filters, counts) until real section data
// backs it up, or every un-tracked game would show as "Linear".
export const effectiveSectionStyle = (
  game: SectionStyleAwareGame | null | undefined,
): string | null => {
  if (!game?.section_style) return null;
  return sectionDataState(game) === "present" ? game.section_style : null;
};

export const bundleProgressSummary = (
  game: BundleAwareGame | null | undefined,
): BundleProgressSummary | null => {
  const members = orderedBundleMembers(game?.bundle_members);
  if (!members.length) return null;

  const active = members.filter(
    (member) => member.player_status === "in_progress"
      || member.player_status === "on_hold",
  );
  if (active.length === 1) {
    const member = active[0];
    const total = member.sections?.length ?? 0;
    const current = typeof member.current_section === "number"
      ? member.current_section
      : null;
    if (current !== null && total > 0) {
      const noun = member.section_noun || "Chapter";
      const percent = sectionProgressPercent(current, total, member.player_status);
      return {
        label: `${member.title}: ${noun} ${current}/${total}`,
        title: `${member.title}: ${noun} ${current} of ${total}`,
        percent,
      };
    }
    return {
      label: `${member.title}: In Progress`,
      title: `${member.title}: In Progress`,
      percent: null,
    };
  }

  if (active.length > 1) {
    const label = `${active.length} included games in progress`;
    return { label, title: label, percent: null };
  }

  const completed = members.filter(
    (member) => member.player_status === "completed",
  ).length;
  const label = `${completed} of ${members.length} included games completed`;
  return {
    label,
    title: label,
    percent: Math.round((completed / members.length) * 100),
  };
};
