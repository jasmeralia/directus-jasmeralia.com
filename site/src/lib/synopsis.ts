export function synopsisParagraphs(text: string | null | undefined): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}
