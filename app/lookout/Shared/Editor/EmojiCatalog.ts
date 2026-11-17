import emojisJSON from "../../../frontend/Chat/Emoji/emojis.json";

export interface EmojiEntry {
  emoji: string;
  name: string;
  keywords: string[];
}

export interface EmojiCategory {
  id: string;
  title: string;
  icon: string;
  emojis: EmojiEntry[];
}

export const emojiCategories: EmojiCategory[] = emojisJSON;

export function searchEmojis(searchTerm: string, categories = emojiCategories): EmojiEntry[] {
  let words = searchTerm?.trim().toLowerCase().split(/\s+/).filter(word => word) ?? [];
  if (!words.length) {
    return [];
  }
  let found: EmojiEntry[] = [];
  for (let category of categories) {
    for (let entry of category.emojis) {
      if (words.every(word => emojiMatches(entry, word))) {
        found.push(entry);
      }
    }
  }
  return found;
}

function emojiMatches(entry: EmojiEntry, word: string): boolean {
  return entry.name.toLowerCase().includes(word) ||
    entry.keywords.some(keyword => keyword.toLowerCase().includes(word));
}
