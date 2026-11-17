import { TagState } from "./CategorySquare.svelte";
import { availableTags, getTagByName, saveTagsList, type Tag, type TaggableObject } from "../../../logic/Abstract/Tag";
import { assert } from "../../../logic/util/util";
import { gt } from "../../../l10n/l10n";

export class CategoryChoice {
  protected readonly items: TaggableObject[];
  protected readonly initial = new Map<Tag, TagState>();
  protected readonly chosen = new Map<Tag, TagState>();

  constructor(items: TaggableObject[], preselected: Iterable<Tag> = []) {
    this.items = items;
    for (let tag of preselected) {
      this.initial.set(tag, TagState.All);
    }
    for (let tag of availableTags) {
      let count = items.filter(item => item.tags.contains(tag)).length;
      if (count) {
        this.initial.set(tag, count == items.length ? TagState.All : TagState.Some);
      }
    }
  }

  stateOf(tag: Tag): TagState {
    return this.chosen.get(tag) ?? this.initial.get(tag) ?? TagState.None;
  }

  toggle(tag: Tag) {
    this.chosen.set(tag, this.stateOf(tag) == TagState.All ? TagState.None : TagState.All);
  }

  get chosenTags(): Tag[] {
    return availableTags.contents.filter(tag => this.stateOf(tag) == TagState.All);
  }

  get isChanged(): boolean {
    return [...this.chosen].some(([tag, state]) => state != (this.initial.get(tag) ?? TagState.None));
  }

  async applyToItems() {
    for (let [tag, state] of this.chosen) {
      if (state == TagState.All) {
        await Promise.all(this.items.filter(item => !item.tags.contains(tag)).map(item => item.addTag(tag)));
      } else if (state == TagState.None) {
        await Promise.all(this.items.filter(item => item.tags.contains(tag)).map(item => item.removeTag(tag)));
      }
    }
  }

  static async addCategory(name: string, color: string): Promise<Tag> {
    name = name.trim();
    assert(name, gt`Please enter a name for the category`);
    assert(!availableTags.find(tag => tag.name.toLowerCase() == name.toLowerCase()),
      gt`A category with the name ${name} already exists`);
    let tag = getTagByName(name);
    tag.color = color;
    await saveTagsList();
    return tag;
  }
}
