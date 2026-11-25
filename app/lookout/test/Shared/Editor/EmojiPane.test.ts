// @vitest-environment happy-dom
import EmojiPane from "../../../Shared/Editor/EmojiPane.svelte";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, expect, test } from "vitest";

afterEach(() => {
  document.body.innerHTML = "";
});

test("A scroll event that arrives after the emoji pane was closed causes no error", () => {
  let pane = mount(EmojiPane, { target: document.body, props: { editor: null } });
  flushSync();
  let scrollEl = document.querySelector(".emoji-scroll");
  expect(scrollEl).toBeTruthy();

  let errors: Error[] = [];
  function onError(errorEvent: ErrorEvent) {
    errors.push(errorEvent.error);
  }
  window.addEventListener("error", onError);
  try {
    // The browser fires the scroll event of a scroll only with the next frame,
    // e.g. when the user closes the pane right after scrolling
    unmount(pane);
    scrollEl.dispatchEvent(new window.Event("scroll"));
  } finally {
    window.removeEventListener("error", onError);
  }
  expect(errors).toEqual([]);
});
