{#if nodes.length > 1}
  <vbox class="thread-pane" bind:this={paneE}>
    <Graph root={nodes[0]} {horizontal} {onSelect} />
  </vbox>
{/if}

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import type { Node } from "./Node";
  import { ThreadNode } from "./ThreadNode";
  import { newSearchEMail } from "../../../logic/Mail/Store/setStorage";
  import { openEMailMessage } from "../open";
  import Graph from "./Graph.svelte";
  import { catchErrors } from "../../Util/error";
  import { tick } from "svelte";
  import type { Collection } from "svelte-collections";

  export let message: EMail; /** in */
  /** The discussion runs to the right and replies are indented downwards (mobile),
   * instead of the other way around (desktop) */
  export let horizontal = false; /** in */

  let threadMessages: Collection<EMail> | null = null;
  let nodes: ThreadNode[] = [];
  let paneE: HTMLElement;

  $: message, catchErrors(showThread);
  $: $message, catchErrors(showGraph);

  /** The user opened another msg. When it belongs to the thread that we already show,
   * we keep its msgs and only repaint, so that we don't search the database again. */
  async function showThread() {
    if (threadMessages?.contains(message)) {
      await showGraph();
      return;
    }
    threadMessages = null;
    nodes = [];
    let opened = message;
    await message.findThread(message.folder.messages);
    if (!message.threadID) {
      return;
    }
    let search = newSearchEMail();
    search.account = message.folder.account;
    search.threadID = message.threadID;
    let found = await search.startSearch();
    if (message != opened) { // the user moved on while we were searching
      return;
    }
    threadMessages = found;
    await showGraph();
  }

  /** Also called while the thread stays open, because the user reads and stars msgs */
  async function showGraph() {
    if (!threadMessages) {
      return;
    }
    nodes = ThreadNode.buildTree(threadMessages, message);
    await tick();
    // "Clicking on a bubble selects that message ... and also focuses the graph on that msg"
    paneE?.querySelector(".node.focus")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function onSelect(node: Node) {
    catchErrors(() => openEMailMessage((node as ThreadNode).message));
  }
</script>

<style>
  .thread-pane {
    --graph-edge-color: var(--thread-line);
    --graph-bold-color: var(--thread-unread);
    --graph-node-bg: var(--thread-node-bg);
    --graph-node-text: var(--main-fg);
    --graph-focus-ring-color: var(--fg);
    overflow: auto;
  }
  .thread-pane :global(svg) {
    flex: 0 0 auto;
    align-self: flex-start;
  }
</style>
