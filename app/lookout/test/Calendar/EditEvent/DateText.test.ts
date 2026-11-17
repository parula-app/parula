import { formatDateText, parseDateText } from "../../../Calendar/EditEvent/DateText";
import { expect, test } from "vitest";

const reference = new Date(2026, 9, 16, 9, 30);

test("Formats like Outlook's date fields: short weekday and numeric date", () => {
  expect(formatDateText(reference, "en-US")).toBe("Fri 10/16/2026");
  expect(formatDateText(null, "en-US")).toBe("");
});

test("Reads the date in the locale's order and keeps the time", () => {
  let date = parseDateText("Tue 10/20/2026", reference, "en-US");
  expect(date).toEqual(new Date(2026, 9, 20, 9, 30));
  expect(parseDateText("20.10.2026", reference, "de-DE")).toEqual(new Date(2026, 9, 20, 9, 30));
  expect(parseDateText("Di., 20.10.2026", reference, "de-DE")).toEqual(new Date(2026, 9, 20, 9, 30));
});

test("Missing year and month come from the current date, 2-digit years are this century", () => {
  expect(parseDateText("11/3", reference, "en-US")).toEqual(new Date(2026, 10, 3, 9, 30));
  expect(parseDateText("25", reference, "en-US")).toEqual(new Date(2026, 9, 25, 9, 30));
  expect(parseDateText("1/2/27", reference, "en-US")).toEqual(new Date(2027, 0, 2, 9, 30));
});

test("Rejects text that is no date", () => {
  expect(() => parseDateText("tomorrow", reference, "en-US")).toThrow();
  expect(() => parseDateText("2/30/2026", reference, "en-US")).toThrow();
  expect(() => parseDateText("13/1/2026", reference, "en-US")).toThrow();
});
