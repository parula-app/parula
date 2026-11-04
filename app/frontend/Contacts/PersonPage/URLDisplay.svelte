<hbox class="value">
  <a href={urlWithScheme(value)}
    target="_blank"
    class="link-button"
    on:click={event => event.stopPropagation()}>
    {value}
  </a>
</hbox>

<script lang="ts">
  import { urlWithScheme } from "../../../logic/util/netUtil";

  export let value: string;
</script>
