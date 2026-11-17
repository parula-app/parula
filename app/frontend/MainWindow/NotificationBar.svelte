{#if notification}
  <hbox class="notification-bar"
    severity={$notification.severity}
    style={notification.backgroundColor ? `background-color: ${notification.backgroundColor}; color: ${notification.textColor};` : ""}
    >
    <hbox flex />
    <div class="message value">
      {$notification.message}
    </div>
    <hbox flex />
    {#each $notification.buttons.each as button}
      <Button
        classes="action small"
        padding="4px"
        label={button.label}
        onClick={() => {
          button.onClick() // close the bar right away, don't wait for the action
            .catch(showError);
          onClose(notification);
        }}
        />
    {/each}
    <hbox class="buttons-separator" />
    {#if $notification.ex && !notification.ex.isUserError}
      <RoundButton
        icon={ErrorInfoIcon}
        classes="error-info small"
        label={$t`More info about this error`}
        onClick={() => onErrorInfo(notification.ex)}
        />
    {/if}
    <RoundButton
      icon={XIcon}
      classes="close small"
      label={$t`Remove this message`}
      onClick={() => onClose(notification)}
      />
  </hbox>
{/if}

<script lang="ts">
  import type { Notification } from "../../logic/util/Notification";
  import Button from "../Shared/Button.svelte";
  import RoundButton from "../Shared/RoundButton.svelte";
  import XIcon from "lucide-svelte/icons/x";
  import ErrorInfoIcon from "lucide-svelte/icons/bot";
  import { ArrayColl } from "svelte-collections";
  import { showError } from "../Util/error";
  import { t } from "../../l10n/l10n";

  export let notifications: ArrayColl<Notification>;

  $: notification = notifications.sortBy(n => n.severity).first;

  function onClose(notification: Notification) {
    notifications.remove(notification);
  }

  function onErrorInfo(ex: Error) {
    let debugInfo = (ex as any).debugInfo;
    alert(ex.message +
      (debugInfo ? "\n\n" + debugInfo : "") +
      (ex.stack ? "\n\n" + ex.stack : "")
    );
  }
</script>

<style>
  .notification-bar {
    align-items: center;
    color: #160C27;
    box-shadow: -1px 0px 5px 0.5px rgb(0, 0, 0, 10%);
    z-index: 3;
  }
  .notification-bar[severity="meltdown"] {
    background-color: #EE421C;
    color: white;
  }
  .notification-bar[severity="error"] {
    background-color: #FFC93E;
  }
  .notification-bar[severity="warning"] {
    background-color: #FFF160;
  }
  .notification-bar[severity="logged-out"] {
    background-color: var(--appbar-bg);
    color: var(--appbar-fg);
  }
  .notification-bar[severity="info"] {
    background-color: #47A5DA;
  }
  .message {
    margin: 2px 16px;
  }
  .buttons-separator {
    margin-inline-end: 12px;
  }
  .notification-bar :global(button) {
    margin: 4px;
    background-color: #6B6B6C;
  }
  .notification-bar :global(button.action) {
    padding: 4px 10px;
  }
  .notification-bar :global(button.error-info:not(:hover)) {
    border-color: #6B6B6C77;
    color: #6B6B6CAA;
    background-color: transparent;
  }
</style>
