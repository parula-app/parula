// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import type { EMail } from "../../../logic/Mail/EMail";
import type { Folder } from "../../../logic/Mail/Folder";
import { MessageActions } from "../../Mail/MessageActions";
import { onDragStartMail } from "../../../frontend/Mail/Message/drag";
import { selectedMessage, selectedMessages } from "../../../frontend/Mail/Selected";
import { ArrayColl } from "svelte-collections";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

/** The same object for the drag start and the drop, like the browser's */
class FakeDataTransfer {
  data = new Map<string, string>();
  effectAllowed = "";
  dropEffect = "";
  setData(type: string, value: string) {
    this.data.set(type, value);
  }
  getData(type: string): string {
    return this.data.get(type) ?? "";
  }
  setDragImage() {}
}

function dragEvent(dataTransfer: FakeDataTransfer, ctrlKey = false): DragEvent {
  return { dataTransfer, ctrlKey, metaKey: false, preventDefault() {} } as unknown as DragEvent;
}

const source = { name: "Inbox" } as Folder;
const target = { name: "Archive" } as Folder;
const a = { id: "a@example.com", folder: source } as EMail;
const b = { id: "b@example.com", folder: source } as EMail;
const c = { id: "c@example.com", folder: source } as EMail;
let moveTo: ReturnType<typeof vi.spyOn>;
let copyTo: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  moveTo = vi.spyOn(MessageActions, "moveTo").mockImplementation(async () => {});
  copyTo = vi.spyOn(MessageActions, "copyTo").mockImplementation(async () => {});
  selectedMessages.set(new ArrayColl<EMail>([a, b]));
  selectedMessage.set(a);
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("Dragging a selected message moves all selected messages", async () => {
  let dataTransfer = new FakeDataTransfer();
  onDragStartMail(dragEvent(dataTransfer), b);
  await MessageActions.dropMessages(dragEvent(dataTransfer), target);
  expect(moveTo).toHaveBeenCalledTimes(1);
  expect(moveTo.mock.calls[0][0]).toEqual(expect.arrayContaining([a, b]));
  expect(moveTo.mock.calls[0][0]).toHaveLength(2);
  expect(moveTo.mock.calls[0][1]).toBe(target);
  expect(copyTo).not.toHaveBeenCalled();
});

test("Dragging a message that is not selected moves only that message", async () => {
  let dataTransfer = new FakeDataTransfer();
  onDragStartMail(dragEvent(dataTransfer), c);
  await MessageActions.dropMessages(dragEvent(dataTransfer), target);
  expect(moveTo).toHaveBeenCalledWith([c], target);
});

test("Ctrl copies", async () => {
  let dataTransfer = new FakeDataTransfer();
  onDragStartMail(dragEvent(dataTransfer), a);
  await MessageActions.dropMessages(dragEvent(dataTransfer, true), target);
  expect(copyTo).toHaveBeenCalledTimes(1);
  expect(moveTo).not.toHaveBeenCalled();
});

test("A drop of something else than messages does nothing", async () => {
  onDragStartMail(dragEvent(new FakeDataTransfer()), a);
  await MessageActions.dropMessages(dragEvent(new FakeDataTransfer()), target);
  expect(moveTo).not.toHaveBeenCalled();
  expect(copyTo).not.toHaveBeenCalled();
});
