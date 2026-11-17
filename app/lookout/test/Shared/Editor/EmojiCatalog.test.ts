import { emojiCategories, searchEmojis, type EmojiCategory } from "../../../Shared/Editor/EmojiCatalog";
import { expect, test } from "vitest";

const categories: EmojiCategory[] = [
  { id: "smileys", title: "Smileys", icon: "😀", emojis: [
    { emoji: "😀", name: "grinning face", keywords: ["happy", "smile"] },
    { emoji: "😢", name: "crying face", keywords: ["sad", "tear"] },
  ] },
  { id: "food", title: "Food", icon: "🍏", emojis: [
    { emoji: "🍏", name: "green apple", keywords: ["fruit", "Apple"] },
    { emoji: "🎂", name: "birthday cake", keywords: ["party", "celebration"] },
  ] },
];

test("The catalog has the emoji categories of the frontend data", () => {
  expect(emojiCategories.length).toBeGreaterThan(5);
  expect(emojiCategories[0].emojis.length).toBeGreaterThan(10);
});

test("An empty search term finds nothing", () => {
  expect(searchEmojis("", categories)).toEqual([]);
  expect(searchEmojis("   ", categories)).toEqual([]);
  expect(searchEmojis(null, categories)).toEqual([]);
});

test("Search matches names and keywords across categories, ignoring case", () => {
  expect(searchEmojis("face", categories).map(entry => entry.emoji)).toEqual(["😀", "😢"]);
  expect(searchEmojis("APPLE", categories).map(entry => entry.emoji)).toEqual(["🍏"]);
  expect(searchEmojis("part", categories).map(entry => entry.emoji)).toEqual(["🎂"]);
});

test("Every word of the search term must match", () => {
  expect(searchEmojis("face sad", categories).map(entry => entry.emoji)).toEqual(["😢"]);
  expect(searchEmojis("face fruit", categories)).toEqual([]);
});
