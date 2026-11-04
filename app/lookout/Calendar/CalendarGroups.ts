import type { Calendar } from "../../logic/Calendar/Calendar";
import type { Account } from "../../logic/Abstract/Account";
import { gt } from "../../l10n/l10n";

export class CalendarGroup {
  readonly id: "mine" | "shared";
  readonly label: string;
  readonly calendars: Calendar[];

  constructor(id: "mine" | "shared", label: string, calendars: Calendar[]) {
    this.id = id;
    this.label = label;
    this.calendars = calendars;
  }
}

export class CalendarGroups {
  readonly groups: CalendarGroup[];

  constructor(calendars: Calendar[], order: string[] = []) {
    calendars = CalendarGroups.sorted(calendars, order);
    let mine = calendars.filter(calendar => !CalendarGroups.isShared(calendar));
    let shared = calendars.filter(calendar => CalendarGroups.isShared(calendar));
    this.groups = [ new CalendarGroup("mine", gt`My Calendars`, mine) ];
    if (shared.length) {
      this.groups.push(new CalendarGroup("shared", gt`Shared Calendars`, shared));
    }
  }

  static sorted(calendars: Calendar[], order: string[]): Calendar[] {
    let position = (calendar: Calendar) => {
      let index = order.indexOf(calendar.id);
      return index < 0 ? order.length + calendars.indexOf(calendar) : index;
    };
    return [...calendars].sort((a, b) => position(a) - position(b));
  }

  groupOf(calendar: Calendar): CalendarGroup | null {
    return this.groups.find(group => group.calendars.includes(calendar)) ?? null;
  }

  canMove(calendar: Calendar, offset: number): boolean {
    let calendars = this.groupOf(calendar)?.calendars ?? [];
    let target = calendars.indexOf(calendar) + offset;
    return calendars.includes(calendar) && target >= 0 && target < calendars.length;
  }

  orderAfterMove(calendar: Calendar, offset: number): string[] {
    let all = this.groups.flatMap(group => group.calendars);
    if (!this.canMove(calendar, offset)) {
      return all.map(listed => listed.id);
    }
    let neighbor = this.groupOf(calendar).calendars[this.groupOf(calendar).calendars.indexOf(calendar) + offset];
    let from = all.indexOf(calendar);
    let to = all.indexOf(neighbor);
    all[from] = neighbor;
    all[to] = calendar;
    return all.map(listed => listed.id);
  }

  static isShared(calendar: Calendar): boolean {
    let ownAccount: Account = calendar.mainAccount;
    while (ownAccount?.mainAccount) {
      ownAccount = ownAccount.mainAccount;
    }
    if (!ownAccount?.username || !calendar.username) {
      return false;
    }
    return calendar.username.toLowerCase() != ownAccount.username.toLowerCase();
  }
}
