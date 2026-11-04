{#if multiline}
  <textarea class="lo-field lo-textarea {classes}"
    bind:value
    bind:this={inputEl}
    {placeholder}
    {rows}
    disabled={!!disabled}
    readonly={readonly}
    aria-label={label}
    title={typeof disabled == "string" ? disabled : tooltip}
    style:width
    on:input on:change on:keydown on:blur on:focus />
{:else}
  <input class="lo-field {classes}"
    {type}
    bind:value
    bind:this={inputEl}
    {placeholder}
    disabled={!!disabled}
    readonly={readonly}
    autocomplete="off"
    spellcheck={type == "text" ? undefined : false}
    aria-label={label}
    title={typeof disabled == "string" ? disabled : tooltip}
    style:width
    on:input on:change on:keydown on:blur on:focus />
{/if}

<script lang="ts">
  export let value = "";
  export let type: "text" | "email" | "password" | "url" | "search" | "tel" = "text";
  export let placeholder: string = null;
  export let label: string = null;
  export let disabled: boolean | string = false;
  export let readonly = false;
  export let tooltip: string = null;
  export let width: string = null;
  export let multiline = false;
  export let rows = 4;
  export let classes = "";
  export let inputEl: HTMLInputElement | HTMLTextAreaElement = null;
</script>

<style>
  .lo-field {
    box-sizing: border-box;
    min-width: 0;
    height: 32px;
    margin: 0;
    padding: 0 8px;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
    color: var(--lo-fg);
    font: inherit;
  }
  .lo-textarea {
    height: auto;
    padding: 6px 8px;
    resize: vertical;
  }
  .lo-field:hover:not(:disabled):not(:read-only) {
    border-color: var(--lo-border-strong);
  }
  .lo-field:focus {
    outline: none;
    border-color: var(--lo-accent);
    box-shadow: inset 0 -1px 0 var(--lo-accent);
  }
  .lo-field:disabled,
  .lo-field:read-only {
    background-color: var(--lo-pane-alt-bg);
    color: var(--lo-fg-secondary);
  }
  .lo-field::placeholder {
    color: var(--lo-fg-secondary);
  }
</style>
