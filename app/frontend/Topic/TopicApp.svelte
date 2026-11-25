<vbox class="topic-app" flex>
  <Splitter initialRightRatio={2} leftMinWidth={100} rightMinWidth={500} hasRight={!!$selectedTopic}>
    <TopicGraph bind:selectedTopic={$selectedTopic} slot="left" />
    <TopicPage bind:topic={$selectedTopic} slot="right" />
  </Splitter>
</vbox>

<script lang="ts">
  import { selectedTopic } from "./selected";
  import TopicGraph from "./Graph/TopicGraphPane.svelte";
  import TopicPage from "./Page/TopicPage.svelte";
  import Splitter from "../Shared/Splitter.svelte";
</script>
