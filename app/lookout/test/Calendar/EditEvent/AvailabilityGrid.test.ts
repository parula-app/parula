import { Timeline } from "../../../Calendar/EditEvent/AvailabilityGrid";
import { expect, test } from "vitest";

const kDay = new Date(2026, 9, 15, 14, 30);

test("The timeline covers the whole day", () => {
  let timeline = new Timeline(kDay, 100);
  expect(timeline.day).toEqual(new Date(2026, 9, 15));
  expect(timeline.width).toBe(2400);
  expect(timeline.hours().length).toBe(24);
  expect(timeline.hours()[9]).toEqual(new Date(2026, 9, 15, 9));
});

test("Position of a time", () => {
  let timeline = new Timeline(kDay, 100);
  expect(timeline.x(new Date(2026, 9, 15, 0, 0))).toBe(0);
  expect(timeline.x(new Date(2026, 9, 15, 9, 30))).toBe(950);
  expect(timeline.x(new Date(2026, 9, 14, 23, 0))).toBe(0);
  expect(timeline.x(new Date(2026, 9, 16, 1, 0))).toBe(2400);
});

test("Span of an interval, cut at the day borders", () => {
  let timeline = new Timeline(kDay, 100);
  expect(timeline.span(new Date(2026, 9, 15, 9), new Date(2026, 9, 15, 10, 30))).toEqual({ left: 900, width: 150 });
  expect(timeline.span(new Date(2026, 9, 14, 22), new Date(2026, 9, 15, 2))).toEqual({ left: 0, width: 200 });
  expect(timeline.span(new Date(2026, 9, 15, 23), new Date(2026, 9, 16, 2))).toEqual({ left: 2300, width: 100 });
  expect(timeline.span(new Date(2026, 9, 14, 9), new Date(2026, 9, 14, 10))).toBe(null);
  expect(timeline.span(new Date(2026, 9, 16, 9), new Date(2026, 9, 16, 10))).toBe(null);
});

test("Time at a position, rounded to the half hour", () => {
  let timeline = new Timeline(kDay, 100);
  expect(timeline.timeAt(950)).toEqual(new Date(2026, 9, 15, 9, 30));
  expect(timeline.timeAt(960)).toEqual(new Date(2026, 9, 15, 9, 30));
  expect(timeline.timeAt(980)).toEqual(new Date(2026, 9, 15, 10, 0));
  expect(timeline.timeAt(960, 15)).toEqual(new Date(2026, 9, 15, 9, 30));
  expect(timeline.timeAt(-50)).toEqual(new Date(2026, 9, 15, 0, 0));
  expect(timeline.timeAt(5000)).toEqual(new Date(2026, 9, 16, 0, 0));
});

test("Slot under a position", () => {
  let timeline = new Timeline(kDay, 100);
  expect(timeline.slotAt(980)).toEqual(new Date(2026, 9, 15, 9, 30));
  expect(timeline.slotAt(1000)).toEqual(new Date(2026, 9, 15, 10, 0));
  expect(timeline.slotAt(2399)).toEqual(new Date(2026, 9, 15, 23, 30));
  expect(timeline.slotAt(2400)).toEqual(new Date(2026, 9, 15, 23, 30));
});

test("A timeline over several days continues into the next days", () => {
  let timeline = new Timeline(kDay, 100, 3);
  expect(timeline.width).toBe(7200);
  expect(timeline.days()).toEqual([new Date(2026, 9, 15), new Date(2026, 9, 16), new Date(2026, 9, 17)]);
  expect(timeline.hours().length).toBe(72);
  expect(timeline.hours()[25]).toEqual(new Date(2026, 9, 16, 1));
  expect(timeline.dayEnd).toEqual(new Date(2026, 9, 18));
  expect(timeline.x(new Date(2026, 9, 16, 9, 30))).toBe(3350);
  expect(timeline.span(new Date(2026, 9, 15, 23), new Date(2026, 9, 16, 2))).toEqual({ left: 2300, width: 300 });
  expect(timeline.timeAt(3350)).toEqual(new Date(2026, 9, 16, 9, 30));
  expect(timeline.slotAt(7199)).toEqual(new Date(2026, 9, 17, 23, 30));
});

test("Days with a daylight saving time change keep 24 hours each on the timeline", () => {
  let timeline = new Timeline(new Date(2026, 9, 24), 100, 3);
  expect(timeline.x(new Date(2026, 9, 26, 9))).toBe((48 + 9) * 100);
  expect(timeline.timeAt((48 + 9) * 100)).toEqual(new Date(2026, 9, 26, 9));
});
