<vbox class="topic-graph-pane" flex>
  {#if view == "graph"}
    <TopicGraph bind:selectedTopic />
  {:else}
    <Scroll>
      <vbox class="tree-branch">
        <TopicTreeBranch topic={rootTopic} bind:selectedTopic />
      </vbox>
    </Scroll>
  {/if}
  <hbox class="switcher">
    <IslandSwitcher>
      <Button
        label={$t`Graph`}
        onClick={() => switchTo("graph")}
        selected={view == "graph"}
        />
      <Button
        label={$t`Table of contents`}
        onClick={() => switchTo("toc")}
        selected={view == "toc"}
        />
    </IslandSwitcher>
  </hbox>
  <WorkspaceSearchBar />
</vbox>

<script lang="ts">
  import WorkspaceSearchBar from "../../MainWindow/WorkspaceSearchBar.svelte";
  import { rootTopic } from "../../../logic/Topic/TopicAccounts";
  import { getLocalStorage } from "../../Util/LocalStorage";
  import IslandSwitcher from "../../Shared/IslandSwitcher.svelte";
  import Button from "../../Shared/Button.svelte";
  import Scroll from "../../Shared/Scroll.svelte";
  import TopicGraph from "./TopicGraph.svelte";
  import TopicTreeBranch from "./TopicTreeBranch.svelte";
  import { t } from "../../../l10n/l10n";

  /** in/out */
  export let selectedTopic = rootTopic;

  let viewSetting = getLocalStorage("topic.graphPane.view", "toc");
  $: view = $viewSetting.value;

  function switchTo(newView: string) {
    viewSetting.value = newView;
  }
</script>

<style>
  .topic-graph-pane {
    background-color: var(--leftbar-bg);
    color: var(--leftbar-fg);
  }
  .tree-branch {
    padding: 6px 24px 6px 12px;
  }
  .switcher {
    margin: 6px 8px;
  }
</style>
