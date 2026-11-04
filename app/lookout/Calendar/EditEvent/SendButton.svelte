<button class="send" class:disabled={!!disabled} class:running={isRunning}
  title={disabled || label}
  aria-disabled={!!disabled}
  on:click={onSend}>
  <SendIcon size={24} strokeWidth={1.5} />
  <span>{label}</span>
</button>

<script lang="ts">
  import { showError } from "../../../frontend/Util/error";
  import { UserError } from "../../../logic/util/util";
  import SendIcon from "lucide-svelte/icons/send";

  export let label: string;
  export let disabled: string | false = false;
  export let onClick: () => Promise<void>;

  let isRunning = false;

  async function onSend() {
    if (isRunning) {
      return;
    }
    try {
      if (disabled) {
        throw new UserError(disabled);
      }
      isRunning = true;
      await onClick();
    } catch (ex) {
      showError(ex);
    } finally {
      isRunning = false;
    }
  }
</script>

<style>
  /* <copied from="../../Mail/Composer/MailComposer.svelte" .send> */
  .send {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    flex-shrink: 0;
    width: 64px;
    height: 76px;
    margin-block-start: 2px;
    border: none;
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-accent);
    color: var(--lo-accent-fg);
    font-size: var(--lo-font-size);
  }
  .send:hover {
    background-color: var(--lo-accent-hover);
  }
  .send:active {
    background-color: var(--lo-accent-pressed);
  }
  .send.disabled {
    opacity: 0.55;
  }
  /* </copied> */
  .send {
    width: 72px;
    padding: 4px;
    text-align: center;
    line-height: 1.2;
    cursor: pointer;
  }
  .send.running {
    cursor: progress;
  }
</style>
