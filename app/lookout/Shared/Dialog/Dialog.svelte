<dialog class="lo-dialog" bind:this={dialogEl}
  on:cancel|preventDefault={onCancel}
  on:keydown={onKeyDown}
  aria-label={title}>
  <vbox class="dialog-box" style:width style:height>
    <hbox class="title-bar">
      <hbox flex class="title">{title}</hbox>
      <button type="button" class="close" on:click={onCancel} title={$t`Close`} aria-label={$t`Close`}>
        <CloseIcon size={16} />
      </button>
    </hbox>
    <vbox class="content">
      <slot />
    </vbox>
    <hbox class="buttons">
      {#if $$slots.footer}
        <slot name="footer" />
      {:else}
        <slot name="buttons-start" />
        <hbox flex />
        {#if okLabel}
          <DialogButton label={okLabel} primary disabled={okDisabled || isRunning} onClick={submit} />
        {/if}
        <DialogButton label={cancelLabel ?? $t`Cancel`} onClick={onCancel} />
        {#if onApply}
          <DialogButton label={applyLabel ?? $t`Apply *=> Save the changes and keep the dialog open`} disabled={applyDisabled || isRunning} onClick={apply} />
        {/if}
      {/if}
    </hbox>
  </vbox>
</dialog>

<script lang="ts">
  import DialogButton from "./DialogButton.svelte";
  import { showError } from "../../../frontend/Util/error";
  import CloseIcon from "lucide-svelte/icons/x";
  import { onMount, createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let title: string;
  export let okLabel: string = null;
  export let cancelLabel: string = null;
  export let okDisabled: boolean | string = false;
  export let width = "440px";
  export let height: string = null;
  export let onOK: () => Promise<void> | void = null;
  export let onApply: () => Promise<void> | void = null;
  export let applyLabel: string = null;
  export let applyDisabled: boolean | string = false;

  const dispatch = createEventDispatcher<{ close: void }>();
  let dialogEl: HTMLDialogElement;
  let isRunning = false;

  onMount(() => {
    dialogEl.showModal();
    let firstField =
      dialogEl.querySelector<HTMLElement>(".content [autofocus]") ??
      dialogEl.querySelector<HTMLElement>(".content :is(input:not([type=radio]):not([type=checkbox]), select, textarea):not([readonly]):not(:disabled)") ??
      dialogEl.querySelector<HTMLElement>(".content :is([tabindex='0'], button:not(:disabled)):not([role='tab'])") ??
      dialogEl.querySelector<HTMLElement>(".buttons .dialog-button.primary:not(:disabled)");
    firstField?.focus();
    if (firstField instanceof HTMLInputElement) {
      firstField.select();
      firstField.scrollLeft = 0;
    }
    return () => dialogEl?.close();
  });

  export async function submit() {
    if (okDisabled || isRunning) {
      return;
    }
    isRunning = true;
    try {
      await onOK?.();
      dispatch("close");
    } catch (ex) {
      showError(ex);
    } finally {
      isRunning = false;
    }
  }

  async function apply() {
    if (applyDisabled || isRunning) {
      return;
    }
    isRunning = true;
    try {
      await onApply?.();
    } catch (ex) {
      showError(ex);
    } finally {
      isRunning = false;
    }
  }

  function onCancel() {
    dispatch("close");
  }

  function onKeyDown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key == "Enter" && okLabel && !event.defaultPrevented && !event.isComposing && isTextInput(event.target)) {
      event.preventDefault();
      submit().catch(showError);
    }
  }

  function isTextInput(target: EventTarget): boolean {
    const kNonTextTypes = [ "checkbox", "radio", "button", "submit", "reset", "file", "color", "range" ];
    return target instanceof HTMLInputElement && !kNonTextTypes.includes(target.type);
  }
</script>

<style>
  .lo-dialog {
    padding: 0;
    border: 1px solid var(--lo-border);
    border-radius: var(--lo-radius);
    background-color: var(--lo-pane-bg);
    color: var(--lo-fg);
    box-shadow: var(--lo-shadow-popup);
    font-family: var(--lo-font);
    font-size: var(--lo-font-size);
  }
  .lo-dialog::backdrop {
    background-color: rgba(0, 0, 0, 0.25);
  }
  .dialog-box {
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 64px);
  }
  .title-bar {
    flex-shrink: 0;
    align-items: center;
    gap: 4px;
    padding: 12px 12px 4px 20px;
  }
  .title {
    font-size: 18px;
    font-weight: 600;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg-secondary);
  }
  .close:hover {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
  }
  .content {
    flex: 1 1 auto;
    min-height: 0;
    padding: 8px 20px 16px 20px;
    overflow: auto;
  }
  .content :global(input:not([type="radio"]):not([type="checkbox"])) {
    box-sizing: border-box;
  }
  .buttons {
    flex-shrink: 0;
    align-items: center;
    justify-content: end;
    gap: 8px;
    padding: 12px 20px 20px 20px;
  }
</style>
