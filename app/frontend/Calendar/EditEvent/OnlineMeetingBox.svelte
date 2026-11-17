<hbox class="online-meeting" flex>
  {#if showTextField}
    <input type="url" bind:value={event.onlineMeetingURL} placeholder={$t`Paste meeting URL`} />
  {/if}
  <AccountDropDown
    accounts={meetAccounts}
    bind:selectedAccount={event.createOnlineMeetingWithAccount}
    withLabel={!showTextField}
    filterByWorkspace
    showAllOption={$t`Enter URL`}
    />
  <hbox class="buttons">
    <Button
      label={$t`Copy`}
      icon={CopyIcon}
      iconSize="16px"
      iconOnly
      plain
      disabled={!hasURL}
      onClick={onCopyMeetingURL}
      />
    <Button
      label={$t`Open`}
      icon={BrowserIcon}
      iconSize="16px"
      iconOnly
      plain
      disabled={!hasURL}
      onClick={onOpenMeetingURL}
      />
    <Button
      label={$t`Delete`}
      icon={DeleteIcon}
      iconSize="16px"
      iconOnly
      plain
      disabled={!event.isOnline}
      onClick={onRemove}
      />
  </hbox>
</hbox>

<script lang="ts">
  import type { Event } from "../../../logic/Calendar/Event";
  import { openExternalURL } from "../../../logic/util/os-integration";
  import { appGlobal } from "../../../logic/app";
  import AccountDropDown from "../../Shared/AccountDropDown.svelte";
  import Button from "../../Shared/Button.svelte";
  import CopyIcon from "lucide-svelte/icons/copy";
  import BrowserIcon from "lucide-svelte/icons/globe";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import { t } from "../../../l10n/l10n";
  import { catchErrors } from "../../Util/error";
  import { onMount } from "svelte";

  export let event: Event;

  $: hasURL = event.onlineMeetingURL?.startsWith("https://");
  /** !createOnlineMeetingWithAccount == No account = Manually enter URL */
  $: showTextField = $event.onlineMeetingURL || !$event.createOnlineMeetingWithAccount;
  $: meetAccounts = appGlobal.meetAccounts.filterObservable(acc => acc.canCreateURL);

  onMount(() => catchErrors(onLoad));
  function onLoad() {
    event.createOnlineMeetingWithAccount ??= event.calendar.meetAccount;
  }

  async function onCopyMeetingURL() {
    await navigator.clipboard.writeText(event.onlineMeetingURL);
  }

  async function onOpenMeetingURL() {
    await openExternalURL(event.onlineMeetingURL);
  }

  function onAdd() {
    event.isOnline = true;
    // TODO Create meeting on server
    // event.onlineMeetingURL = ...;
  }

  function onRemove() {
    if (event.participants.hasItems && !event.isNew && !confirm($t`Changing the meeting URL might cause some participants to miss the meeting. Are you sure?`)) {
      return;
    }
    event.isOnline = false;
    // TODO Remove meeting from server
    event.onlineMeetingURL = null;
    event.createOnlineMeetingWithAccount = null;
  }
</script>

<style>
  input {
    max-width: 20em;
  }
</style>
