// The Notes app. Runs in its own frame, which fills the window, while the user has the app open.
import Notes from "./Notes.svelte";
import { mount, unmount } from "svelte";

export default function (target: HTMLElement): () => void {
  let notes = mount(Notes, { target });
  return () => unmount(notes);
}
