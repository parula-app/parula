import { addon, addonHook } from "../../../../../../logic/Addons/API/addon";
import { Observable, notifyChangedProperty } from "../../../../../../logic/util/Observable";
import type { HTMLString } from "../../../../../../logic/util/util";
import { ArrayColl, MapColl, SetColl, type Collection } from "svelte-collections";

/** @addon("mail.all") */
export enum Color {
  Red = "red",
  Blue = "blue",
}

/** @addon("mail") */
export enum Level {
  Low = 1,
  High = 5,
}

export enum NotForAddons {
  A = "a",
}

/** Has annotated members, but no class annotation */
export class Item extends Observable {
  @addon("message", "mail.compose")
  @notifyChangedProperty
  title = "";
  @addon(["mail.all", "chat.all"])
  owner: string;
  secret = "secret";
  get hidden(): string {
    return "hidden";
  }
}

@addon("mail")
export class Mail extends Item {
  @addon("mail")
  readonly to = new ArrayColl<Person>();
  /** Unexposed items are left out */
  @addon("mail")
  readonly people = new MapColl<string, Person | Unexposed>();
  @addon("mail.all")
  tags: SetColl<Person> | null = null;
  @addon("mail.all")
  thread: Collection<Mail>;
  @addon("mail")
  color: Color = Color.Red;
  @addon("mail")
  level?: Level;
  @addon("mail")
  sent: Date;
  @addon("mail")
  data: Uint8Array | null = null;
  @addon("mail")
  from: Person;
  @addon("mail")
  get size(): number {
    return 1;
  }
  @addon("message", "mail.compose")
  get body(): string {
    return this._body;
  }
  set body(value: string) {
    this._body = value;
  }
  _body = "";
  @addon("message", "mail.compose")
  signature: HTMLString = "";
  @addon("message", "mail.compose")
  get preview(): string {
    return this._preview;
  }
  set preview(value: HTMLString) {
    this._preview = value;
  }
  _preview = "";
  @addon("mail.compose")
  async insert(html: HTMLString, at?: number): Promise<void> {
  }
  @addon("mail")
  async save(force: boolean, count?: number): Promise<boolean> {
    return force;
  }
  @addon("mail")
  find(name: string): Person | null {
    return null;
  }
  async notAnnotated() {
  }
}

@addon("message")
export class Person extends Observable {
  @addon("message")
  name: string;
}

export class Unexposed extends Observable {
  name: string;
}

export class Actions {
  mail: Mail;
  @addonHook("test.send", "mail.compose", (actions: Actions) => ({ mail: actions.mail }))
  async send(onSending?: () => void): Promise<void> {
  }
  @addonHook("test.save", "mail")
  async save(mail: Mail, count: number): Promise<boolean> {
    return true;
  }
}
