{#if isLoading}
  <hbox class="loading">
    <Loader />
  </hbox>
{:else if loadError instanceof PermissionMissing}
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
  <vbox class="auto-responder">
    <HeaderGroupBox>
      <hbox slot="header">{$t`Automatic replies`}</hbox>
      <vbox class="options">
        <label class="radio">
          <input type="radio" name="state" checked={state == "off"}
            on:change={() => { autoResponder.isOn = false; }} />
          {$t`Do not send automatic replies`}
        </label>
        <label class="radio">
          <input type="radio" name="state" checked={state == "always"}
            on:change={() => { autoResponder.isOn = true; autoResponder.scheduled = false; }} />
          {$t`Always send automatic replies`}
        </label>
        <label class="radio">
          <input type="radio" name="state" checked={state == "scheduled"}
            on:change={() => { autoResponder.isOn = true; autoResponder.scheduled = true; }} />
          {$t`Only send during this time range:`}
        </label>
        <grid class="time-range" class:disabled={!isTimeRange}>
          <hbox>{$t`Start: *=> Start of the time range for automatic replies`}</hbox>
          <hbox class="date-time">
            <DateInput date={$autoResponder.startTime} disabled={!isTimeRange}
              on:change={ev => autoResponder.setStartTime(ev.detail)} />
            <TimeInput time={$autoResponder.startTime} disabled={!isTimeRange}
              on:change={ev => autoResponder.setStartTime(ev.detail)} />
          </hbox>
          <hbox>{$t`End: *=> End of the time range for automatic replies`}</hbox>
          <hbox class="date-time">
            <DateInput date={$autoResponder.endTime} min={$autoResponder.startTime} disabled={!isTimeRange}
              on:change={ev => { autoResponder.endTime = ev.detail; }} />
            <TimeInput time={$autoResponder.endTime} disabled={!isTimeRange}
              on:change={ev => { autoResponder.endTime = ev.detail; }} />
          </hbox>
        </grid>
      </vbox>
    </HeaderGroupBox>

    {#if autoResponder.supportsInternal}
      <HeaderGroupBox>
        <hbox slot="header">{$t`Inside My Organization`}</hbox>
        <vbox class="editor-box" class:disabled={!$autoResponder.isOn} inert={!$autoResponder.isOn}>
          <HTMLEditorToolbar editor={internalEditor} />
          <HTMLEditor bind:html={autoResponder.internalHTML} bind:editor={internalEditor} />
        </vbox>
        <hbox class="copy-buttons">
          <Button label={$t`Copy *=> Copy the message to the other text field`}
            tooltip={$t`Copy to Outside My Organization`}
            icon={CopyDownIcon}
            plain
            disabled={!isOutsideOn}
            onClick={() => { autoResponder.externalHTML = autoResponder.internalHTML; }}
            />
          <Button label={$t`Copy from Outside My Organization`}
            icon={CopyUpIcon}
            iconOnly
            plain
            disabled={!$autoResponder.isOn}
            onClick={() => { autoResponder.internalHTML = autoResponder.externalHTML; }}
            />
        </hbox>
      </HeaderGroupBox>
    {/if}

    <HeaderGroupBox>
      <hbox slot="header">{autoResponder.supportsInternal ? $t`Outside My Organization` : $t`Automatic reply`}</hbox>
      {#if autoResponder.supportsInternal}
        <vbox class="options">
          <Checkbox checked={$autoResponder.externalAudience != AutoResponderAudience.None} disabled={!$autoResponder.isOn}
            label={$t`Auto-reply to people outside my organization`}
            on:change={ev => { autoResponder.externalAudience = ev.detail ? AutoResponderAudience.All : AutoResponderAudience.None; }} />
          {#if autoResponder.supportsContacts}
            <hbox class="audience">
              <label class="radio" class:disabled={!isOutsideOn}>
                <input type="radio" name="audience" checked={shownAudience == AutoResponderAudience.Contacts} disabled={!isOutsideOn}
                  on:change={() => { autoResponder.externalAudience = AutoResponderAudience.Contacts; }} />
                {$t`My Contacts only`}
              </label>
              <label class="radio" class:disabled={!isOutsideOn}>
                <input type="radio" name="audience" checked={shownAudience == AutoResponderAudience.All} disabled={!isOutsideOn}
                  on:change={() => { autoResponder.externalAudience = AutoResponderAudience.All; }} />
                {$t`Anyone outside my organization`}
              </label>
            </hbox>
          {/if}
        </vbox>
      {/if}
      <vbox class="editor-box" class:disabled={!isOutsideOn} inert={!isOutsideOn}>
        <HTMLEditorToolbar editor={externalEditor} />
        <HTMLEditor bind:html={autoResponder.externalHTML} bind:editor={externalEditor} />
      </vbox>
    </HeaderGroupBox>
  </vbox>
{/if}

<script lang="ts">
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { AutoResponderAudience, type AutoResponder } from "../../../logic/Mail/AutoResponder";
  import { PermissionMissing } from "../../../logic/Abstract/Account";
  import HeaderGroupBox from "../../Shared/HeaderGroupBox.svelte";
  import Checkbox from "../../Shared/Checkbox.svelte";
  import DateInput from "../../Calendar/EditEvent/DateInput.svelte";
  import TimeInput from "../../Calendar/EditEvent/TimeInput.svelte";
  import HTMLEditor from "../../Shared/Editor/HTMLEditor.svelte";
  import HTMLEditorToolbar from "../../Shared/Editor/HTMLEditorToolbar.svelte";
  import ErrorMessageInline from "../../Shared/ErrorMessageInline.svelte";
  import Loader from "../../Shared/Loader.svelte";
  import Button from "../../Shared/Button.svelte";
  import LoginIcon from "lucide-svelte/icons/log-in";
  import CopyDownIcon from "lucide-svelte/icons/arrow-down";
  import CopyUpIcon from "lucide-svelte/icons/arrow-up";
  import type { Editor } from "@tiptap/core";
  import { t } from "../../../l10n/l10n";

  export let account: MailAccount;
  /** out */
  export let isLoaded = false;
  /** out: The user changed something since `load()` or `save()` */
  export let isChanged = false;

  /** What the user edits. `save()` writes it to the server. */
  let autoResponder: AutoResponder;
  let isLoading = true;
  let loadError: Error | null = null;
  let internalEditor: Editor;
  let externalEditor: Editor;

  $: load(account); // first, because it sets `autoResponder`
  $: isLoaded = !isLoading && !loadError;
  $: $autoResponder && (isChanged = true);
  $: state = !$autoResponder.isOn ? "off" : $autoResponder.scheduled ? "scheduled" : "always";
  $: isTimeRange = state == "scheduled";
  $: isOutsideOn = $autoResponder.isOn && $autoResponder.externalAudience != AutoResponderAudience.None;
  // Like Outlook, one of the 2 is checked, even while there are no replies outside
  $: shownAudience = $autoResponder.externalAudience == AutoResponderAudience.Contacts ? AutoResponderAudience.Contacts : AutoResponderAudience.All;

  async function load(forAccount: MailAccount) {
    autoResponder = forAccount.newAutoResponder();
    isLoading = true;
    loadError = null;
    try {
      await autoResponder.load();
      isChanged = false;
    } catch (ex) {
      if (forAccount == account) {
        loadError = ex;
      }
    } finally {
      if (forAccount == account) {
        isLoading = false;
      }
    }
  }

  async function onAllow() {
    await account.upgradeScopes();
    await load(account);
  }

  export async function save() {
    await autoResponder.save();
    isChanged = false;
    autoResponder.rememberTimes();
    await account.autoResponder.load(); // for Lookout's info bar and File > Info
  }
</script>

<style>
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
  .disabled {
    opacity: 50%;
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
  .audience {
    gap: 24px;
    margin-inline-start: 28px;
  }
  .editor-box {
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
  }
  .options + .editor-box {
    margin-block-start: 16px;
  }
  .editor-box :global(.html-editor) {
    height: 8em;
    overflow-y: auto;
    padding: 8px;
  }
  .copy-buttons {
    justify-content: end;
    gap: 4px;
    margin-block-start: 4px;
  }
  :global(.lookout-window) .date-time :global(input) {
    box-sizing: border-box;
    min-height: 32px;
    padding: 0 8px;
    border: 1px solid var(--input-line);
    border-radius: var(--border-radius);
  }
</style>
