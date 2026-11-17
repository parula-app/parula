<vbox class="poll-editor" bind:this={editorEl}>
  <span class="field-label">{$t`Question`}</span>
  <TextField bind:value={poll.name} label={$t`Question`} placeholder={$t`Ask a question`} />
  <span class="field-label">{$t`Options *=> The answer options of the poll`}</span>
  {#each poll.options as option, i}
    <hbox class="option-row">
      <span class="radio-mark" aria-hidden="true"></span>
      <hbox flex class="option-field">
        <TextField bind:value={option.name} label={$t`Option ${i + 1}`} placeholder={$t`Option ${i + 1}`}
          classes="option-input" on:keydown={event => onOptionKey(event, i)} />
      </hbox>
      <button type="button" class="remove" title={$t`Remove option`} aria-label={$t`Remove option`}
        on:click={() => removeOption(i)}>
        <RemoveIcon size={14} />
      </button>
    </hbox>
  {/each}
  <hbox class="option-row">
    <span class="radio-mark" aria-hidden="true"></span>
    <hbox flex class="option-field">
      <TextField bind:value={newOption} label={$t`Add option`} placeholder={$t`Add option`}
        classes="new-option" on:input={() => catchErrors(onNewOption)} />
    </hbox>
    <span class="remove-space"></span>
  </hbox>
</vbox>

<script lang="ts">
  import type { SMLData } from "../../../logic/Mail/SML/SMLData";
  import type { TSMLSimplePoll, TSMLThing } from "../../../logic/Mail/SML/TSML";
  import TextField from "../../Shared/Form/TextField.svelte";
  import RemoveIcon from "lucide-svelte/icons/x";
  import { catchErrors } from "../../../frontend/Util/error";
  import { t } from "../../../l10n/l10n";
  import { tick } from "svelte";

  export let sml: SMLData;

  let editorEl: HTMLElement;
  let newOption = "";
  $: poll = $sml.sml as TSMLSimplePoll<TSMLThing>;

  // <copied from="../../../frontend/Mail/SML/PollEdit.svelte" addOption() onNewLine()>
  async function onNewOption() {
    if (!newOption) {
      return;
    }
    poll.options.push({
      "@type": "Answer",
      name: newOption,
      description: "",
    } as TSMLThing);
    poll = poll;
    newOption = "";
    await tick();
    let inputs = editorEl.querySelectorAll<HTMLInputElement>("input.option-input");
    inputs[inputs.length - 1]?.focus();
  }
  // </copied>

  function removeOption(index: number) {
    poll.options.splice(index, 1);
    poll = poll;
  }

  function onOptionKey(event: KeyboardEvent, index: number) {
    if (event.key != "Enter") {
      return;
    }
    event.preventDefault();
    let inputs = editorEl.querySelectorAll<HTMLInputElement>("input.option-input, input.new-option");
    inputs[index + 1]?.focus();
  }
</script>

<style>
  .poll-editor {
    gap: 4px;
  }
  .field-label {
    margin-top: 6px;
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
  }
  .option-row {
    align-items: center;
    gap: 8px;
  }
  .option-field :global(input) {
    flex: 1;
  }
  .radio-mark {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    border: 1px solid var(--lo-border-strong);
    border-radius: 50%;
  }
  .remove-space {
    flex-shrink: 0;
    width: 24px;
  }
  /* <copied to="../../Calendar/SML/Shared/PollEdit.svelte"> */
  .remove {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: var(--lo-radius-small);
    background: none;
    color: var(--lo-fg-secondary);
  }
  .remove:hover {
    background-color: var(--lo-hover-bg);
    color: var(--lo-fg);
  }
  /* </copied> */
</style>
