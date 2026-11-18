import { expect } from "vitest";

/** The seconds of a JSCalendar SignedDuration, e.g. "-PT10M", "-PT600S" or "P1DT2H",
 * counting a day as 24 hours, so that tests accept every equivalent form */
export function durationSeconds(duration: string): number {
  let match = duration.match(/^([+-]?)P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  expect(match, "JSCalendar duration " + duration).toBeTruthy();
  let [, sign, weeks, days, hours, minutes, seconds] = match.map(part => part || "0");
  let total = ((Number(weeks) * 7 + Number(days)) * 24 + Number(hours)) * 3600 + Number(minutes) * 60 + Number(seconds);
  return sign == "-" ? -total : total;
}
