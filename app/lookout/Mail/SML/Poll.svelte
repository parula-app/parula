<vbox class="poll" role="radiogroup" aria-label={poll.name || $t`Poll`}>
  {#if poll.name}
    <span class="question">{poll.name}</span>
  {/if}
  {#each options as option}
    <vbox class="option">
      <Radio bind:group={myReaction.object} value={option} name={groupName} label={option.name || $t`(no text)`} />
      {#if option.description}
        <span class="description">{option.description}</span>
      {/if}
    </vbox>
  {:else}
    <span class="empty">{$t`This poll has no options yet`}</span>
  {/each}
</vbox>

<script lang="ts">
  import type { SMLData } from "../../../logic/Mail/SML/SMLData";
  import type { TSMLSimplePoll, TSMLAction, TSMLThing } from "../../../logic/Mail/SML/TSML";
  import Radio from "../../Shared/Form/Radio.svelte";
  import { ensureArray } from "../../../logic/util/util";
  import { t } from "../../../l10n/l10n";

  export let sml: SMLData;
  export let myReaction: TSMLAction;

  const groupName = "sml-poll-" + Math.random().toString(36).slice(2);
  $: poll = $sml.sml as TSMLSimplePoll<TSMLThing>;
  $: options = ensureArray(poll.options) as TSMLThing[];
</script>

<style>
  .poll {
    gap: 6px;
  }
  .question {
    margin-bottom: 2px;
    font-weight: 600;
  }
  .description {
    padding-inline-start: 26px;
    color: var(--lo-fg-secondary);
    font-size: var(--lo-font-size-small);
  }
  .empty {
    color: var(--lo-fg-secondary);
  }
</style>
