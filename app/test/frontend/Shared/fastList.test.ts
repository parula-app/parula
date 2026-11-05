// @vitest-environment happy-dom
import FastListHarness from "./FastListHarness.svelte";
import { sleep } from "../../../logic/util/util";
import { ArrayColl } from "svelte-collections";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeAll, beforeEach, expect, test } from "vitest";

/** The heights in px that a browser would lay out.
 * happy-dom has no layout, so `offsetHeight` and `clientHeight` return these. */
let layout = { list: 200, header: 22, row: 20 };
/** The `ResizeObserver` callbacks of the mounted list */
let resizeCallbacks: (() => void)[] = [];

beforeAll(() => {
  (globalThis as any).ResizeObserver = class {
    constructor(callback: () => void) {
      resizeCallbacks.push(callback);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    get() { return heightOf(this); },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    get() { return this.classList.contains("fast-list") ? layout.list : 0; },
  });
});

function heightOf(element: HTMLElement): number {
  if (element.classList.contains("fast-list")) {
    return layout.list;
  }
  if (element.classList.contains("header-cell")) {
    return layout.header;
  }
  if (element.classList.contains("cell")) {
    return layout.row;
  }
  // The `display: contents` wrappers in `FastList` have no box
  return 0;
}

let app: any;
let target: HTMLElement;

beforeEach(() => {
  layout = { list: 200, header: 22, row: 20 };
  resizeCallbacks = [];
});

afterEach(() => {
  if (app) {
    unmount(app);
    app = null;
  }
  target?.remove();
});

function newItems(count: number): ArrayColl<string> {
  let items = new ArrayColl<string>();
  for (let i = 0; i < count; i++) {
    items.add("Item " + i);
  }
  return items;
}

async function mountList(items: ArrayColl<string>, withHeader: boolean): Promise<HTMLElement> {
  target = document.createElement("div");
  document.body.append(target);
  app = mount(FastListHarness, { target, props: { items, withHeader } });
  await settle();
  return target.querySelector(".fast-list");
}

/** Lets the throttled size and scroll handlers of `FastList` run */
async function settle() {
  flushSync();
  await sleep(0.04);
  flushSync();
}

/** A browser fires `scroll` when `scrollTop` changes. happy-dom doesn't. */
async function scrollTo(list: HTMLElement, scrollTop: number) {
  list.scrollTop = scrollTop;
  list.dispatchEvent(new Event("scroll"));
  await settle();
}

async function press(list: HTMLElement, key: string) {
  let scrollTop = list.scrollTop;
  list.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  if (list.scrollTop != scrollTop) {
    list.dispatchEvent(new Event("scroll"));
  }
  await settle();
}

/** The pane changed its size, or a row got its height */
async function resized() {
  for (let callback of resizeCallbacks) {
    callback();
  }
  await settle();
}

function renderedItems(list: HTMLElement): string[] {
  return [...list.querySelectorAll(".row .cell")].map(cell => cell.textContent);
}

/** How many rows fit into the list, when it's scrolled to the top */
function visibleRowCount(withHeader: boolean): number {
  return Math.ceil((layout.list - (withHeader ? layout.header : 0)) / layout.row);
}

function expectSelectedRowFullyVisible(list: HTMLElement, items: ArrayColl<string>, withHeader: boolean, afterKey: string) {
  let selected = list.querySelector(".row.selected .cell");
  expect(selected, `selected row is rendered after ${afterKey}`).toBeTruthy();
  let index = items.contents.indexOf(selected.textContent);
  // The rows start below the header
  let rowTop = (withHeader ? layout.header : 0) + index * layout.row;
  expect(rowTop, `top of row ${index} after ${afterKey}`).toBeGreaterThanOrEqual(list.scrollTop);
  expect(rowTop + layout.row, `bottom of row ${index} after ${afterKey}`).toBeLessThanOrEqual(list.scrollTop + layout.list);
}

