<Dialog title={appName} width="460px" on:close>
  <hbox class="question">
    <QuestionIcon size={32} strokeWidth={1.5} />
    <span>{question}</span>
  </hbox>
  <svelte:fragment slot="footer">
    <hbox flex />
    <DialogButton label={$t`All Folders`} primary onClick={() => choose(ApplyScope.AllFolders)} />
    <DialogButton label={$t`This Folder`} onClick={() => choose(ApplyScope.ThisFolder)} />
    <DialogButton label={$t`Cancel`} onClick={() => { dispatch("close"); }} />
  </svelte:fragment>
</Dialog>

<script lang="ts" context="module">
  import { ApplyScope } from "./ViewSettings";
  import { writable } from "svelte/store";

  export const askedScope = writable<{ question: string, onChoice: (scope: ApplyScope | null) => void } | null>(null);
</script>

<script lang="ts">
  import { appName } from "../../../logic/build";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import QuestionIcon from "lucide-svelte/icons/circle-help";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let question: string;
  export let onChoice: (scope: ApplyScope) => void;

  const dispatch = createEventDispatcher<{ close: void }>();

  function choose(scope: ApplyScope) {
    onChoice(scope);
    dispatch("close");
  }
</script>

<style>
  .question {
    align-items: center;
    gap: 16px;
    padding: 8px 0;
    line-height: 1.4;
  }
  .question :global(svg) {
    flex-shrink: 0;
    color: var(--lo-accent-text);
  }
</style>
