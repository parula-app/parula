<Dialog title={$t`Automatic Replies - ${account.emailAddress || account.name}`} on:close width="640px"
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
      <Radio name="state" value="off" group={state} label={$t`Do not send automatic replies`}
        on:change={() => { autoResponder.isOn = false; }} />
      <Radio name="state" value="always" group={state} label={$t`Always send automatic replies`}
        on:change={() => { autoResponder.isOn = true; autoResponder.scheduled = false; }} />
      <Radio name="state" value="scheduled" group={state} label={$t`Only send during this time range:`}
        on:change={() => { autoResponder.isOn = true; autoResponder.scheduled = true; }} />
      <FormGrid classes="times">
        <span class="lo-form-label" class:disabled={!isTimeRange}>{$t`Start: *=> Start of the time range for automatic replies`}</span>
        <hbox class="date-time">
          <DateField required date={$autoResponder.startTime} label={$t`Start date`} disabled={!isTimeRange}
            on:change={ev => setStartTime(autoResponder, ev.detail)} />
          <TimeInput time={$autoResponder.startTime} options={startTimeOptions($autoResponder.startTime)} label={$t`Start time`} disabled={!isTimeRange}
            on:change={ev => setStartTime(autoResponder, ev.detail)} />
        </hbox>
        <span class="lo-form-label" class:disabled={!isTimeRange}>{$t`End: *=> End of the time range for automatic replies`}</span>
        <hbox class="date-time">
          <DateField required date={$autoResponder.endTime} min={$autoResponder.startTime} label={$t`End date`} disabled={!isTimeRange}
            on:change={ev => { autoResponder.endTime = ev.detail; }} />
          <TimeInput time={$autoResponder.endTime} options={startTimeOptions($autoResponder.endTime)} label={$t`End time`} disabled={!isTimeRange}
            on:change={ev => { autoResponder.endTime = ev.detail; }} />
        </hbox>
      </FormGrid>
    </vbox>
    {#if autoResponder.supportsExternal}
      <vbox class="message" class:disabled={!$autoResponder.isOn}>
        <hbox class="header">{$t`Inside My Organization`}</hbox>
        <EditorToolbar editor={internalEditor} disabled={!$autoResponder.isOn} />
        <vbox class="editor">
          <HTMLEditor bind:html={autoResponder.internalHTML} bind:editor={internalEditor} />
        </vbox>
        <hbox class="copy-buttons">
          <DialogButton label={$t`Copy *=> Copy the message to the other text field`} icon={CopyDownIcon} classes="plain"
            tooltip={$t`Copy to Outside My Organization`} disabled={!isOutsideOn}
            onClick={() => { autoResponder.externalHTML = autoResponder.internalHTML; }} />
          <DialogButton label="" icon={CopyUpIcon} classes="plain"
            tooltip={$t`Copy from Outside My Organization`} disabled={!$autoResponder.isOn}
            onClick={() => { autoResponder.internalHTML = autoResponder.externalHTML; }} />
        </hbox>
      </vbox>
    {/if}
    <vbox class="message" class:disabled={!isOutsideOn}>
      <hbox class="header">{autoResponder.supportsExternal ? $t`Outside My Organization` : $t`Automatic reply`}</hbox>
      {#if autoResponder.supportsExternal}
        <Checkbox checked={$autoResponder.externalAudience != AutoResponderAudience.None} disabled={!$autoResponder.isOn}
          label={$t`Auto-reply to people outside my organization`}
          on:change={ev => { autoResponder.externalAudience = ev.detail ? AutoResponderAudience.All : AutoResponderAudience.None; }} />
      {/if}
      {#if autoResponder.supportsContacts}
        <hbox class="audience-choice">
          <Radio name="audience" value={AutoResponderAudience.Contacts} group={shownAudience} disabled={!isOutsideOn}
            label={$t`My Contacts only`}
            on:change={ev => { autoResponder.externalAudience = ev.detail; }} />
          <Radio name="audience" value={AutoResponderAudience.All} group={shownAudience} disabled={!isOutsideOn}
            label={$t`Anyone outside my organization`}
            on:change={ev => { autoResponder.externalAudience = ev.detail; }} />
        </hbox>
      {/if}
      <EditorToolbar editor={externalEditor} disabled={!isOutsideOn} />
      <vbox class="editor">
        <HTMLEditor bind:html={autoResponder.externalHTML} bind:editor={externalEditor} />
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
  import Radio from "../../Shared/Form/Radio.svelte";
  import Checkbox from "../../Shared/Form/Checkbox.svelte";
  import FormGrid from "../../Shared/Form/FormGrid.svelte";
  import DateField from "../../Shared/Form/DateField.svelte";
  import TimeInput from "../../Calendar/EditEvent/TimeInput.svelte";
  import EditorToolbar from "../../Shared/Editor/EditorToolbar.svelte";
  import HTMLEditor from "../../../frontend/Shared/Editor/HTMLEditor.svelte";
  import WarningIcon from "lucide-svelte/icons/triangle-alert";
  import CopyDownIcon from "lucide-svelte/icons/arrow-down";
  import CopyUpIcon from "lucide-svelte/icons/arrow-up";
  import type { Editor } from "@tiptap/core";
  import { onMount } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let account: MailAccount;

  /** What the user edits. OK saves it, Cancel drops it. */
  let autoResponder = account.newAutoResponder();
  let isLoading = true;
  let loadError: Error = null;
  let internalEditor: Editor;
  let externalEditor: Editor;

  $: state = !$autoResponder.isOn ? "off" : $autoResponder.scheduled ? "scheduled" : "always";
  $: isTimeRange = state == "scheduled";
  $: isOutsideOn = $autoResponder.isOn && $autoResponder.externalAudience != AutoResponderAudience.None;
  // Like Outlook, one of the 2 is checked, even while there are no replies outside
  $: shownAudience = $autoResponder.externalAudience == AutoResponderAudience.Contacts ? AutoResponderAudience.Contacts : AutoResponderAudience.All;
  $: setEditable(internalEditor, $autoResponder.isOn);
  $: setEditable(externalEditor, isOutsideOn);

  function setEditable(editor: Editor, editable: boolean) {
    if (editor && editor.isEditable != editable) {
      editor.setEditable(editable, false);
    }
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
    autoResponder.rememberTimes();
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
  .state :global(.times) {
    margin-block-start: 4px;
    margin-inline-start: 24px;
  }
  .date-time {
    gap: 8px;
  }
  .lo-form-label.disabled {
    color: var(--lo-fg-disabled);
  }
  .message {
    flex-shrink: 0;
    gap: 4px;
  }
  .state + .message {
    margin-block-start: 24px;
  }
  .header {
    font-weight: 600;
  }
  .audience-choice {
    gap: 24px;
    margin-inline-start: 24px;
  }
  .copy-buttons {
    justify-content: end;
    gap: 4px;
  }
  .editor {
    height: 110px;
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
