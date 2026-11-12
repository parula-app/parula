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

  /* Lookout. :where(), so that the error-info rule above still wins */
  :global(:where(.lookout-window) .app-area) > .notification-bar {
    min-height: 34px;
    margin: 0 8px 6px 8px;
    padding-inline-start: 4px;
    border: 1px solid var(--lo-infobar-border);
    border-radius: var(--lo-radius);
    background-color: var(--lo-infobar-bg);
    color: var(--lo-fg);
    box-shadow: none;
  }
  :global(:where(.lookout-window) .app-area) > .notification-bar[severity="error"] {
    border-color: var(--lo-infobar-error-border);
    background-color: var(--lo-infobar-error-bg);
  }
  :global(:where(.lookout-window) .app-area) > .notification-bar[severity="meltdown"] {
    border-color: var(--lo-danger);
    background-color: var(--lo-danger);
    color: var(--lo-danger-fg);
  }
  :global(:where(.lookout-window) .app-area) > .notification-bar[severity="info"],
  :global(:where(.lookout-window) .app-area) > .notification-bar[severity="logged-out"] {
    border-color: var(--lo-selected-bg);
    background-color: var(--lo-accent-tint);
  }
  :global(:where(.lookout-window) .app-area) > .notification-bar > hbox:first-child {
    display: none;
  }
  :global(:where(.lookout-window) .app-area) > .notification-bar :global(button) {
    border-color: transparent;
    background-color: transparent;
    color: inherit;
  }
  :global(:where(.lookout-window) .app-area) > .notification-bar :global(button:hover) {
    background-color: var(--lo-hover-bg);
  }
  :global(:where(.lookout-window) .app-area) > .notification-bar :global(button.action) {
    border-color: var(--lo-input-border);
    background-color: var(--lo-pane-bg);
    color: var(--lo-fg);
  }
</style>
