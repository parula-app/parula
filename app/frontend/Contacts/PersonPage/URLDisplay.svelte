<hbox class="value">
  <a href={addHTTPSToHostname(value)}
    target="_blank"
    class="link-button"
    on:click={event => event.stopPropagation()}>
    {value}
  </a>
</hbox>

<script lang="ts">
  import { addHTTPSToHostname } from "../../../logic/util/netUtil";

  export let value: string;
</script>
