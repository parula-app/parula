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
    <hbox class="history">
      <Button
        icon={HistoryIcon}
        iconSize="24px"
        iconOnly
        label={$t`Contact history`}
        onClick={goToHistory}
        plain
        />
    </hbox>

    <AppMenuButton />

    <!-- right middle -->
    {#if isEditing}
      <hbox class="save">
        <Button
          icon={SaveIcon}
          iconSize="24px"
          iconOnly
          label={$t`Save`}
          onClick={onSave}
          plain
          />
      </hbox>
    {:else}
      <hbox class="edit">
        <Button
          icon={EditIcon}
          iconSize="24px"
          iconOnly
          label={$t`Edit`}
          onClick={onEdit}
          plain
          />
      </hbox>
    {/if}

    <!-- right -->
    <PersonMenu {person} />
  </AppBarM>
</hbox>

<script lang="ts">
  import { Person } from "../../../logic/Abstract/Person";
  import { goTo } from "../../AppsBar/selectedApp";
  import { appGlobal } from "../../../logic/app";
  import PersonMenu from "./PersonMenu.svelte";
  import AppBarM from "../../AppsBar/AppBarM.svelte";
  import AppMenuButton from "../../AppsBar/AppMenuM/AppMenuButton.svelte";
  import Button from "../../Shared/Button.svelte";
  import PersonsIcon from "lucide-svelte/icons/users";
  import HistoryIcon from "lucide-svelte/icons/history";
  import EditIcon from "lucide-svelte/icons/pencil";
  import SaveIcon from "lucide-svelte/icons/save";
  import { URLPart } from "../../../logic/util/blob";
  import { t } from "../../../l10n/l10n";

  export let person: Person;
  /** in/out */
  export let isEditing: boolean;

  let isMenuOpen = false;

  function goToPersons() {
    goTo("/contacts/", {});
  }

  function goToSearch() {
    goTo("/contacts/search", {});
  }

  function goToHistory() {
    goTo(URLPart`/contacts/person/${person.id}/history`, { person });
  }

  function onEdit() {
    isEditing = true;
  }

  async function onSave() {
    isEditing = false;
    if (!person.addressbook) {
      person.addressbook = appGlobal.personalAddressbook;
      person.addressbook.persons.add(person);
    }
    await person.save();
  }
</script>
