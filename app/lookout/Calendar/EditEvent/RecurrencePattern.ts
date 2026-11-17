import type { Event } from "../../../logic/Calendar/Event";
import { Frequency, type RecurrenceRule, ruleAsLabel } from "../../../logic/Calendar/RecurrenceRule";
import { getDateTimeLocale, gt, gPlural } from "../../../l10n/l10n";

export type SeriesEnd = "none" | "count" | "date";
export type DailyMode = "interval" | "weekdays";
export type MonthlyMode = "day" | "weekday" | "last-weekday";

export class RecurrencePattern {
  frequency: Frequency = Frequency.Weekly;
  interval = 1;
  dailyMode: DailyMode = "interval";
  weekdays: number[] = [];
  monthlyMode: MonthlyMode = "day";
  end: SeriesEnd = "none";
  count = 10;
  endDate: Date;

  clone(): RecurrencePattern {
    let pattern = Object.assign(new RecurrencePattern(), this);
    pattern.weekdays = this.weekdays.slice();
    pattern.endDate = new Date(this.endDate);
    return pattern;
  }

  hasSameRuleAs(pattern: RecurrencePattern): boolean {
    return this.frequency == pattern.frequency && this.interval == pattern.interval &&
      this.dailyMode == pattern.dailyMode && this.monthlyMode == pattern.monthlyMode &&
      this.weekdays.length == pattern.weekdays.length && this.weekdays.every(weekday => pattern.weekdays.includes(weekday));
  }

  static fromEvent(event: Event): RecurrencePattern {
    let pattern = new RecurrencePattern();
    let series = event.parentEvent ?? event;
    let start = series.startTime;
    let rule = series.recurrenceRule;
    pattern.weekdays = [start.getDay()];
    pattern.endDate = new Date(start);
    pattern.endDate.setMonth(pattern.endDate.getMonth() + 3);
    if (!rule) {
      return pattern;
    }
    pattern.frequency = rule.frequency;
    pattern.interval = rule.interval;
    if (rule.weekdays?.length) {
      pattern.weekdays = rule.weekdays.slice();
    }
    if (rule.week == 5) {
      pattern.monthlyMode = "last-weekday";
    } else if (rule.week) {
      pattern.monthlyMode = "weekday";
    }
    if (rule.seriesEndTime) {
      pattern.end = "date";
      pattern.endDate = new Date(rule.seriesEndTime);
    } else if (Number.isFinite(rule.count)) {
      pattern.end = "count";
      pattern.count = rule.count;
    }
    return pattern;
  }

  static weekOfMonth(start: Date): number {
    return Math.ceil(start.getDate() / 7);
  }

  static isInLastWeek(start: Date): boolean {
    let nextWeek = new Date(start);
    nextWeek.setDate(start.getDate() + 7);
    return nextWeek.getMonth() != start.getMonth();
  }

  static weekChoices(start: Date): { mode: MonthlyMode, label: string }[] {
    let ordinals = [
      gt`first *=> as in: On the first Wednesday in July`,
      gt`second *=> as in: On the second Wednesday in July`,
      gt`third *=> as in: On the third Wednesday in July`,
      gt`fourth *=> as in: On the fourth Wednesday in July`,
    ];
    let lastLabel = gt`last *=> as in: On the last Wednesday in July`;
    let week = RecurrencePattern.weekOfMonth(start);
    let choices: { mode: MonthlyMode, label: string }[] = [];
    if (week < 5) {
      choices.push({ mode: "weekday", label: ordinals[week - 1] });
    }
    if (RecurrencePattern.isInLastWeek(start)) {
      choices.push({ mode: "last-weekday", label: lastLabel });
    }
    return choices;
  }

  static canRepeatOnWeekdays(start: Date): boolean {
    return start.getDay() != 0 && start.getDay() != 6;
  }

  week(start: Date): number {
    if (this.frequency != Frequency.Monthly && this.frequency != Frequency.Yearly) {
      return 0;
    }
    if (this.monthlyMode == "day") {
      return 0;
    }
    if (this.monthlyMode == "last-weekday" && RecurrencePattern.isInLastWeek(start)) {
      return 5;
    }
    return RecurrencePattern.weekOfMonth(start);
  }

