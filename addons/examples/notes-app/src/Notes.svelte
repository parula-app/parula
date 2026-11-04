<div class="notes">
  <div class="list">
    <button class="new-note" on:click={addNote} disabled={!loaded}>New note</button>
    {#each notes as note (note.id)}
      <button class="note" class:selected={note == selected} on:click={() => selected = note}>
        <span class="title">{titleOf(note)}</span>
        <span class="modified">{new Date(note.modified).toLocaleString()}</span>
      </button>
    {/each}
  </div>
  <div class="editor">
    {#if error}
      <div class="error">{error}</div>
    {/if}
    {#if selected}
      <textarea class="text" bind:value={selected.text} on:input={onInput} on:blur={savePending}
        placeholder="Write your note" />
      <div class="actions">
        <button class="delete" on:click={deleteNote}>Delete</button>
      </div>
    {:else if loaded}
      <div class="empty">No notes yet</div>
    {/if}
  </div>
</div>

<svelte:window on:blur={savePending} />

<script lang="ts">
  import { onMount } from "svelte";

  type Note = { id: string, text: string, modified: number };

  let notes: Note[] = [];
  let selected: Note | null = null;
  let loaded = false;
  let error = "";
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(async () => {
    try {
      notes = (await mustang.storage.get("notes") as Note[]) ?? [];
      selected = notes[0] ?? null;
      loaded = true;
    } catch (ex) {
      error = ex.message;
    }
  });

  function titleOf(note: Note): string {
    return note.text.split("\n")[0].trim() || "New note";
  }

  async function addNote() {
    let note = { id: Date.now().toString(36) + Math.random().toString(36).substring(2), text: "", modified: Date.now() };
    notes = [note, ...notes];
    selected = note;
    await save();
  }

  async function deleteNote() {
    notes = notes.filter(note => note != selected);
    selected = notes[0] ?? null;
    await save();
  }

  function onInput() {
    selected.modified = Date.now();
    notes = notes;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 500);
  }

  // Also when the user switches to another app, which removes this frame
  async function savePending() {
    if (saveTimer) {
      await save();
    }
  }

  async function save() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      await mustang.storage.set("notes", notes);
      error = "";
    } catch (ex) {
      error = ex.message;
    }
  }
</script>

<style>
  .notes {
    display: flex;
    height: 100vh;
    box-sizing: border-box;
    color: var(--fg);
  }
  .list {
    display: flex;
    flex-direction: column;
    width: 240px;
    padding: 12px 8px;
    gap: 2px;
    border-inline-end: 1px solid var(--border, #E1E2E5);
    overflow-y: auto;
  }
  .new-note,
  .delete {
    padding: 6px 12px;
    border: 1px solid var(--button-border, #C8C8D0);
    border-radius: var(--border-radius, 5px);
    background-color: var(--button-bg, transparent);
    color: var(--button-fg, inherit);
    font: inherit;
  }
  .new-note {
    margin-block-end: 8px;
  }
  .note {
    display: flex;
    flex-direction: column;
    align-items: start;
    padding: 6px 10px;
    border: none;
    border-radius: var(--border-radius, 5px);
    background-color: transparent;
    color: inherit;
    font: inherit;
    text-align: start;
  }
  .note:hover {
    background-color: var(--hover-bg, #EEE);
  }
  .note.selected {
    background-color: var(--selected-bg, #4A7BC4);
    color: var(--selected-fg, white);
  }
  .title {
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-weight: bold;
  }
  .modified {
    font-size: 85%;
    opacity: 0.7;
  }
  .editor {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    padding: 12px;
    gap: 8px;
  }
  .text {
    flex: 1;
    padding: 8px;
    border: 1px solid var(--border, #E1E2E5);
    border-radius: var(--border-radius, 5px);
    background-color: var(--input-bg, transparent);
    color: var(--input-fg, inherit);
    font: inherit;
    resize: none;
  }
  .actions {
    display: flex;
    justify-content: end;
  }
  .empty,
  .error {
    opacity: 0.7;
  }
</style>
