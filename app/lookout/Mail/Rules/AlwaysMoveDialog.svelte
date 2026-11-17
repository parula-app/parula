<RuleFolderDialog account={message.folder.account} onChosen={onChosen} on:close={onClose} />

<script lang="ts" context="module">
  import type { EMail } from "../../../logic/Mail/EMail";
  import { writable } from "svelte/store";

  export const openAlwaysMove = writable<EMail | null>(null);
</script>

<script lang="ts">
  import type { Folder } from "../../../logic/Mail/Folder";
  import { QuickRule } from "./QuickRule";
  import RuleFolderDialog from "./RuleFolderDialog.svelte";
  import { createEventDispatcher } from "svelte";

  export let message: EMail;

  const dispatch = createEventDispatcher<{ close: void }>();

  async function onChosen(folder: Folder) {
    await QuickRule.alwaysMoveFrom(message, folder);
  }

  function onClose() {
    dispatch("close");
  }
</script>
