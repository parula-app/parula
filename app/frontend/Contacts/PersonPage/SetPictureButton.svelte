<Button
  label={$t`Set picture`}
  icon={PictureIcon}
  onClick={onSelectPicture}
  {iconSize}
  iconOnly plain classes="set-picture" />
<FileSelector {acceptFileTypes} bind:this={fileSelector} />

<script lang="ts">
  import type { Person } from "../../../logic/Abstract/Person";
  import FileSelector from "../../Mail/Composer/Attachments/FileSelector.svelte";
  import Button from "../../Shared/Button.svelte";
  import PictureIcon from "lucide-svelte/icons/circle-user-round";
  import { scaleImageToDataURL } from "../../Shared/image";
  import type { URLString } from "../../../logic/util/util";
  import { t } from "../../../l10n/l10n";

  export let person: Person;
  export let iconSize = "16px";

  let fileSelector: FileSelector;
  const acceptFileTypes = [ "image/*", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg" ];

  async function onSelectPicture() {
    let file = await fileSelector.selectFile();
    if (!file) {
      return;
    }
    person.picture = await scalePicture(file);
  }

  async function scalePicture(file: Blob): Promise<URLString> {
    const kPictureSize = 240; // at least 96px * 2 for HiDPI
    /** ActiveSync allows only 48 kB of base64 for a contact picture @see [MS-ASCNTC] 2.2.2.58 `Picture`
     * and the other protocols have size limits, too */
    const kMaxPictureLength = 48 * 1024;

    return await scaleImageToDataURL(file, kPictureSize, kMaxPictureLength);
  }
</script>
