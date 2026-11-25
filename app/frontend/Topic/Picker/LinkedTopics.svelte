<!-- The topics of an email, contact etc. -->
{#if $links.hasItems}
  <hbox class="linked-topics">
    {#each $links.each as link}
      <Button plain
        classes="topic"
        icon={TopicIcon}
        label={link.topic.name}
        tooltip={$t`Open topic ${link.topic.name}`}
        onClick={() => openTopic(link.topic)}
        />
    {/each}
  </hbox>
{/if}

<script lang="ts">
  import type { LinkTarget } from "../../../logic/Topic/Topic";
  import { topicLinksTo } from "../../../logic/Topic/Link/TopicLinks";
  import { openTopic } from "../open";
  import Button from "../../Shared/Button.svelte";
  import TopicIcon from "lucide-svelte/icons/notebook-tabs";
  import { t } from "../../../l10n/l10n";

  export let target: LinkTarget;

  $: links = topicLinksTo(target);
</script>

<style>
  .linked-topics {
    flex-wrap: wrap;
    gap: 4px;
  }
  .linked-topics :global(.topic) {
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 0px 8px;
  }
</style>
