// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { SearchEMail } from "../../../../logic/Mail/Store/SearchEMail";
import SearchCriteria from "../../../../frontend/Mail/Search/SearchCriteria.svelte";
import { flushSync, mount, unmount } from "svelte";
import { expect, test } from "vitest";

test("The attachment checkbox cycles through on, off, and back to no filter", () => {
  let search = new SearchEMail();
  let target = document.createElement("div");
  document.body.append(target);
  let pane = mount(SearchCriteria, { target, props: { search, showAccount: false } });
  flushSync();
  let checkbox = [...target.querySelectorAll(".checkbox")]
    .find(box => box.querySelector("label")?.textContent?.trim() == "Attachment") as HTMLElement;

  checkbox.click();
  flushSync();
  expect(search.hasAttachment).toBe(true);
  checkbox.click();
  flushSync();
  expect(search.hasAttachment).toBe(false);
  checkbox.click();
  flushSync();
  // `undefined` reached the server (#1424)
  expect(search.hasAttachment).toBe(null);
  unmount(pane);
});
