export interface TextPart {
  text: string;
  isMatch: boolean;
}

export function highlightParts(text: string, term: string | null): TextPart[] {
  if (!text) {
    return [];
  }
  let needle = term?.trim().toLowerCase();
  if (!needle) {
    return [{ text, isMatch: false }];
  }
  let haystack = text.toLowerCase();
  let parts: TextPart[] = [];
  let start = 0;
  let found = haystack.indexOf(needle);
  while (found >= 0) {
    if (found > start) {
      parts.push({ text: text.substring(start, found), isMatch: false });
    }
    parts.push({ text: text.substring(found, found + needle.length), isMatch: true });
    start = found + needle.length;
    found = haystack.indexOf(needle, start);
  }
  if (start < text.length) {
    parts.push({ text: text.substring(start), isMatch: false });
  }
  return parts;
}
