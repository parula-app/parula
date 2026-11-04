import { getWeekNumber } from "../../Util/date";
import { expect, test } from "vitest";

test("ISO week numbers", () => {
  expect(getWeekNumber(new Date(2026, 9, 15))).toBe(42);
  expect(getWeekNumber(new Date(2026, 0, 1))).toBe(1);
  expect(getWeekNumber(new Date(2027, 0, 1))).toBe(53);
  expect(getWeekNumber(new Date(2027, 0, 4))).toBe(1);
  expect(getWeekNumber(new Date(2024, 11, 30))).toBe(1);
  expect(getWeekNumber(new Date(2026, 2, 29))).toBe(13);
});
