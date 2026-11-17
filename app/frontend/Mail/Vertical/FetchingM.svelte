{#if checkingMail || loggingIn}
  <hbox class="mail-check">
    {#if checkingMail}
      <FetchingIcon size="32xp" />
    {:else if loggingIn}
      <LoginIcon size="32xp" />
    {/if}
  </hbox>
{/if}

<script lang="ts">
  import type { Folder } from "../../../logic/Mail/Folder";
  import FetchingIcon from "lucide-svelte/icons/arrow-big-down-dash";
  import LoginIcon from "lucide-svelte/icons/key-round";

  export let folder: Folder;

  let checkingMail = false;
  let loggingIn = false;
  export async function onCheckMail() {
    try {
      loggingIn = true;
      let account = folder.account;
      if (!account.isLoggedIn) {
        await account.loginAndStartup(true);
      }
      loggingIn = false;
      checkingMail = true;
      await folder.getNewMessages();
    } finally {
      loggingIn = false;
      checkingMail = false;
    }
  }
</script>

<style>
  .mail-check {
    height: 32px;
  }
</style>
