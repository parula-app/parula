import { addon } from "../../../../../../logic/Addons/API/addon";
import { ArrayColl } from "svelte-collections";

export enum Unannotated {
  A = "a",
}

/** @addon("mail") */
export enum Color {
  Red = "red",
  Green = "green",
  Blue = "blue",
}

export class NotForAddons {
}

@addon("mail")
export class Disallowed {
  @addon("mail")
  list: string[];
  @addon("mail")
  anything: any;
  @addon("mail")
  callback: () => void;
  @addon("mail")
  map: Map<string, string>;
  @addon("mail")
  unannotatedClass: NotForAddons;
  @addon("mail")
  unannotatedEnum: Unannotated;
  @addon("mail")
  partialEnum: Color.Red | Color.Blue;
  @addon("mail")
  literal: "a" | "b";
  @addon("mail")
  unannotatedItems: ArrayColl<NotForAddons>;
  @addon("mail")
  take(fn: () => void): void {
  }
  @addon("mail")
  rest(...names: string[]): void {
  }
  @addon("mail")
  give(): object {
    return {};
  }
  @addon("mail")
  get plain(): Record<string, string> {
    return {};
  }
}
