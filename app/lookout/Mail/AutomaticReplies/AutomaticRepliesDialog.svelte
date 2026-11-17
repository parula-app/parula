<Dialog title={$t`Automatic Replies - ${account.emailAddress || account.name}`} on:close width="640px" height="640px"
  okLabel={$t`OK`} okDisabled={isLoading || !!loadError} onOK={onOK}>
  {#if isLoading}
    <hbox class="lo-secondary">{$t`Loading…`}</hbox>
  {:else if loadError}
    <vbox class="load-error">
      <hbox class="error-message">
        <WarningIcon size={16} />
        <span>{loadError.message}</span>
      </hbox>
      {#if loadError instanceof PermissionMissing}
        <hbox>
          <DialogButton label={$t`Allow access`} primary onClick={onAllow} />
        </hbox>
      {/if}
    </vbox>
  {:else}
    <vbox class="state">
      <Radio name="state" value={false} bind:group={autoResponder.isOn} label={$t`Do not send automatic replies`} />
      <Radio name="state" value={true} bind:group={autoResponder.isOn} label={$t`Send automatic replies`} />
      <vbox class="time-range">
        <Checkbox bind:checked={autoResponder.scheduled} disabled={!$autoResponder.isOn}
          label={$t`Only send during this time range:`} />
        <FormGrid classes="times">
          <span class="lo-form-label" class:disabled={!isTimeRange}>{$t`Start time:`}</span>
          <hbox class="date-time">
            <DateField required date={$autoResponder.startTime} label={$t`Start date`} disabled={!isTimeRange}
              on:change={ev => setStartTime(autoResponder, ev.detail)} />
            <TimeInput time={$autoResponder.startTime} options={startTimeOptions($autoResponder.startTime)} label={$t`Start time`} disabled={!isTimeRange}
              on:change={ev => setStartTime(autoResponder, ev.detail)} />
          </hbox>
          <span class="lo-form-label" class:disabled={!isTimeRange}>{$t`End time:`}</span>
          <hbox class="date-time">
            <DateField required date={$autoResponder.endTime} min={$autoResponder.startTime} label={$t`End date`} disabled={!isTimeRange}
              on:change={ev => { autoResponder.endTime = ev.detail; }} />
            <TimeInput time={$autoResponder.endTime} options={startTimeOptions($autoResponder.endTime)} label={$t`End time`} disabled={!isTimeRange}
              on:change={ev => { autoResponder.endTime = ev.detail; }} />
          </hbox>
        </FormGrid>
      </vbox>
    </vbox>
    <hbox class="caption" class:disabled={!$autoResponder.isOn}>
      {autoResponder.supportsExternal
        ? $t`Automatically reply with the following messages:`
        : $t`Automatically reply with the following message:`}
    </hbox>
    {#if autoResponder.supportsExternal}
      <DialogTabs bind:selected={tab} tabs={[
        { id: "inside", label: $t`Inside My Organization` },
        { id: "outside", label: $autoResponder.externalAudience == AutoResponderAudience.None
          ? $t`Outside My Organization`
          : $t`Outside My Organization (On)` },
      ]} />
    {/if}
    {#if tab == "outside"}
      <vbox class="audience">
        <Checkbox checked={$autoResponder.externalAudience != AutoResponderAudience.None} disabled={!$autoResponder.isOn}
          label={$t`Auto-reply to people outside my organization`}
          on:change={ev => { autoResponder.externalAudience = ev.detail ? AutoResponderAudience.All : AutoResponderAudience.None; }} />
        {#if autoResponder.supportsContacts}
          <hbox class="audience-choice">
            <Radio name="audience" value={AutoResponderAudience.Contacts} group={shownAudience} disabled={!isEditable}
              label={$t`My Contacts only`}
              on:change={ev => { autoResponder.externalAudience = ev.detail; }} />
            <Radio name="audience" value={AutoResponderAudience.All} group={shownAudience} disabled={!isEditable}
              label={$t`Anyone outside my organization`}
              on:change={ev => { autoResponder.externalAudience = ev.detail; }} />
          </hbox>
        {/if}
      </vbox>
    {/if}
    <vbox flex class="message" class:disabled={!isEditable}>
      <EditorToolbar {editor} disabled={!isEditable} />
      <vbox flex class="editor">
        {#if tab == "outside"}
          <HTMLEditor bind:html={autoResponder.externalHTML} bind:editor />
        {:else}
          <HTMLEditor bind:html={autoResponder.internalHTML} bind:editor />
        {/if}
      </vbox>
    </vbox>
  {/if}
</Dialog>

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { AutoResponderAudience } from "../../../logic/Mail/AutoResponder";
  import { PermissionMissing } from "../../../logic/Abstract/Account";
  import { setStartTime } from "./AutomaticReplies";
  import { startTimeOptions } from "../../Calendar/EditEvent/TimeOptions";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import DialogTabs from "../../Shared/Dialog/DialogTabs.svelte";
  import Radio from "../../Shared/Form/Radio.svelte";
  import Checkbox from "../../Shared/Form/Checkbox.svelte";
  import FormGrid from "../../Shared/Form/FormGrid.svelte";
  import DateField from "../../Shared/Form/DateField.svelte";
  import TimeInput from "../../Calendar/EditEvent/TimeInput.svelte";
  import EditorToolbar from "../../Shared/Editor/EditorToolbar.svelte";
  import HTMLEditor from "../../../frontend/Shared/Editor/HTMLEditor.svelte";
  import WarningIcon from "lucide-svelte/icons/triangle-alert";
  import type { Editor } from "@tiptap/core";
  import { onMount } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let account: MailAccount;

  /** What the user edits. OK saves it, Cancel drops it. */
  let autoResponder = account.newAutoResponder();
  let isLoading = true;
  let loadError: Error = null;
  let tab = "inside";
  let editor: Editor;

  $: isTimeRange = $autoResponder.isOn && $autoResponder.scheduled;
  $: isEditable = $autoResponder.isOn && (tab == "inside" || $autoResponder.externalAudience != AutoResponderAudience.None);
  // Like Outlook, one of the 2 is checked, even while there are no replies outside
  $: shownAudience = $autoResponder.externalAudience == AutoResponderAudience.Contacts ? AutoResponderAudience.Contacts : AutoResponderAudience.All;
  $: if (editor && editor.isEditable != isEditable) {
    editor.setEditable(isEditable, false);
  }

  onMount(() => {
    load()
      .catch(console.error);
  });
  async function load() {
    isLoading = true;
    loadError = null;
    try {
      await autoResponder.load();
    } catch (ex) {
      loadError = ex;
    } finally {
      isLoading = false;
    }
  }

  async function onAllow() {
    await account.upgradeScopes();
    await load();
  }

  async function onOK() {
    await autoResponder.save();
    await account.autoResponder.load(); // for the info bar and File > Info
  }
</script>

<style>
  .load-error {
    gap: 16px;
  }
  .error-message {
    align-items: center;
    gap: 8px;
  }
  .error-message :global(svg) {
    flex-shrink: 0;
    color: var(--lo-warning);
  }
  .state {
    flex-shrink: 0;
    gap: 4px;
  }
  .time-range {
    gap: 8px;
    margin-inline-start: 24px;
  }
  .state :global(.times) {
    margin-inline-start: 24px;
  }
  .date-time {
    gap: 8px;
  }
  .lo-form-label.disabled,
  .caption.disabled {
    color: var(--lo-fg-disabled);
  }
  .caption {
    flex-shrink: 0;
    margin-block: 16px 8px;
  }
  .audience {
    flex-shrink: 0;
    gap: 4px;
    margin-block-start: 8px;
  }
  .audience-choice {
    gap: 24px;
    margin-inline-start: 24px;
  }
  .message {
    min-height: 120px;
    margin-block-start: 8px;
  }
  .editor {
    min-height: 0;
    overflow-y: auto;
    padding: 8px 12px;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
  }
  .message.disabled .editor {
    background-color: var(--lo-pane-alt-bg);
    color: var(--lo-fg-disabled);
  }
  .editor :global(.ProseMirror) {
    outline: none;
  }
</style>
