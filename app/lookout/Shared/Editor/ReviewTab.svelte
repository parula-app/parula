<RibbonTab label={$t`Review *=> Ribbon tab with commands to check the text, e.g. the spelling`}>
  <RibbonGroup label={$t`Proofing *=> Ribbon group with commands to check the text`}>
    <RibbonToggleButton label={$t`Spelling & Grammar`} shortLabel={$t`Spelling *=> Check the spelling while typing`} icon={SpellingIcon}
      tooltip={$t`Check spelling while typing`}
      selected={$spellcheck.value}
      onClick={() => { $spellcheck.value = !$spellcheck.value; }} />
    <RibbonButton label={$t`Word Count`} icon={WordCountIcon}
      tooltip={$t`The number of words, characters and paragraphs in the text or the selection`}
      disabled={!editor} onClick={() => { openedTool = EditorTool.WordCount; }} />
  </RibbonGroup>
</RibbonTab>

<script lang="ts">
  import { EditorTool } from "./EditorTool";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import RibbonTab from "../Ribbon/RibbonTab.svelte";
  import RibbonGroup from "../Ribbon/RibbonGroup.svelte";
  import RibbonButton from "../Ribbon/RibbonButton.svelte";
  import RibbonToggleButton from "../Ribbon/RibbonToggleButton.svelte";
  import SpellingIcon from "lucide-svelte/icons/spell-check";
  import WordCountIcon from "lucide-svelte/icons/whole-word";
  import type { Editor } from "@tiptap/core";
  import { t } from "../../../l10n/l10n";

  export let editor: Editor = null;
  export let openedTool: EditorTool | null = null;



  const spellcheck = getLocalStorage<boolean>("mail.send.spellcheck.enabled", false);
</script>