  ruleParams(start: Date): { frequency: Frequency, interval: number, week: number, weekdays: number[] } {
    if (this.frequency == Frequency.Daily && this.dailyMode == "weekdays" &&
        RecurrencePattern.canRepeatOnWeekdays(start)) {
      return { frequency: Frequency.Weekly, interval: 1, week: 0, weekdays: [1, 2, 3, 4, 5] };
    }
    let weekdays = this.weekdays.slice();
    if (this.frequency == Frequency.Weekly && !weekdays.includes(start.getDay())) {
      weekdays.push(start.getDay());
    }
    return {
      frequency: this.frequency,
      interval: Math.max(1, Math.round(this.interval) || 1),
      week: this.week(start),
      weekdays,
    };
  }

  applyTo(event: Event) {
    let master = event.parentEvent ?? event;
    master.startEditing();
    let { frequency, interval, week, weekdays } = this.ruleParams(master.startTime);
    master.newRecurrenceRule(frequency, interval, week, weekdays);
  }

  static removeFrom(event: Event) {
    let master = event.parentEvent ?? event;
    // <copied from="../../../frontend/Calendar/EditEvent/RepeatBox.svelte">
    master.startEditing();
    master.recurrenceRule = null;
    // </copied>
  }

  get occurrences(): number {
    return Math.max(1, Math.round(this.count) || 1);
  }

  endTime(): Date {
    let endTime = new Date(this.endDate);
    endTime.setHours(23, 59, 59, 0);
    return endTime;
  }

  async applyEndTo(master: Event, skippedOccurrences = 0): Promise<void> {
    let rule = master.recurrenceRule;
    if (!rule) {
      return;
    }
    if (this.end == "none") {
      if (rule.seriesEndTime || Number.isFinite(rule.count)) {
        await master.setRecurrenceCount(Infinity);
      }
    } else if (this.end == "count") {
      let count = Math.max(1, this.occurrences - skippedOccurrences);
      if (rule.seriesEndTime || rule.count != count) {
        await master.setRecurrenceCount(count);
      }
    } else if (this.end == "date") {
      if (this.endDateDiffersFrom(rule)) {
        await master.setRecurrenceEndTime(this.endTime());
      }
    }
  }

  protected endDateDiffersFrom(rule: RecurrenceRule): boolean {
    return rule.seriesEndTime?.toDateString() != this.endDate.toDateString();
  }

  endDiffersFrom(rule: RecurrenceRule | null): boolean {
    if (!rule) {
      return false;
    }
    if (this.end == "none") {
      return !!rule.seriesEndTime || Number.isFinite(rule.count);
    } else if (this.end == "count") {
      return !!rule.seriesEndTime || rule.count != this.occurrences;
    } else {
      return this.endDateDiffersFrom(rule);
    }
  }

  summary(event: Event): string {
    let rule = (event.parentEvent ?? event).recurrenceRule;
    if (!rule) {
      return "";
    }
    const kDate: Intl.DateTimeFormatOptions = { year: "numeric", month: "numeric", day: "numeric" };
    let pattern = ruleAsLabel(rule);
    let start = (event.parentEvent ?? event).startTime.toLocaleDateString(getDateTimeLocale(), kDate);
    let range = this.end == "date"
      ? gt`effective ${start} until ${this.endDate.toLocaleDateString(getDateTimeLocale(), kDate)}`
      : this.end == "count"
        ? gt`effective ${start}, ${this.occurrences} ${gPlural(this.occurrences, { one: "time", other: "times" })}`
        : gt`effective ${start}`;
    if (event.allDay) {
      return pattern + ", " + range;
    }
    const kTime: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
    let from = event.startTime.toLocaleTimeString(getDateTimeLocale(), kTime);
    let to = event.endTime.toLocaleTimeString(getDateTimeLocale(), kTime);
    return pattern + ", " + range + ", " + gt`from ${from} to ${to}`;
  }
}
