import { k1DayMS } from "../../logic/util/date";

export function getWeekNumber(day: Date): number {
  let thursday = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 3 - (day.getDay() + 6) % 7);
  let firstThursday = new Date(thursday.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 3 - (firstThursday.getDay() + 6) % 7);
  return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * k1DayMS));
}
