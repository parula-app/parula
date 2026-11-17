import { Observable, notifyChangedProperty } from "./Observable";
import { ArrayColl } from "svelte-collections";

export class Notification extends Observable {
  /** How urgent the message is for the user to handle */
  @notifyChangedProperty
  severity: NotificationSeverity;
  /** User-readable text of what we tell the user */
  @notifyChangedProperty
  message: string;
  /** If you need custom actions, for the user to react to the message.
   * (The close button will be added automatically.) */
  readonly buttons = new ArrayColl<ButtonData>();
  /** A custom background and text color.
   * Optional, rarely needed. The default is based on the `severity`.
   * Do not use this settings, unless you have very special needs.
   */
  ex: Error | undefined;
  @notifyChangedProperty
  backgroundColor: string | undefined;
  @notifyChangedProperty
  textColor: string | undefined;

  constructor(message: string, severity: NotificationSeverity, ex?: Error) {
    super();
    this.message = message;
    this.severity = severity;
    this.ex = ex;
  }
}

export const notifications = new ArrayColl<Notification>();

export enum NotificationSeverity {
  UnexpectedError = "meltdown",
  Error = "error",
  Warning = "warning",
  /** When the user has been logged out of one of the accounts.
   * Not serious, doesn't require immediate action, but does
   * require action for the app to continue to function. */
  LoggedOut = "logged-out",
  Info = "info",
}

/**
 * e.g.
  async function loginAgain() {
    alert("OK, done it");
  }
  let noti = new Notification(`${account.name} was logged out`, NotificationSeverity.LoggedOut)
  noti.buttons.add(new ButtonData("Login", loginAgain));
  notifications.add(noti);
*/
export class ButtonData {
  /** Text that should appear on the button. Should be very short, usually just 1 word. */
  label: string;
  onClick: () => Promise<void>;

  constructor(label: string, onClick: () => Promise<void>) {
    this.label = label;
    this.onClick = onClick;
  }
}
