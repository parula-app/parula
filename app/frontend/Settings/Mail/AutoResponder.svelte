<vbox flex class="page">
  <PageHeader title={$t`Auto-Responder *=> Automatic replies to incoming mail, e.g. during vacation`} subtitle={$t`Automatically reply to incoming mail while you are away`} />

  {#if loading}
    <hbox class="loading">
      <Loader />
    </hbox>
  {:else if loadError && $autoResponder.needsPermission}
    <vbox class="permission">
      <hbox>{loadError.message}</hbox>
      <hbox>
        <Button label={$t`Allow access`}
          classes="primary filled"
          icon={LoginIcon}
          onClick={onAllow}
          />
      </hbox>
    </vbox>
  {:else if loadError}
    <ErrorMessageInline ex={loadError} />
  {:else}
    <HeaderGroupBox>
      <hbox slot="header">{$t`Automatic replies`}</hbox>
      <vbox class="options">
        <Checkbox toggle
          bind:checked={autoResponder.enabled}
          label={$t`Send automatic replies`} />

        {#if $autoResponder.enabled}
          <vbox class="details">
            <Checkbox
              bind:checked={autoResponder.scheduled}
              label={$t`Only send during this time range`} />
            {#if $autoResponder.scheduled}
              <grid class="time-range">
                <hbox>{$t`From *=> Start of the vacation`}</hbox>
                <hbox class="date-time">
                  <DateInput bind:date={autoResponder.startTime} />
                  <TimeInput bind:time={autoResponder.startTime} />
                </hbox>
                <hbox>{$t`Until *=> End of the vacation`}</hbox>
                <hbox class="date-time">
                  <DateInput bind:date={autoResponder.endTime} min={$autoResponder.startTime} />
                  <TimeInput bind:time={autoResponder.endTime} />
                </hbox>
              </grid>
            {/if}
          </vbox>
        {/if}
      </vbox>
    </HeaderGroupBox>

    {#if $autoResponder.enabled}
      <HeaderGroupBox>
        <hbox slot="header">
          {autoResponder.supportsExternal ? $t`Inside my organization` : $t`Automatic reply`}
        </hbox>
        <vbox class="editor-box">
          <HTMLEditorToolbar editor={internalEditor} />
          <HTMLEditor bind:html={autoResponder.internalHTML} bind:editor={internalEditor} />
        </vbox>
      </HeaderGroupBox>

      {#if autoResponder.supportsExternal}
        <HeaderGroupBox>
          <hbox slot="header">{$t`Outside my organization`}</hbox>
          <vbox class="options">
            <label class="radio">
              <input type="radio" value={AutoResponderAudience.None} bind:group={autoResponder.externalAudience} />
              {$t`Don't reply`}
            </label>
            {#if autoResponder.supportsContacts}
              <label class="radio" class:disabled={$autoResponder.maxAudience == AutoResponderAudience.None}>
                <input type="radio" value={AutoResponderAudience.Contacts} bind:group={autoResponder.externalAudience}
                  disabled={$autoResponder.maxAudience == AutoResponderAudience.None} />
                {$t`Only to my contacts`}
              </label>
            {/if}
            <label class="radio" class:disabled={$autoResponder.maxAudience != AutoResponderAudience.All}>
              <input type="radio" value={AutoResponderAudience.All} bind:group={autoResponder.externalAudience}
                disabled={$autoResponder.maxAudience != AutoResponderAudience.All} />
              {$t`Anyone outside my organization`}
            </label>
            {#if $autoResponder.maxAudience != AutoResponderAudience.All}
              <hbox class="hint font-small">{$t`Your administrator limits automatic replies outside your organization.`}</hbox>
            {/if}
          </vbox>
          {#if $autoResponder.externalAudience != AutoResponderAudience.None}
            <vbox class="editor-box external">
              <HTMLEditorToolbar editor={externalEditor} />
              <HTMLEditor bind:html={autoResponder.externalHTML} bind:editor={externalEditor} />
            </vbox>
          {/if}
        </HeaderGroupBox>
      {/if}
    {/if}

    <hbox class="buttons">
      <Button label={$t`Save`}
        classes="save"
        icon={SaveIcon}
        onClick={onSave}
        />
    </hbox>
  {/if}
</vbox>

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { AutoResponderAudience, type AutoResponder } from "../../../logic/Mail/AutoResponder";
  import PageHeader from "../Shared/PageHeader.svelte";
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import Checkbox from "../../Shared/Checkbox.svelte";
  import DateInput from "../../Calendar/EditEvent/DateInput.svelte";
  import TimeInput from "../../Calendar/EditEvent/TimeInput.svelte";
  import HTMLEditor from "../../Shared/Editor/HTMLEditor.svelte";
  import HTMLEditorToolbar from "../../Shared/Editor/HTMLEditorToolbar.svelte";
  import ErrorMessageInline from "../../Shared/ErrorMessageInline.svelte";
  import Loader from "../../Shared/Loader.svelte";
  import Button from "../../Shared/Button.svelte";
  import SaveIcon from "lucide-svelte/icons/save";
  import LoginIcon from "lucide-svelte/icons/log-in";
  import type { Editor } from "@tiptap/core";
  import { t } from "../../../l10n/l10n";

  export let account: MailAccount;

  let autoResponder: AutoResponder;
  let loading = true;
  let loadError: Error | null = null;
  let internalEditor: Editor;
  let externalEditor: Editor;

  $: load(account);
  async function load(forAccount: MailAccount) {
    autoResponder = forAccount.autoResponder;
    loading = true;
    loadError = null;
    try {
      await autoResponder.load();
    } catch (ex) {
      if (forAccount == account) {
        loadError = ex;
      }
    } finally {
      if (forAccount == account) {
        loading = false;
      }
    }
  }

  async function onSave() {
    await autoResponder.save();
  }

  async function onAllow() {
    await autoResponder.grantPermission();
    await load(account);
  }
</script>

<style>
  .page {
    max-width: 40em;
  }
  .loading {
    margin-block-start: 32px;
  }
  .permission {
    margin-block-start: 32px;
    gap: 16px;
  }
  .options {
    gap: 8px;
  }
  .radio {
    align-items: center;
    gap: 8px;
  }
  .radio.disabled {
    opacity: 50%;
  }
  .details {
    margin-block-start: 8px;
    margin-inline-start: 32px;
    gap: 16px;
  }
  .time-range {
    grid-template-columns: max-content auto;
    align-items: center;
    gap: 8px 24px;
    margin-inline-start: 28px;
  }
  .date-time {
    gap: 8px;
  }
  .hint {
    opacity: 70%;
  }
  .editor-box {
    border: 1px solid var(--border);
    border-radius: 5px;
  }
  .editor-box.external {
    margin-block-start: 16px;
  }
  .editor-box :global(.html-editor) {
    min-height: 8em;
    padding: 8px;
  }
  .buttons {
    justify-content: end;
    margin-block-start: 32px;
  }
</style>
