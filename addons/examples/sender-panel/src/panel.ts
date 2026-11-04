// The panel above the message. Runs in its own frame, which stays when the user reads another message.
import Sender from "./Sender.svelte";
import { mount, unmount } from "svelte";

export default function (target: HTMLElement, context: typeof mustang.ui.context): () => void {
  let sender = mount(Sender, { target, props: { context } });
  return () => unmount(sender);
}
