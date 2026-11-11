// The account setup page of the protocol. Runs in its own frame.
import Setup from "./Setup.svelte";
import { mount, unmount } from "svelte";

export default function (target: HTMLElement): () => void {
  let setup = mount(Setup, { target });
  return () => unmount(setup);
}
