<Clickable onClick={onSearchToggle} tooltip={$globalSearchTerm || $t`Search`}>
  <hbox class="search-button" class:active={$globalSearchTerm} bind:this={searchE}>
    <SearchIcon size="20px" />
    <Popup bind:popupOpen={showSearchField} popupAnchor={searchE} placement="right-start" boundaryElSel="body">
      <hbox class="search-popup" on:keydown={event => onKeyEnter(event, () => { showSearchField = false; })}> <!-- Enter closes the field, but keeps the search -->
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
  import { onKeyEnter } from "../Util/util";
  import { t } from "../../l10n/l10n";

  let searchE: HTMLDivElement;
  /** Only to start a search. While there is a search,
   * the app shows it, e.g. Calendar in its list view with a search field. */
  let showSearchField = false;
  function onSearchToggle() {
    showSearchField = !showSearchField;
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