for (let withHeader of [false, true]) {
  let headerText = withHeader ? "with a header" : "without a header";

  test(`The selected row is fully visible after Arrow, Page, Home and End keys, ${headerText}`, async () => {
    let items = newItems(50);
    let list = await mountList(items, withHeader);
    let keys = ["End", ...Array(12).fill("ArrowUp"), "PageUp", "PageUp", "ArrowDown", "PageDown",
      "Home", ...Array(12).fill("ArrowDown"), "PageDown", "End", "PageUp", "ArrowUp"];
    for (let key of keys) {
      await press(list, key);
      expectSelectedRowFullyVisible(list, items, withHeader, key);
    }
  });

  test(`The selected row stays fully visible after the pane got smaller, ${headerText}`, async () => {
    let items = newItems(50);
    let list = await mountList(items, withHeader);
    await press(list, "End");
    layout.list = 90;
    await resized();
    for (let key of [...Array(8).fill("ArrowUp"), "PageUp", "PageDown", "Home", "ArrowDown", "End"]) {
      await press(list, key);
      expectSelectedRowFullyVisible(list, items, withHeader, key);
    }
  });

  test(`A list with 1 item keeps it visible on every key, ${headerText}`, async () => {
    let items = newItems(1);
    let list = await mountList(items, withHeader);
    expect(renderedItems(list)).toEqual(["Item 0"]);
    for (let key of ["ArrowDown", "ArrowUp", "End", "Home", "PageDown", "PageUp"]) {
      await press(list, key);
      expectSelectedRowFullyVisible(list, items, withHeader, key);
    }
  });

  test(`An empty list shows no rows, and the keys do nothing, ${headerText}`, async () => {
    let items = new ArrayColl<string>();
    let list = await mountList(items, withHeader);
    for (let key of ["ArrowDown", "ArrowUp", "End", "Home", "PageDown", "PageUp"]) {
      await press(list, key);
    }
    expect(renderedItems(list)).toEqual([]);
    expect(list.querySelector(".row.selected")).toBeNull();
  });

  test(`Items that arrive after the list is shown appear, also after the list was emptied, ${headerText}`, async () => {
    let items = new ArrayColl<string>();
    let list = await mountList(items, withHeader);
    expect(renderedItems(list)).toEqual([]);

    items.addAll(newItems(30).contents);
    await settle();
    expect(renderedItems(list)).toContain("Item 0");
    expect(renderedItems(list).length).toBeGreaterThanOrEqual(visibleRowCount(withHeader));

    await scrollTo(list, 200);
    items.clear();
    await settle();
    expect(renderedItems(list)).toEqual([]);

    // A list with fewer items than fit into the pane is at the top again
    await scrollTo(list, 0);
    items.addAll(newItems(5).contents);
    await settle();
    expect(renderedItems(list)).toEqual(["Item 0", "Item 1", "Item 2", "Item 3", "Item 4"]);
  });

  test(`A list whose rows measure no height (e.g. \`display: contents\`) shows its rows when scrolled back to the top, ${headerText}`, async () => {
    layout.row = 0;
    let items = newItems(30);
    let list = await mountList(items, withHeader);
    expect(renderedItems(list)).toContain("Item 0");
    for (let scrollTop of [300, 10, 0, 22, 0]) {
      await scrollTo(list, scrollTop);
      expect(renderedItems(list), `rows at scrollTop ${scrollTop}`).toContain("Item 0");
    }
  });

  test(`Rows that have no height yet when they arrive are measured once they have it, ${headerText}`, async () => {
    layout.row = 0;
    let items = newItems(50);
    let list = await mountList(items, withHeader);
    expect(renderedItems(list)).toContain("Item 0");

    layout.row = 20;
    await resized();
    expect(renderedItems(list).length).toBeGreaterThanOrEqual(visibleRowCount(withHeader));
    for (let key of ["End", ...Array(12).fill("ArrowUp"), "Home"]) {
      await press(list, key);
      expectSelectedRowFullyVisible(list, items, withHeader, key);
    }
  });
}
