// The popup of the button and the menu item. Runs in its own frame.
import Count from "./Count.svelte";
import { mount, unmount } from "svelte";

export default function (target: HTMLElement, context: typeof mustang.ui.context): () => void {
  let count = mount(Count, { target, props: { context } });
  return () => unmount(count);
}
