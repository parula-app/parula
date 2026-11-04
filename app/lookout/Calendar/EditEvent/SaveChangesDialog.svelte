<Dialog {title} okLabel={saveLabel} okDisabled={saveDisabled} onOK={onSave} width="520px" on:close>
  <p class="question">{question}</p>
  <svelte:fragment slot="buttons-start">
    <DialogButton label={discardLabel} onClick={onDiscard} />
  </svelte:fragment>
</Dialog>

<script lang="ts">
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";

  export let title: string;
  export let question: string;
  export let saveLabel: string;
  export let discardLabel: string;
  export let saveDisabled: string | false = false;
  export let onSave: () => Promise<void>;
  export let onDiscard: () => void;
</script>

<style>
  .question {
    margin: 0;
  }
</style>
