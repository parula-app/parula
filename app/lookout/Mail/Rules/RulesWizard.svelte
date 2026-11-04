<Dialog title={$t`Rules Wizard`} width="520px" height="640px" on:close={onClose}>
  <vbox flex class="wizard">
    {#if page == RuleWizardPage.Templates}
      <span class="question">{$t`Start from a template or from a blank rule`}</span>
      <span class="step">{$t`Step 1: Select a template`}</span>
      <vbox class="list" role="listbox" aria-label={$t`Templates *=> List of templates for new rules`}>
        {#each groups as group}
          <div class="group-header" role="presentation">{group}</div>
          {#each model.templates.filter(template => template.group == group) as template (template.id)}
            <button type="button" class="row template" role="option"
              class:selected={model.template == template} aria-selected={model.template == template}
              on:click={() => onTemplate(template)}
              on:dblclick={onNext}>
              <svelte:component this={templateIcon(template)} size={16} />
              <span>{template.label}</span>
            </button>
          {/each}
        {/each}
      </vbox>
      <span class="step">{$t`Step 2: Edit the rule description (click an underlined value)`}</span>
      <RuleDescriptionBox lines={model.lines} on:edit={event => onValueClick(event.detail)} example={model.template?.example} />
    {:else if page == RuleWizardPage.Conditions || page == RuleWizardPage.Actions}
      <span class="question">
        {page == RuleWizardPage.Conditions
          ? $t`Which condition(s) do you want to check?`
          : $t`What do you want to do with the message?`}
      </span>
      <span class="step">
        {page == RuleWizardPage.Conditions ? $t`Step 1: Select condition(s)` : $t`Step 1: Select action(s)`}
      </span>
      <vbox class="list" role="group"
        aria-label={page == RuleWizardPage.Conditions ? $t`Conditions *=> Rule conditions: which emails the rule applies to` : $t`Actions`}>
        {#each items as item (item.id)}
          <hbox class="row" class:selected={selectedItem == item}>
            <Checkbox checked={model.isChecked(item)} on:change={event => onCheck(item, event.detail)}>
              <span class="phrase">
                {#each item.listParts() as part}
                  {#if part.isValue}<span class="link">{part.text}</span>{:else}{part.text}{/if}
                {/each}
              </span>
            </Checkbox>
          </hbox>
        {/each}
      </vbox>
      <span class="step">{$t`Step 2: Edit the rule description (click an underlined value)`}</span>
      <RuleDescriptionBox lines={model.lines} on:edit={event => onValueClick(event.detail)} />
    {:else}
      <span class="question">{$t`Finish rule setup`}</span>
      <label class="step" for="rule-wizard-name">{$t`Step 1: Specify a name for this rule`}</label>
      <input id="rule-wizard-name" class="lo-text-field name" type="text" bind:value={model.name}
        on:input={refresh} />
      <span class="step">{$t`Step 2: Review rule description (click an underlined value to edit)`}</span>
      <RuleDescriptionBox fill lines={model.lines} on:edit={event => onValueClick(event.detail)} />
    {/if}
    <hbox class="divider" />
  </vbox>
  <svelte:fragment slot="footer">
    <DialogButton label={$t`Cancel`} onClick={onClose} />
    <DialogButton label={$t`< Back`} disabled={!model.canGoBack} onClick={onBack} />
    <DialogButton label={$t`Next >`} primary={page != RuleWizardPage.Finish}
      disabled={model.nextDisabledReason ?? false} onClick={onNext} />
    <DialogButton label={$t`Finish *=> Complete the wizard`} primary={page == RuleWizardPage.Finish}
      disabled={model.finishDisabledReason ?? false} onClick={onFinishClicked} />
  </svelte:fragment>
</Dialog>
{#if pickerItem}
  <RuleValuePicker rule={model.rule} item={pickerItem} on:change={onPickerChange} on:close={onPickerClose} />
{/if}
{#if question}
  <RuleMessageBox title={$t`Rules Wizard`} message={question.text} isQuestion on:answer={event => question.answer(event.detail)} />
{/if}

<script lang="ts">
  import type { FilterRuleAction } from "../../../logic/Mail/FilterRules/FilterRuleAction";
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { FilterMoment } from "../../../logic/Mail/FilterRules/FilterMoments";
  import { RuleWizardModel, RuleWizardPage } from "./RuleWizardModel";
  import type { RuleTemplate } from "./RuleTemplates";
  import type { RuleItem } from "./RuleItems";
  import Dialog from "../../Shared/Dialog/Dialog.svelte";
  import Checkbox from "../../Shared/Form/Checkbox.svelte";
  import DialogButton from "../../Shared/Dialog/DialogButton.svelte";
  import RuleDescriptionBox from "./RuleDescriptionBox.svelte";
  import RuleValuePicker from "./RuleValuePicker.svelte";
  import RuleMessageBox from "./RuleMessageBox.svelte";
  import MoveIcon from "lucide-svelte/icons/folder-input";
  import FlagIcon from "lucide-svelte/icons/flag";
  import ReceiveIcon from "lucide-svelte/icons/mail";
  import ReceiveAfterJunkIcon from "lucide-svelte/icons/shield-check";
  import SendIcon from "lucide-svelte/icons/send";
  import { createEventDispatcher } from "svelte";
  import { t } from "../../../l10n/l10n";

  export let rule: FilterRuleAction | null = null;
  export let account: MailAccount = null;
  const dispatch = createEventDispatcher<{ finish: FilterRuleAction, close: void }>();

  let model = rule ? RuleWizardModel.forRule(rule) : RuleWizardModel.forNewRule(account);

  let pickerItem: RuleItem | null = null;
  let selectedItem: RuleItem | null = null;
  let question: { text: string, answer: (yes: boolean) => void } | null = null;

  $: page = model.page;
  $: groups = [...new Set(model.templates.map(template => template.group))];
  $: items = page == RuleWizardPage.Conditions ? model.shownConditions : model.actions;

  function refresh() {
    model = model;
  }

  function templateIcon(template: RuleTemplate): ConstructorOfATypedSvelteComponent {
    if (template.actionIDs.includes("move")) {
      return MoveIcon;
    }
    if (template.actionIDs.includes("flag")) {
      return FlagIcon;
    }
    switch (template.when) {
      case FilterMoment.Outgoing:
        return SendIcon;
      case FilterMoment.IncomingAfterSpam:
        return ReceiveAfterJunkIcon;
      default:
        return ReceiveIcon;
    }
  }

  function onTemplate(template: RuleTemplate) {
    model.selectTemplate(template);
    refresh();
  }

  function onCheck(item: RuleItem, checked: boolean) {
    model.setChecked(item, checked);
    selectedItem = item;
    refresh();
  }

  function onValueClick(item: RuleItem) {
    pickerItem = item;
  }

  function onPickerChange() {
    model.valueChanged(pickerItem);
  }

  function onPickerClose() {
    pickerItem = null;
    refresh();
  }

  function ask(text: string): Promise<boolean> {
    return new Promise(resolve => {
      question = {
        text,
        answer: yes => {
          question = null;
          resolve(yes);
        },
      };
    });
  }

  function onBack() {
    model.back();
    selectedItem = null;
    refresh();
  }

  async function onNext() {
    if (model.nextDisabledReason) {
      return;
    }
    if (page == RuleWizardPage.Conditions && model.asksNoConditionsQuestion &&
        !await ask(model.noConditionsQuestion)) {
      return;
    }
    model.next();
    selectedItem = null;
    refresh();
  }

  async function onFinishClicked() {
    if (model.finishDisabledReason) {
      return;
    }
    if (model.asksNoConditionsQuestion && !await ask(model.noConditionsQuestion)) {
      return;
    }
    dispatch("finish", model.finish());
  }

  function onClose() {
    dispatch("close");
  }
</script>

<style>
  .wizard {
    min-height: 0;
    gap: 4px;
  }
  .question {
    margin-block-end: 6px;
  }
  .step {
    margin-block-start: 4px;
  }
  .list {
    flex: 1 1 0;
    min-height: 120px;
    padding: 2px 0;
    overflow-y: auto;
    border: 1px solid var(--lo-input-border);
    border-radius: var(--lo-radius-small);
    background-color: var(--lo-input-bg);
  }
  .group-header {
    flex-shrink: 0;
    margin: 4px 6px 0 6px;
    padding: 0 2px 1px 2px;
    border-block-end: 1px solid var(--lo-divider);
    font-weight: 600;
  }
  .row {
    display: flex;
    flex-direction: row;
    align-items: center;
    flex-shrink: 0;
    gap: 8px;
    min-height: 24px;
    padding: 0 8px;
    border: none;
    background: none;
    color: var(--lo-fg);
    font: inherit;
    text-align: start;
    cursor: default;
  }
  .row:hover {
    background-color: var(--lo-hover-bg);
  }
  .row.selected {
    background-color: var(--lo-selected-bg);
  }
  .row.template {
    padding-inline-start: 16px;
  }
  .row.template :global(svg) {
    flex-shrink: 0;
    color: var(--lo-accent-text);
  }
  .link {
    color: var(--lo-accent-text);
    text-decoration: underline;
  }
  .name {
    flex-shrink: 0;
    margin-block-end: 8px;
  }
  .divider {
    flex-shrink: 0;
    height: 1px;
    margin-block-start: 12px;
    background-color: var(--lo-divider);
  }
</style>
