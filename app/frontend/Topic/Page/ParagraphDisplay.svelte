<vbox class="paragraph font-normal">
  {@html sanitizeHTMLWithoutStyleTag($paragraph.html)}
</vbox>

<script lang="ts">
  import { Paragraph } from "../../../logic/Topic/PageContent";
  import { Topic } from "../../../logic/Topic/Topic";
  import { sanitizeHTMLWithoutStyleTag } from "../../../logic/util/convertHTML";

  export let topic: Topic;
  export let paragraph: Paragraph;
</script>

<style>
</style>
