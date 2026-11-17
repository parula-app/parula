<Dialog title={$t`Date and Time`} on:close={onClose} width="400px" height="520px"
  okLabel={$t`OK`} okDisabled={!selected && $t`Select a format`} onOK={onOK}>
  <vbox flex class="formats-box">
    <span class="caption">{$t`Available formats`}</span>
    <ListView items={formats} bind:selected on:open={() => catchErrors(onDoubleClick)}
      label={$t`Available formats`} height="100%" let:item>
      <span>{item}</span>
    </ListView>
  </vbox>
</Dialog>

<script lang="ts">
  import { dateTimeFormats } from "./DateTimeFormats";
  import Dialog from "../Dialog/Dialog.svelte";
  import ListView from "../Form/ListView.svelte";
  import type { Editor } from "@tiptap/core";
  import { catchErrors } from "../../../frontend/Util/error";
  import { createEventDispatcher } from "svelte";
  import { getDateTimeLocale, t } from "../../../l10n/l10n";

  export let editor: Editor;

  const dispatch = createEventDispatcher<{ close: void }>();

  let formats = dateTimeFormats(new Date(), getDateTimeLocale());
  let selected = formats[0];

  function onOK() {
    editor.chain().focus().insertContent({ type: "text", text: selected }).run();
  }

  function onDoubleClick() {
    onOK();
    onClose();
  }

  function onClose() {
    dispatch("close");
  }
</script>

<style>
  .formats-box {
    gap: 4px;
    min-height: 0;
  }
  .caption {
    font-weight: 600;
  }
  .formats-box > :global(.lo-listview) {
    flex: 1 1 0;
    min-height: 0;
  }
</style>
