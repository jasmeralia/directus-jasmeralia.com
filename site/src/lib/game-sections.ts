export type GameSection = {
  id?: number;
  number: number;
  title: string;
  bundle_member_id?: number | { id?: number } | null;
};

export const sectionNoun = (raw: string | null | undefined): string =>
  raw || "Chapter";

export const pluralizeNoun = (noun: string): string =>
  /[^aeiou]y$/i.test(noun) ? `${noun.slice(0, -1)}ies` : `${noun}s`;

export const orderedSections = (
  sections: GameSection[] | null | undefined,
): GameSection[] =>
  (sections ?? []).slice().sort((a, b) => a.number - b.number);

export const directGameSections = (
  sections: GameSection[] | null | undefined,
): GameSection[] =>
  orderedSections(
    (sections ?? []).filter((section) => section.bundle_member_id == null),
  );
