// @vitest-environment happy-dom
import { onListKey } from "../../../frontend/Util/util";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";

let list: HTMLElement;
let clicks: string[];

beforeAll(() => {
  // happy-dom has no layout
  Element.prototype.scrollIntoView ??= () => {};
});

/** A list with rows "A" to "E". "C" is not a row for the selector, like a disabled entry.
 * A click selects the row, like in the real lists. */
beforeEach(() => {
  clicks = [];
  list = document.createElement("div");
  list.addEventListener("keydown", event => onListKey(event, ".row:not(.disabled)"));
  for (let name of ["A", "B", "C", "D", "E"]) {
    let row = document.createElement("button");
    row.className = name == "C" ? "row disabled" : "row";
    row.textContent = name;
    row.addEventListener("click", () => {
      clicks.push(name);
      list.querySelector(".selected")?.classList.remove("selected");
      row.classList.add("selected");
    });
    list.append(row);
  }
  document.body.append(list);
});

afterEach(() => {
  document.body.innerHTML = "";
});

function row(name: string): HTMLElement {
  return [...list.querySelectorAll<HTMLElement>(".row")].find(row => row.textContent == name);
}

function selected(): string {
  return list.querySelector(".selected")?.textContent;
}

/** @returns whether the list used the key, so that the browser doesn't scroll */
function press(key: string, target: Element = list.querySelector(".selected") ?? list, modifiers: KeyboardEventInit = {}): boolean {
  let event = new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true, ...modifiers });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

test("Arrow Down and Up select the next and previous row by clicking it, and skip rows that don't match", () => {
  row("A").click();
  expect(press("ArrowDown")).toBe(true);
  expect(selected()).toBe("B");
  press("ArrowDown");
  expect(selected()).toBe("D");
  press("ArrowDown");
  expect(selected()).toBe("E");
  // Stays at the last row, and the list doesn't scroll
  expect(press("ArrowDown")).toBe(true);
  expect(selected()).toBe("E");
  press("ArrowUp");
  press("ArrowUp");
  expect(selected()).toBe("B");
  press("ArrowUp");
  expect(selected()).toBe("A");
  expect(press("ArrowUp")).toBe(true);
  expect(selected()).toBe("A");
  expect(clicks).toEqual(["A", "B", "D", "E", "D", "B", "A"]);
});

test("Home and End select the first and last row", () => {
  row("B").click();
  expect(press("End")).toBe(true);
  expect(selected()).toBe("E");
  expect(press("Home")).toBe(true);
  expect(selected()).toBe("A");
});

test("The new row gets the focus and is scrolled into view", () => {
  let scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
  row("A").click();
  press("ArrowDown");
  expect(document.activeElement).toBe(row("B"));
  expect(scrolled.mock.contexts.at(-1)).toBe(row("B"));
  scrolled.mockRestore();
});

test("Without a selected row, Arrow Down and Home select the first row, End the last", () => {
  expect(press("ArrowUp", list)).toBe(true);
  expect(selected()).toBeUndefined();
  press("ArrowDown", list);
  expect(selected()).toBe("A");
  row("A").classList.remove("selected");
  press("End", list);
  expect(selected()).toBe("E");
  row("E").classList.remove("selected");
  press("Home", list);
  expect(selected()).toBe("A");
});

test("Keys with modifiers and other keys are left alone", () => {
  row("B").click();
  for (let key of ["ArrowDown", "ArrowUp", "Home", "End"]) {
    for (let modifier of ["shiftKey", "ctrlKey", "altKey", "metaKey"]) {
      expect(press(key, row("B"), { [modifier]: true })).toBe(false);
    }
  }
  for (let key of ["ArrowLeft", "ArrowRight", "PageDown", "Enter", "a"]) {
    expect(press(key)).toBe(false);
  }
  expect(selected()).toBe("B");
  expect(clicks).toEqual(["B"]);
});

test("Keys in a text field within the list stay in the field", () => {
  row("B").click();
  let input = document.createElement("input");
  let textarea = document.createElement("textarea");
  let editable = document.createElement("div");
  editable.contentEditable = "true";
  list.append(input, textarea, editable);
  for (let field of [input, textarea, editable]) {
    for (let key of ["ArrowDown", "ArrowUp", "Home", "End"]) {
      expect(press(key, field)).toBe(false);
    }
  }
  expect(selected()).toBe("B");
});
