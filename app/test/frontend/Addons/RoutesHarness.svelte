<!-- Like `MainWindow`, which shows the page of the selected app -->
<Router primary={false} {history}>
  <svelte:component this={routes} />
</Router>

<script lang="ts">
  import { history } from "../../../frontend/AppsBar/selectedApp";
  import { Router } from "svelte-navigator";

  /** `AppContentRoutes` of the classic or the Lookout frontend */
  export let routes: ConstructorOfATypedSvelteComponent;
</script>
