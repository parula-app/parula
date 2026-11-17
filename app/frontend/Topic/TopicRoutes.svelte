<Route path="graph">
  <TopicGraph selectedTopic={$selectedTopic} />
</Route>
  <Route path="page/:topicID" let:params={urlParams}>
  {params.topic ??= urlParams.topicID ? appGlobal.topics.find(topic => topic.id == urlParams.topicID) : null, ""}
  <TopicPage bind:topic={$selectedTopic} />
</Route>
<Route path="/">
  <TopicApp />
</Route>

<script lang="ts">
  import { selectedTopic } from "./selected";
  import { appGlobal } from "../../logic/app";
  import { getParams } from "../AppsBar/selectedApp";
  import { requiredParam } from "../Util/route";
  import TopicApp from "./TopicApp.svelte";
  import TopicGraph from "./Graph/TopicGraphPane.svelte";
  import TopicPage from "./Page/TopicPage.svelte";
  import { Route, useLocation } from "svelte-navigator";

  $: location = useLocation();
  $: params = getParams($location?.state);
  $: params, setTopic()
  // Set only when params.foo changes, not when $selectedFoo changes
  let lastTopic = null;
  function setTopic() {
    if (params.topic && params.topic != lastTopic) {
      $selectedTopic = params.topic;
      lastTopic = params.topic;
    }
  }
</script>
