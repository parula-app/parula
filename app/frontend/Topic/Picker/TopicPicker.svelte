<!-- The keys typed in the search field must not reach the shortcuts of the app, e.g. Backspace would delete the email -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<vbox class="topic-picker" on:keydown|stopPropagation>
  <hbox class="header">
    <!-- svelte-ignore a11y_autofocus -->
    <input type="search"
      bind:value={searchTerm}
      placeholder={newTopicName ? $t`Find the parent topic` : $t`Find or create a topic`}
      autofocus
      on:keydown={event => catchErrors(() => onKeyEnter(event, onEnter))}
      />
    <Button plain
      label={$t`Close`}
      onClick={onClose}
      iconOnly
      icon={CloseIcon}
      />
  </hbox>
  {#if newTopicName}
    <hbox class="new-topic-parent">
      <hbox flex>{$t`New topic ${newTopicName} as sub-topic of:`}</hbox>
      <Button plain
        label={$t`Cancel`}
        onClick={onCancelNewTopic}
        iconOnly
        icon={CloseIcon}
        />
    </hbox>
  {/if}
  <vbox class="topics">
    {#each shownTopics as topic (topic.id)}
      <hbox class="topic" style="padding-inline-start: {search ? 0 : (topic.depth - 1) * 16}px">
        {#if newTopicName}
          <Button plain
            label={topic.name}
            onClick={() => onNewTopic(topic)}
            />
        {:else}
          <Checkbox
            checked={linkedTopics.includes(topic)}
            label={topic.name}
            allowIndetermined={false}
            on:change={() => catchErrors(() => onToggle(topic))}
            />
        {/if}
        {#if search && topic.parent != rootTopic}
          <hbox class="parent font-smallest">{topic.parent.name}</hbox>
        {/if}
      </hbox>
    {/each}
  </vbox>
  {#if search && !newTopicName && !shownTopics.find(topic => topic.name.toLowerCase() == search)}
    <hbox class="new">
      <Button plain
        label={$t`New topic ${searchTerm.trim()}…`}
        icon={PlusIcon}
        onClick={onChooseParent}
        />
    </hbox>
  {/if}
</vbox>

<script lang="ts">
  import type { Topic, LinkTarget } from "../../../logic/Topic/Topic";
  import { topicLinksTo } from "../../../logic/Topic/Link/TopicLinks";
  import { rootTopic } from "../../../logic/Topic/TopicAccounts";
  import { appGlobal } from "../../../logic/app";
  import Checkbox from "../../Shared/Checkbox.svelte";
  import Button from "../../Shared/Button.svelte";
  import PlusIcon from "lucide-svelte/icons/plus";
  import CloseIcon from "lucide-svelte/icons/x";
  import { onKeyEnter } from "../../Util/util";
  import { catchErrors } from "../../Util/error";
  import { t } from "../../../l10n/l10n";
  import { createEventDispatcher } from "svelte";
  const dispatch = createEventDispatcher<{ close: void }>();

  /** The email, contact etc. that the user adds to topics, or removes from them */
  export let target: LinkTarget;

  let searchTerm = "";
  /** The name of the topic that the user wants to create, while they choose its parent */
  let newTopicName: string | null = null;
  $: links = topicLinksTo(target);
  $: linkedTopics = $links.contents.map(link => link.topic);
  $: search = searchTerm.trim().toLowerCase();
  let topics = appGlobal.topics;
  $: shownTopics = $topics && (search
    ? rootTopic.descendants.filter(topic => topic.name.toLowerCase().includes(search))
    : rootTopic.descendants);

  async function onToggle(topic: Topic) {
    let link = $links.find(link => link.topic == topic);
    if (link) {
      await topic.removeLink(link);
    } else {
      await topic.addLink(target);
    }
  }

  /** No new topics at the top, only sub-topics */
  function onChooseParent() {
    newTopicName = searchTerm.trim();
    searchTerm = "";
  }

  async function onNewTopic(parent: Topic) {
    let topic = await parent.newChild(newTopicName);
    await topic.addLink(target);
    newTopicName = null;
    searchTerm = "";
  }

  function onCancelNewTopic() {
    newTopicName = null;
  }

  /** Adds to the only topic found */
  async function onEnter() {
    if (shownTopics.length == 1 && !newTopicName) {
      await onToggle(shownTopics[0]);
    }
  }

  function onClose() {
    dispatch("close");
  }
</script>

<style>
  .topic-picker {
    min-width: 250px;
    max-width: 400px;
    max-height: 60vh;
    padding: 8px 12px;
    background-color: var(--bg);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    box-shadow: 1px 1px 8px 0px rgba(0, 0, 0, 0.2);
  }
  .header {
    align-items: center;
    margin-block-end: 8px;
  }
  .header input {
    flex: 1;
    margin-inline-end: 4px;
  }
  .topics {
    overflow-y: auto;
  }
  .topic {
    align-items: center;
    min-height: 28px;
  }
  .parent {
    margin-inline-start: 8px;
    opacity: 60%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .new {
    margin-block-start: 4px;
  }
  .new-topic-parent {
    align-items: center;
    margin-block-end: 4px;
    font-weight: bold;
  }
</style>
