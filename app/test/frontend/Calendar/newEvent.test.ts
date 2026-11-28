// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { Calendar } from "../../../logic/Calendar/Calendar";
import type { OWACalendar } from "../../../logic/Calendar/OWA/OWACalendar";
import { newCalendarForProtocol } from "../../../logic/Calendar/AccountsList/Calendars";
import { createNewEvent } from "../../../frontend/Calendar/event";
import { selectedCalendar } from "../../../frontend/Calendar/selected";
import { openEvent } from "../../../frontend/Calendar/open";
import { get } from "svelte/store";
import { expect, test, vi } from "vitest";

vi.mock("../../../frontend/Calendar/open", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../frontend/Calendar/open")>(),
  openEvent: vi.fn(),
}));

test("A new event in a read-only calendar goes into our own calendar", () => {
  // A colleague's calendar shared with "Can view titles and locations", which we can only see.
  // First in the list, so that also the fallback for "no calendar" has to skip it.
  let colleague = newCalendarForProtocol("calendar-owa") as OWACalendar;
  colleague.name = "Bob";
  colleague.hasLimitedDetails = true;
  let own = new Calendar();
  own.name = "Alice";
  appGlobal.calendars.addAll([colleague, own]);
  try {
    // New button while the colleague's calendar is selected, or "New event in Bob" in the calendar list
    createNewEvent(colleague, new Date(), false);
    expect(vi.mocked(openEvent).mock.lastCall[0].calendar).toBe(own);
    expect(get(selectedCalendar)).toBe(own);

    // No calendar selected
    createNewEvent(null, new Date(), false);
    expect(vi.mocked(openEvent).mock.lastCall[0].calendar).toBe(own);
  } finally {
    appGlobal.calendars.removeAll([colleague, own]);
  }
});
