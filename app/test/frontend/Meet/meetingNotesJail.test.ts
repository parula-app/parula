// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import MeetingNotes from "../../../frontend/Meet/ParticipantsBar/MeetingNotes.svelte";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeAll, expect, test } from "vitest";

beforeAll(() => {
  appGlobal.remoteApp = {} as any;
});

let notes: Record<string, any> | null = null;

afterEach(() => {
  if (notes) {
    unmount(notes);
    notes = null;
  }
  document.body.innerHTML = "";
});

test("The meeting description, from the organizer, does not render in our document", () => {
  let target = document.createElement("div");
  document.body.append(target);
  let meeting = { event: { title: "Planning", descriptionHTML: `<p>Agenda <img src="x"></p>` } };
  notes = mount(MeetingNotes, { target, props: { meeting: meeting as any } });
  flushSync();

  expect(document.body.textContent).toContain("Planning");
  expect(document.body.textContent).not.toContain("Agenda");
  expect(document.querySelector("img")).toBe(null);
  expect(document.querySelector("webview, iframe")).not.toBe(null);
});
