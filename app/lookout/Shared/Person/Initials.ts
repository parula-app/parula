export function getInitials(name: string | null | undefined): string {
  let words = (name ?? "")
    .split(/\s+/)
    .map(word => Array.from(word)[0])
    .filter(firstChar => firstChar && /[\p{L}\p{N}]/u.test(firstChar));
  if (words.length == 0) {
    return "";
  }
  if (words.length == 1) {
    return words[0].toLocaleUpperCase();
  }
  return (words[0] + words[words.length - 1]).toLocaleUpperCase();
}
