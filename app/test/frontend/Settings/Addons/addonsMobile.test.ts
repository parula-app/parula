// @vitest-environment happy-dom
// app first, to resolve the import cycle around Addons
import "../../../../logic/app";
import AddonsList from "../../../../frontend/Settings/Addons/AddonsList.svelte";
import { flushSync, mount, unmount } from "svelte";
import { expect, test, vi } from "vitest";

vi.mock("../../../../logic/build", async importOriginal => ({
  ...await importOriginal<typeof import("../../../../logic/build")>(),
  isMobile: true,
}));

test("On mobile, the page says that addons are not available, and offers no install", () => {
  let target = document.createElement("div");
  document.body.append(target);
  let app = mount(AddonsList, { target, props: {} });
  flushSync();

  expect(target.textContent).toContain("not available on mobile");
  expect([...target.querySelectorAll("button")].some(button => button.textContent.includes("Install"))).toBe(false);
  expect(target.querySelector("input")).toBeNull();

  unmount(app);
  target.remove();
});
