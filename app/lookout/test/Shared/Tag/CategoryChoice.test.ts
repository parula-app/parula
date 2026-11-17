// @vitest-environment happy-dom
import { CategoryChoice } from "../../../Shared/Tag/CategoryChoice";
import { TagState } from "../../../Shared/Tag/CategorySquare.svelte";
import { availableTags, getTagByName, type Tag, type TaggableObject } from "../../../../logic/Abstract/Tag";
import { SetColl } from "svelte-collections";
import { beforeEach, expect, test } from "vitest";

// Minimal stand-in for an `EMail`
function item(...tags: Tag[]): TaggableObject {
  let taggable: TaggableObject = {
    tags: new SetColl<Tag>(tags),
    addTag: async (tag: Tag) => { taggable.tags.add(tag); },
    removeTag: async (tag: Tag) => { taggable.tags.remove(tag); },
  };
  return taggable;
}

let red: Tag;
let blue: Tag;
let green: Tag;

beforeEach(() => {
  localStorage.clear();
  availableTags.clear();
  red = getTagByName("Red category");
  blue = getTagByName("Blue category");
  green = getTagByName("Green category");
});

test("The check boxes show which categories all, some or none of the items have", () => {
  let choice = new CategoryChoice([item(red, blue), item(red)]);
  expect(choice.stateOf(red)).toBe(TagState.All);
  expect(choice.stateOf(blue)).toBe(TagState.Some);
  expect(choice.stateOf(green)).toBe(TagState.None);
  expect(choice.isChanged).toBe(false);
});

test("OK adds the checked and removes the unchecked categories, leaves the partial ones", async () => {
  let first = item(red, blue);
  let second = item(red);
  let choice = new CategoryChoice([first, second]);
  choice.toggle(red);
  choice.toggle(green);
  expect(choice.isChanged).toBe(true);
  await choice.applyToItems();
  expect(first.tags.contents).toEqual([blue, green]);
  expect(second.tags.contents).toEqual([green]);
});

test("Toggling a partial category assigns it to all items", async () => {
  let first = item(blue);
  let second = item();
  let choice = new CategoryChoice([first, second]);
  choice.toggle(blue);
  expect(choice.stateOf(blue)).toBe(TagState.All);
  await choice.applyToItems();
  expect(second.tags.contains(blue)).toBe(true);
});

test("Choose mode starts with the given categories and returns the chosen ones", () => {
  let choice = new CategoryChoice([], [blue]);
  expect(choice.chosenTags).toEqual([blue]);
  choice.toggle(red);
  choice.toggle(blue);
  expect(choice.chosenTags).toEqual([red]);
});

test("New categories need a unique name and are saved", async () => {
  let tag = await CategoryChoice.addCategory(" Project X ", "#4A8FE0");
  expect(tag.name).toBe("Project X");
  expect(tag.color).toBe("#4A8FE0");
  expect(availableTags.contains(tag)).toBe(true);
  expect(localStorage.getItem("tags")).toContain("Project X");
  await expect(CategoryChoice.addCategory("project x", "#000000")).rejects.toThrow();
  await expect(CategoryChoice.addCategory("  ", "#000000")).rejects.toThrow();
});
