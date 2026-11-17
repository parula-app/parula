<hbox class="buttons">
  <AppBarM>
    <!-- left -->
    <hbox class="persons">
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
    <hbox class="person">
      <Button
        icon={PersonIcon}
        iconSize="24px"
        iconOnly
        label={person.name}
        onClick={goToPerson}
        plain
        />
    </hbox>

    <AppMenuButton />

    <!-- right middle -->
    <hbox class="empty" />

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
  import PersonsIcon from "lucide-svelte/icons/users";
  import PersonIcon from "lucide-svelte/icons/user";
  import { URLPart } from "../../logic/util/blob";
  import { t } from "../../l10n/l10n";

  export let person: Person;

  let isMenuOpen = false;

  function goToPersons() {
    goTo("/contacts/", {});
  }

  function goToPerson() {
    goTo(URLPart`/contacts/person/${person.id}/edit`, { person });
  }
</script>
