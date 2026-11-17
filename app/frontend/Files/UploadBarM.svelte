<hbox class="buttons">
  <AppBarM>
    <!-- left -->
    {#if person}
      <hbox class="list">
        <Button
          icon={PersonIcon}
          iconSize="24px"
          iconOnly
          label={person.name}
          onClick={goToPerson}
          plain
          />
      </hbox>
    {:else}
      <hbox class="list">
        <Button
          icon={PersonsIcon}
          iconSize="24px"
          iconOnly
          label={$t`List persons`}
          onClick={goToPersons}
          plain
          />
      </hbox>
    {/if}

    <!-- left middle -->
    <hbox class="list">
      <Button
        icon={PictureIcon}
        iconSize="24px"
        iconOnly
        label={$t`Upload picture`}
        onClick={uploadPicture}
        plain
        />
    </hbox>

    <AppMenuButton />

    <!-- right middle -->
    <hbox class="list">
      <Button
        icon={FileIcon}
        iconSize="24px"
        iconOnly
        label={$t`Upload file`}
        onClick={uploadFile}
        plain
        />
    </hbox>

    <!-- right -->
    <hbox class="empty" />
  </AppBarM>
</hbox>

<script lang="ts">
  import { Person } from "../../logic/Abstract/Person";
  import { goTo } from "../AppsBar/selectedApp";
  import AppBarM from "../AppsBar/AppBarM.svelte";
  import ButtonMenu from "../Shared/Menu/ButtonMenu.svelte";
  import Button from "../Shared/Button.svelte";
  import AppMenuButton from "../AppsBar/AppMenuM/AppMenuButton.svelte";
  import PersonIcon from "lucide-svelte/icons/user";
  import PersonsIcon from "lucide-svelte/icons/users";
  import PictureIcon from "lucide-svelte/icons/image-plus";
  import FileIcon from "lucide-svelte/icons/file-plus";
  import { URLPart } from "../../logic/util/blob";
  import { t } from "../../l10n/l10n";
  import { createEventDispatcher } from 'svelte';
  const dispatchEvent = createEventDispatcher<{ uploadFile: void, uploadPicture: void }>();

  export let person: Person;

  let isMenuOpen = false;

  function goToPerson() {
    goTo(URLPart`/files/person/${person.id}/files`, { person });
  }

  function goToPersons() {
    goTo("/files/", {});
  }

  function uploadFile() {
    dispatchEvent("uploadFile");
  }

  function uploadPicture() {
    dispatchEvent("uploadPicture");
  }
</script>
