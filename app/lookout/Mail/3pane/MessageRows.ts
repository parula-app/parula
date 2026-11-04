import type { MessageGroup } from "./MessageGrouping";

export type MessageRow<T> =
  { kind: "header", group: MessageGroup<T>, isCollapsed: boolean } |
  { kind: "message", group: MessageGroup<T>, message: T, position: number, thread: T[] | null, isThreadExpanded: boolean, isThreadChild: boolean };

export class MessageRows<T> {
  readonly rows: MessageRow<T>[] = [];
  readonly messages: T[] = [];
  readonly totalHeight: number;
  protected readonly tops: number[] = [];
  protected readonly rowOfMessage = new Map<T, number>();
  protected readonly headerHeight: number;
  protected readonly messageHeight: number;

  constructor(groups: MessageGroup<T>[], collapsedGroupIDs: Set<string>, showHeaders: boolean, headerHeight: number, messageHeight: number, expandedThreads = new Set<T>()) {
    this.headerHeight = headerHeight;
    this.messageHeight = messageHeight;
    let y = 0;
    for (let group of groups) {
      let isCollapsed = showHeaders && collapsedGroupIDs.has(group.id);
      if (showHeaders) {
        this.tops.push(y);
        this.rows.push({ kind: "header", group, isCollapsed });
        y += headerHeight;
      }
      if (isCollapsed) {
        continue;
      }
      for (let message of group.messages) {
        let thread = group.threads?.get(message) ?? null;
        let isThreadExpanded = !!thread && expandedThreads.has(message);
        y = this.addMessage(group, message, thread, isThreadExpanded, false, y);
        if (isThreadExpanded) {
          for (let follower of thread.slice(1)) {
            y = this.addMessage(group, follower, null, false, true, y);
          }
        }
      }
    }
    this.totalHeight = y;
  }

  protected addMessage(group: MessageGroup<T>, message: T, thread: T[] | null, isThreadExpanded: boolean, isThreadChild: boolean, y: number): number {
    this.rowOfMessage.set(message, this.rows.length);
    this.tops.push(y);
    this.rows.push({ kind: "message", group, message, position: this.messages.length, thread, isThreadExpanded, isThreadChild });
    this.messages.push(message);
    return y + this.messageHeight;
  }

  get length(): number {
    return this.rows.length;
  }

  topOf(index: number): number {
    return this.tops[index] ?? this.totalHeight;
  }

  heightOf(index: number): number {
    return this.rows[index]?.kind == "header" ? this.headerHeight : this.messageHeight;
  }

  indexAt(y: number): number {
    if (!this.rows.length) {
      return -1;
    }
    let low = 0;
    let high = this.rows.length - 1;
    while (low < high) {
      let middle = Math.ceil((low + high) / 2);
      if (this.tops[middle] <= y) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low;
  }

  indexOfMessage(message: T): number {
    return this.rowOfMessage.get(message) ?? -1;
  }

  hasMessage(message: T): boolean {
    return this.rowOfMessage.has(message);
  }

  headerIndexOf(group: MessageGroup<T>): number {
    return this.rows.findIndex(row => row.kind == "header" && row.group == group);
  }
}
