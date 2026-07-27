export type GameSection = {
  id?: number;
  number: number;
  title: string;
};

export const sectionNoun = (raw: string | null | undefined): string =>
  raw || "Chapter";

export const pluralizeNoun = (noun: string): string =>
  /[^aeiou]y$/i.test(noun) ? `${noun.slice(0, -1)}ies` : `${noun}s`;

export const orderedSections = (
  sections: GameSection[] | null | undefined,
): GameSection[] =>
  (sections ?? []).slice().sort((a, b) => a.number - b.number);
