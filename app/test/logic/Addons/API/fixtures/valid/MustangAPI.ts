import type { HookPoints, Mail } from "./addon-api";
import type { SetColl } from "svelte-collections";

export interface MustangAPI {
  readonly mail: Mail;
  readonly marked: SetColl<Mail>;
  before<P extends keyof HookPoints>(point: P, hook: (args: HookPoints[P]["args"]) => void): void;
}

export interface AddonObject {
  release(): void;
}
