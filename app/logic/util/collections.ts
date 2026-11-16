import type { Observable } from "./Observable";
import { arrayRemove } from "./util";
import { ArrayColl, Collection } from "svelte-collections";

/** @returns true, if the check returns true for all items in the collection */
export function every<T>(coll: Collection<T>, check: (item: T) => boolean): boolean {
  for (let item of coll) {
    if (!check(item)) {
      return false;
    }
  }
  return true;
}

/**
 * Like SetColl, but always preserves the first matching entry, and retains the order
 * E.g. `let familyHeads = filterUnique(persons, (a, b) => a.lastname == b.lastname);`
 * Limitations: Does *not* observe the source and therefore the result does not automatically update.
 * @param compareFunc Result items will be unique in this aspect as defined by this function
 */
export function filterUnique<T>(source: Collection<T>, compareFunc: (a: T, b: T) => boolean): ArrayColl<T> {
  let unique = new ArrayColl<T>();
  if (!source) {
    return unique;
  }
  for (let newItem of source) {
    if (!unique.find(previous => compareFunc(previous, newItem))) {
      unique.add(newItem);
    }
  }
  return unique;
}

export function getNext<T>(list: ArrayColl<T>, curObject: T): T | null {
  if (!list) {
    return null;
  }
  let position = list.indexOf(curObject);
  return list.getIndex(position + 1)
    ?? list.getIndex(position - 1)
    ?? null;
}

/** Creates an `ArrayColl` for a JS array, populates it with the contents,
 * and syncs the changes to the ArrayColl back to the JS array. */
export function syncArrayColl<T>(org: Array<T>, sortBy?: (i: T) => any): ArrayColl<T> {
  let coll = new ArrayColl<T>(org);
  coll.subscribe(() => {
    org.length = 0;
    let c = sortBy ? coll.sortBy(sortBy) : coll; // TODO leaking observing SortedCollection?
    org.push(...c.contents);
  });
  return coll;
}

/**
 * Like `Collection.map()`, but maps an item again when it changes.
 * @param source Must be kept alive by the caller, which also keeps this collection alive
 */
export class ObservableMapToCollection<Source extends Observable, Result> extends ArrayColl<Result> {
  protected readonly results = new Map<Source, Result>();
  protected readonly unsubscribes = new Map<Source, () => void>();

  constructor(source: Collection<Source>, protected readonly mapFunc: (item: Source) => Result) {
    super();
    source.registerObserver(this);
    this.added(source.contents);
  }

  added(items: Source[]) {
    for (let item of items) {
      // `subscribe()` calls it right away, too
      this.unsubscribes.set(item, item.subscribe(() => {
        this.remove(this.results.get(item));
        let result = this.mapFunc(item);
        this.results.set(item, result);
        this.add(result);
      }));
    }
  }

  removed(items: Source[]) {
    for (let item of items) {
      this.unsubscribes.get(item)?.();
      this.unsubscribes.delete(item);
      this.remove(this.results.get(item));
      this.results.delete(item);
    }
  }
}

/**
 * Finds the items of a collection by a key, without going through all items.
 * Follows the items added to and removed from the collection.
 * The key of an item must not change.
 */
export class CollectionIndex<Key, Item> {
  protected readonly itemsByKey = new Map<Key, Item[]>();

  /** @param source This keeps it alive, because it holds this observer only weakly */
  constructor(protected readonly source: Collection<Item>, protected readonly keyFunc: (item: Item) => Key) {
    source.registerObserver(this);
    this.added(source.contents);
  }

  /** @returns the first item with this key */
  get(key: Key): Item | undefined {
    return this.itemsByKey.get(key)?.[0];
  }

  added(items: Item[]) {
    for (let item of items) {
      let key = this.keyFunc(item);
      let sameKey = this.itemsByKey.get(key);
      if (sameKey) {
        sameKey.push(item);
      } else {
        this.itemsByKey.set(key, [item]);
      }
    }
  }

  removed(items: Item[]) {
    for (let item of items) {
      let key = this.keyFunc(item);
      let sameKey = this.itemsByKey.get(key) ?? [];
      arrayRemove(sameKey, item);
      if (!sameKey.length) {
        this.itemsByKey.delete(key);
      }
    }
  }
}
