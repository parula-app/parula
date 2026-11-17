import type { Event } from "../../logic/Calendar/Event";
import { k1DayMS, k1MinuteMS } from "../../logic/util/date";

export type EventDragMode = "move" | "resize-start" | "resize-end" | "move-days";

export class EventDrag {
  readonly event: Event;
  readonly mode: EventDragMode;
  readonly pxPerMinute: number;
  readonly snapMinutes: number;
  protected readonly targetClass: string;
  protected readonly startX: number;
  protected readonly startY: number;
  protected readonly originTarget: HTMLElement | null;
  protected readonly doc: Document;
  protected target: HTMLElement | null;
  protected navigatorTarget: HTMLElement | null = null;
  protected originalHeight: string | null = null;
  deltaMinutes = 0;
  deltaDays = 0;
  hasMoved = false;

  constructor(event: Event, mode: EventDragMode, pointerEvent: PointerEvent, pxPerMinute = 1, snapMinutes = 15) {
    this.event = event;
    this.mode = mode;
    this.pxPerMinute = pxPerMinute;
    this.snapMinutes = snapMinutes;
    this.targetClass = mode == "move-days" ? "drop-day" : "day-column";
    this.startX = pointerEvent.clientX;
    this.startY = pointerEvent.clientY;
    this.doc = (pointerEvent.target as Node).ownerDocument;
    this.originTarget = this.targetAt(pointerEvent.clientX, pointerEvent.clientY, null);
    this.target = this.originTarget;
  }

  move(pointerEvent: PointerEvent) {
    const kThresholdPx = 4;
    let dx = pointerEvent.clientX - this.startX;
    let dy = pointerEvent.clientY - this.startY;
    if (!this.hasMoved && Math.abs(dx) < kThresholdPx && Math.abs(dy) < kThresholdPx) {
      return;
    }
    this.hasMoved = true;
    if (this.mode == "move" || this.mode == "move-days") {
      this.navigatorTarget = this.navigatorDayAt(pointerEvent.clientX, pointerEvent.clientY);
      if (this.navigatorTarget) {
        this.deltaMinutes = 0;
        this.deltaDays = EventDrag.daysBetween(this.event.startTime, new Date(Number(this.navigatorTarget.dataset.navDay)));
        return;
      }
    }
    if (this.mode != "move-days") {
      this.deltaMinutes = Math.round(dy / this.pxPerMinute / this.snapMinutes) * this.snapMinutes;
    }
    if (this.mode == "move" || this.mode == "move-days") {
      this.target = this.targetAt(pointerEvent.clientX, pointerEvent.clientY, this.originTarget?.dataset.group) ?? this.target;
      this.deltaDays = this.dayIndexOf(this.target) - this.dayIndexOf(this.originTarget);
    }
  }

  newTimes(): { start: Date, end: Date } {
    let start = new Date(this.event.startTime);
    let end = new Date(this.event.endTime);
    if (this.mode == "move" || this.mode == "move-days") {
      start = this.shift(start);
      end = this.shift(end);
    } else if (this.mode == "resize-start") {
      start = new Date(start.getTime() + this.deltaMinutes * k1MinuteMS);
      start = new Date(Math.min(start.getTime(), end.getTime() - this.snapMinutes * k1MinuteMS));
    } else {
      end = new Date(end.getTime() + this.deltaMinutes * k1MinuteMS);
      end = new Date(Math.max(end.getTime(), start.getTime() + this.snapMinutes * k1MinuteMS));
    }
    return { start, end };
  }

  get changesTime(): boolean {
    return this.hasMoved && (this.deltaMinutes != 0 || this.deltaDays != 0);
  }

  preview(element: HTMLElement) {
    if (this.navigatorTarget || this.mode == "move-days") {
      for (let marked of this.doc.querySelectorAll(".drop-target")) {
        marked.classList.remove("drop-target");
      }
      (this.navigatorTarget ?? this.target)?.classList.add("drop-target");
      element.style.transform = "";
      return;
    }
    if (this.mode == "move") {
      let originRect = this.originTarget?.getBoundingClientRect();
      let targetRect = this.target?.getBoundingClientRect();
      let dx = originRect && targetRect ? targetRect.left - originRect.left : 0;
      element.style.transform = `translate(${dx}px, ${this.deltaMinutes * this.pxPerMinute}px)`;
      return;
    }
    this.originalHeight ??= element.style.height;
    let { start, end } = this.newTimes();
    let minutes = (end.getTime() - start.getTime()) / k1MinuteMS;
    if (this.mode == "resize-start") {
      let originalMinutes = (this.event.endTime.getTime() - this.event.startTime.getTime()) / k1MinuteMS;
      element.style.transform = `translateY(${(originalMinutes - minutes) * this.pxPerMinute}px)`;
    }
    element.style.height = `${minutes * this.pxPerMinute - 1}px`;
  }

  endPreview(element: HTMLElement) {
    this.target?.classList.remove("drop-target");
    this.navigatorTarget?.classList.remove("drop-target");
    element.style.transform = "";
    if (this.originalHeight != null) {
      element.style.height = this.originalHeight;
    }
  }

  protected shift(time: Date): Date {
    let shifted = new Date(time.getFullYear(), time.getMonth(), time.getDate() + this.deltaDays,
      time.getHours(), time.getMinutes(), time.getSeconds());
    return new Date(shifted.getTime() + this.deltaMinutes * k1MinuteMS);
  }

  protected targetAt(x: number, y: number, group: string | null | undefined): HTMLElement | null {
    let elements = this.doc.elementsFromPoint(x, y) as HTMLElement[];
    return elements.find(element => element.classList.contains(this.targetClass) &&
      (group === null || element.dataset.group == group)) ?? null;
  }

  protected navigatorDayAt(x: number, y: number): HTMLElement | null {
    let elements = this.doc.elementsFromPoint(x, y) as HTMLElement[];
    return elements.find(element => element.dataset.navDay) ?? null;
  }

  static daysBetween(from: Date, to: Date): number {
    let fromDay = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    let toDay = new Date(to.getFullYear(), to.getMonth(), to.getDate());
    return Math.round((toDay.getTime() - fromDay.getTime()) / k1DayMS);
  }

  protected dayIndexOf(target: HTMLElement | null): number {
    return target ? Number(target.dataset.dayIndex) : 0;
  }
}
