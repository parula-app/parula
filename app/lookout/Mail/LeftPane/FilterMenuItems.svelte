<MenuItem label={$t`Unread *=> State of the message that has not been read`} icon={UnreadIcon} checkable checked={isUnread}
  onClick={() => toggleQuickFilter(QuickFilter.Unread)} />
<MenuItem label={$t`Has Attachments`} icon={AttachmentIcon} checkable checked={hasAttachments}
  onClick={() => toggleQuickFilter(QuickFilter.Attachments)} />
<!-- <SubMenu label={$t`This Week`} icon={ReceivedIcon}>
  <ReceivedMenuItems selected={$searchOptions.received}
    on:select={event => searchInFolder({ received: event.detail, receivedStart: null, receivedEnd: null })} />
</SubMenu> -->
<SubMenu label={$t`Categorized *=> Only emails with a certain category`} icon={CategorizeIcon}
  disabled={!$tags.hasItems && $t`There are no categories yet`}>
  <CategoryMenuItems selected={$searchOptions.tags}
    on:select={event => searchInFolder({ tags: [...$searchOptions.tags, event.detail] })}
    on:unselect={event => searchInFolder({ tags: $searchOptions.tags.filter(tag => tag != event.detail) })} />
</SubMenu>
<MenuItem label={$t`Flagged *=> State of the email that has been flagged for follow-up`} icon={FlagIcon} checkable checked={isFlagged}
  onClick={() => toggleQuickFilter(QuickFilter.Flagged)} />
<SubMenu label={$t`Sent To *=> Only emails that you sent to a certain person`} icon={SentToIcon}>
  <MenuItem label={$t`Sent To Another Recipient…`} checkable checked={isSentTo}
    onClick={onSentTo} />
  <MenuItem label={$t`Sent by Me`} checkable checked={isSentByMe}
    onClick={() => searchInFolder({ person: null, isOutgoing: isSentByMe ? null : true })} />
</SubMenu>
<MenuItem label={$t`More Filters…`} icon={MoreFiltersIcon}
  onClick={moreFilters} />
{#if hasFilter}
  <MenuDivider />
  <MenuItem label={$t`Clear Filter`} icon={ClearIcon}
    onClick={clearFilter} />
{/if}

<script lang="ts">
  import { availableTags } from "../../../logic/Abstract/Tag";
  import { quickSearch } from "../../../frontend/Mail/Selected";
  import { globalSearchTerm } from "../../../frontend/AppsBar/selectedApp";
  import { hasSearchCriteria, isQuickFilterActive, toggleQuickFilter, searchInFolder, QuickFilter } from "../MailFilters";
  import { defaultSearchOptions } from "../Search/MailSearch";
  import { isAdvancedSearchOpen, searchOptions } from "../Selected";
  import { openSearchPerson } from "../Search/SearchPersonDialog.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import SubMenu from "../../Shared/Menu/SubMenu.svelte";
  // import ReceivedMenuItems from "../Search/ReceivedMenuItems.svelte";
  import CategoryMenuItems from "../Search/CategoryMenuItems.svelte";
  import UnreadIcon from "lucide-svelte/icons/mail";
  import AttachmentIcon from "lucide-svelte/icons/paperclip";
  // import ReceivedIcon from "lucide-svelte/icons/calendar-range";
  import CategorizeIcon from "lucide-svelte/icons/tags";
  import FlagIcon from "lucide-svelte/icons/flag";
  import SentToIcon from "lucide-svelte/icons/send";
  import MoreFiltersIcon from "lucide-svelte/icons/sliders-horizontal";
  import ClearIcon from "lucide-svelte/icons/funnel-x";
  import { t } from "../../../l10n/l10n";

  const tags = availableTags;
  // <copied from="../Ribbon/SearchTab.svelte">
  $: isSentTo = !!$searchOptions.person && $searchOptions.isOutgoing === true;
  $: isSentByMe = !$searchOptions.person && $searchOptions.isOutgoing === true;
  // </copied>
  $: $quickSearch, $searchOptions, $globalSearchTerm, updateStates();
  let isUnread = false;
  let hasAttachments = false;
  let isFlagged = false;
  let hasFilter = false;
  function updateStates() {
    isUnread = isQuickFilterActive(QuickFilter.Unread);
    hasAttachments = isQuickFilterActive(QuickFilter.Attachments);
    isFlagged = isQuickFilterActive(QuickFilter.Flagged);
    hasFilter = quickSearch.hasSearch() || hasSearchCriteria();
  }

  function moreFilters() {
    if (!hasSearchCriteria()) {
      searchInFolder({});
    }
    $isAdvancedSearchOpen = true;
  }

  // <copied from="FolderHeader.svelte">
  function clearFilter() {
    quickSearch.reset();
    if (hasSearchCriteria()) {
      $globalSearchTerm = null;
      $searchOptions = { ...defaultSearchOptions(), scope: $searchOptions.scope };
    }
  }
  // </copied>

  function onSentTo() {
    $openSearchPerson = {
      fieldLabel: $t`To`,
      person: isSentTo ? $searchOptions.person : null,
      onPick: person => person && searchInFolder({ person, isOutgoing: true }),
    };
  }
</script>
