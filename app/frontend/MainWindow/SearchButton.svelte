<Clickable onClick={onSearchToggle} tooltip={$globalSearchTerm || $t`Search`}>
  <hbox class="search-button" class:active={$globalSearchTerm} bind:this={searchE}>
    <SearchIcon size="20px" />
    <Popup bind:popupOpen={showSearchField} popupAnchor={searchE} placement="right-start" boundaryElSel="body">
      <hbox class="search-popup" on:keydown={onKeyDown}>
        <SearchField bind:searchTerm={$globalSearchTerm} autofocus
          on:clear={() => showSearchField = false} />
      </hbox>
    </Popup>
  </hbox>
</Clickable>

<script lang="ts">
  import { globalSearchTerm } from "../AppsBar/selectedApp";
  import SearchField from "../Shared/SearchField.svelte";
  import Popup from "../Shared/Popup.svelte";
  import Clickable from "../Shared/Clickable.svelte";
  import SearchIcon from "lucide-svelte/icons/search";
  import { t } from "../../l10n/l10n";

  let searchE: HTMLDivElement;
  let showSearchField = false;
  function onSearchToggle() {
    showSearchField = !showSearchField;
  }

  /** The search stays active after Enter. The app shows the results. */
  function onKeyDown(event: KeyboardEvent) {
    if (event.key == "Enter") {
      showSearchField = false;
    }
  }
</script>

<style>
  .search-button {
    width: 28px;
    height: 28px;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
  }
  .search-button:hover {
    background-color: var(--hover-bg);
  }
  .search-button.active {
    color: var(--selected-bg);
  }
  .search-button :global(.popup) {
    border-radius: 100px;
  }
  .search-popup {
    width: 320px;
    padding: 6px;
    border-radius: 100px;
    background-color: var(--main-bg);
  }
  .search-popup :global(.search) {
    flex: 1 0 0;
  }
</style>
