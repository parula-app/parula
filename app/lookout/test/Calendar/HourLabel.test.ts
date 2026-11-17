import { HourLabel } from "../../Calendar/DayView/HourLabel";
import { expect, test } from "vitest";

test("Hour labels: 12-hour locales without minutes, 24-hour locales with", () => {
  let english = new HourLabel("en-US");
  expect(english.label(8)).toBe("8 AM");
  expect(english.label(12)).toBe("12 PM");
  expect(english.label(0)).toBe("12 AM");
  let german = new HourLabel("de");
  expect(german.label(8)).toBe("08:00");
  expect(german.label(0)).toBe("00:00");
  expect(german.label(17)).toBe("17:00");
});
