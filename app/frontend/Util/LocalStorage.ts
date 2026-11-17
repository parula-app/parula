import { Observable } from "../../logic/util/Observable";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";

class ObservableLocalStorageSetting<T> extends Observable {
  readonly key: string;
  defaultValue: T = undefined;
  constructor(key: string, defaultValue?: T) {
    super();
    this.key = key;
    this.defaultValue = defaultValue;
  }
  // <copied to="../../logic/util/util.ts">
  // HACK: `getUserPreference()` in logic/ reads `localStorage` directly.
  // It assumes that this class saves the value there, under the same key, in this format.
  get value(): T {
    return JSON.parse(sanitize.nonemptystring(localStorage.getItem(this.key), null)) ?? this.defaultValue;
  }
  set value(val: T) {
    localStorage.setItem(this.key, JSON.stringify(val));
    this.notifyObservers();
  }
  // </copied>
  /** Svelte calls this when a component writes to a bound `$setting.value`.
   * The store value is this object itself, and `set value()` above already
   * saved the new value, so we only need to tell the other subscribers. */
  set(setting: this) {
    this.notifyObservers();
  }
  withDefault(defaultValue: T): T {
    this.defaultValue = defaultValue;
    return this.value;
  }
}

const settings = new Map<string, ObservableLocalStorageSetting<any>>();

export function getLocalStorage<T>(key: string, defaultValue?: T): ObservableLocalStorageSetting<T> {
  let existing = settings.get(key);
  if (existing) {
    return existing;
  }
  let setting = new ObservableLocalStorageSetting(key, defaultValue);
  settings.set(key, setting);
  return setting;
}
