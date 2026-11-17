<hbox class="buttons">
  <AppBarM>
    <!-- left -->
    <hbox class="search">
      <Button
        icon={PersonsIcon}
        iconSize="24px"
        iconOnly
        label={$t`List persons`}
        onClick={goToPersons}
        plain
        />
    </hbox>

    <!-- left middle -->
    <hbox class="search">
      <Button
        icon={SearchIcon}
        iconSize="24px"
        iconOnly
        label={$t`Search a person`}
        onClick={goToSearch}
        plain
        />
    </hbox>

    <AppMenuButton />

    <!-- right middle -->
    <hbox class="new">
      <Button
        icon={PlusIcon}
        iconSize="24px"
        iconOnly
        label={$t`Upload a file`}
        onClick={goToUpload}
        disabled={!$selectedPerson}
        plain
        />
    </hbox>

    <!-- right -->
    <hbox class="empty" />
  </AppBarM>
</hbox>

<script lang="ts">
  import { selectedPerson } from "../Contacts/Person/Selected";
  import { goTo } from "../AppsBar/selectedApp";
  import AppBarM from "../AppsBar/AppBarM.svelte";
  import ButtonMenu from "../Shared/Menu/ButtonMenu.svelte";
  import Button from "../Shared/Button.svelte";
  import AppMenuButton from "../AppsBar/AppMenuM/AppMenuButton.svelte";
  import PersonsIcon from "lucide-svelte/icons/users";
  import SearchIcon from "lucide-svelte/icons/search";
  import PlusIcon from "lucide-svelte/icons/plus";
  import { URLPart } from "../../logic/util/blob";
  import { t } from "../../l10n/l10n";

  let isMenuOpen = false;

  function goToPersons() {
    goTo("/files/", {});
  }

  function goToSearch() {
    goTo("/files/search", {});
  }

  function goToUpload() {
    goTo(URLPart`/files/person/${$selectedPerson.id}/upload`, { person: $selectedPerson });
  }
</script>
