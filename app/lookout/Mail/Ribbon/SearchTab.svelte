<RibbonTab label={$t`Search`} isSelected>
  <RibbonGroup label={$t`Refine *=> Ribbon group to narrow down the search results`}>
    <RibbonToggleButton label={$t`From`} icon={FromIcon}
      selected={isFrom}
      tooltip={isFrom ? $t`From: ${$searchOptions.person.name}` : $t`Only messages from a person`}
      onClick={() => isFrom ? setPerson(null, false) : pickPerson($t`From`, person => setPerson(person, false))} />
    <RibbonToggleButton label={$t`Has Attachments`} icon={AttachmentIcon}
      selected={$searchOptions.hasAttachment}
      onClick={() => { $searchOptions = { ...$searchOptions, hasAttachment: !$searchOptions.hasAttachment }; }} />
    <RibbonMenuButton label={$t`Categorized *=> Only emails with a certain category`} icon={CategorizeIcon}
      disabled={!$tags.hasItems && $t`There are no categories yet`}>
      <CategoryMenuItems selected={$searchOptions.tags}
        on:select={event => $searchOptions = { ...$searchOptions, tags: [...$searchOptions.tags, event.detail] }}
        on:unselect={event => $searchOptions = { ...$searchOptions, tags: $searchOptions.tags.filter(tag => tag != event.detail) }} />
    </RibbonMenuButton>
    <!-- <RibbonMenuButton label={$searchOptions.received == ReceivedRange.Any || $searchOptions.received == ReceivedRange.Custom ? $t`This Week` : receivedRangeLabel($searchOptions.received)}
      icon={ReceivedIcon}
      tooltip={$t`Received *=> Date when the email was received`}>
      <ReceivedMenuItems selected={$searchOptions.received}
        on:select={event => $searchOptions = { ...$searchOptions, received: event.detail, receivedStart: null, receivedEnd: null }} />
    </RibbonMenuButton> -->
    <RibbonMenuButton label={$t`Sent To *=> Only emails that you sent to a certain person`} icon={SentToIcon} size="small"
      tooltip={isSentTo ? $t`Sent To: ${$searchOptions.person.name}` : $t`Sent To *=> Only emails that you sent to a certain person`}>
      <MenuItem label={$t`Sent To Another Recipient…`} checkable checked={isSentTo}
        onClick={() => pickPerson($t`To`, person => setPerson(person, true))} />
      <MenuItem label={$t`Sent by Me`} checkable checked={isSentByMe}
        onClick={() => $searchOptions = { ...$searchOptions, person: null, isOutgoing: isSentByMe ? null : true }} />
    </RibbonMenuButton>
    <RibbonToggleButton label={$t`Unread *=> State of the message that has not been read`} icon={UnreadIcon} size="small"
      selected={$searchOptions.isRead === false}
      onClick={() => { $searchOptions = { ...$searchOptions, isRead: $searchOptions.isRead === false ? null : false }; }} />
    <RibbonToggleButton label={$t`Flagged *=> State of the email that has been flagged for follow-up`} icon={FlagIcon} size="small"
      selected={$searchOptions.flagged}
      onClick={() => { $searchOptions = { ...$searchOptions, flagged: !$searchOptions.flagged }; }} />
    <RibbonMenuButton label={$t`More *=> More search refiners`} icon={MoreIcon} size="small"
      tooltip={$t`More refiners`}>
      <!-- <SubMenu label={$t`Received *=> Date when the email was received`}>
        <ReceivedMenuItems selected={$searchOptions.received}
          on:select={event => $searchOptions = { ...$searchOptions, received: event.detail, receivedStart: null, receivedEnd: null }} />
      </SubMenu> -->
      <SubMenu label={$t`Size *=> Size of the file`}>
        <SizeMenuItems selected={$searchOptions.size} on:select={event => $searchOptions = { ...$searchOptions, size: event.detail }} />
      </SubMenu>
      <SubMenu label={$t`Read *=> State of the message that has been read`}>
        <MenuItem label={$t`Read *=> State of the message that has been read`} checkable checked={$searchOptions.isRead === true}
          onClick={() => $searchOptions = { ...$searchOptions, isRead: $searchOptions.isRead === true ? null : true }} />
        <MenuItem label={$t`Unread *=> State of the message that has not been read`} checkable checked={$searchOptions.isRead === false}
          onClick={() => $searchOptions = { ...$searchOptions, isRead: $searchOptions.isRead === false ? null : false }} />
      </SubMenu>
      <MenuItem label={$t`Replied *=> State of the email that has been replied to`} checkable checked={$searchOptions.replied}
        onClick={() => $searchOptions = { ...$searchOptions, replied: !$searchOptions.replied }} />
      <MenuDivider />
      <MenuItem label={$t`Advanced Search…`} icon={AdvancedIcon}
        onClick={() => $isAdvancedSearchOpen = true} />
    </RibbonMenuButton>
    {#if $searchOptions.threadID}
      <RibbonToggleButton label={$t`This Conversation`} icon={ConversationIcon} size="small"
        selected
        tooltip={$t`Only messages of the conversation that you chose with Find Related`}
        onClick={() => { $searchOptions = { ...$searchOptions, threadID: null }; }} />
    {/if}
  </RibbonGroup>
  <RibbonGroup label={$t`Scope *=> Ribbon group to choose where to search`}>
    <RibbonToggleButton label={scopeLabel(SearchScope.AllAccounts)} shortLabel={scopeShortLabel(SearchScope.AllAccounts)} icon={AllAccountsIcon}
      selected={scope == SearchScope.AllAccounts}
      onClick={() => { $searchOptions = { ...$searchOptions, scope: SearchScope.AllAccounts }; }}
      shortCutInfo={$t`Ctrl+Alt+A *=> Keyboard shortcut`} />
    <RibbonToggleButton label={scopeLabel(SearchScope.CurrentAccount)} shortLabel={scopeShortLabel(SearchScope.CurrentAccount)} icon={AccountIcon}
      selected={scope == SearchScope.CurrentAccount}
      disabled={!isScopeAvailable(SearchScope.CurrentAccount, account, folder) && $t`Select a folder of an account first`}
      onClick={() => { $searchOptions = { ...$searchOptions, scope: SearchScope.CurrentAccount }; }} />
    <RibbonToggleButton label={scopeLabel(SearchScope.CurrentFolder)} shortLabel={scopeShortLabel(SearchScope.CurrentFolder)} icon={FolderIcon} size="small"
      selected={scope == SearchScope.CurrentFolder}
      disabled={!isScopeAvailable(SearchScope.CurrentFolder, account, folder) && $t`Select a folder of an account first`}
      onClick={() => { $searchOptions = { ...$searchOptions, scope: SearchScope.CurrentFolder }; }}
      shortCutInfo={$t`Ctrl+Alt+K *=> Keyboard shortcut`} />
  </RibbonGroup>
  <RibbonGroup label={$t`Options *=> Ribbon group with more search options`}>
    <RibbonMenuButton label={$t`Search Tools`} shortLabel={$t`Tools *=> Search tools`} icon={SearchToolsIcon}>
      <MenuItem label={$t`Advanced Find…`} icon={AdvancedIcon} shortCutInfo={$t`Ctrl+Shift+F *=> Keyboard shortcut`}
        onClick={() => $isAdvancedSearchOpen = true} />
    </RibbonMenuButton>
    <RibbonButton label={$t`Save as Search Folder`} shortLabel={$t`Save Search *=> Save this search as a search folder`} icon={SaveSearchIcon} size="small"
      tooltip={$t`Save this search as a Search Folder`}
      onClick={onSaveSearch}
      disabled={!search && $t`Type a search term first`} />
    <RibbonButton label={$t`Create Rule`} icon={CreateRuleIcon} size="small"
      tooltip={$t`Handle new messages that match this search automatically`}
      onClick={onCreateRule}
      disabled={(!search && $t`Type a search term first`) || (!ruleAccount && $t`Select a folder of an account first`)} />
  </RibbonGroup>
  <RibbonGroup label={$t`Close`}>
    <RibbonButton label={$t`Close Search`} icon={CloseIcon}
      onClick={() => { dispatch("close"); }} shortCutInfo={$t`Esc *=> Escape key`} />
  </RibbonGroup>
</RibbonTab>

<script lang="ts">
  import type { Folder } from "../../../logic/Mail/Folder";
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import type { Person } from "../../../logic/Abstract/Person";
  import type { SearchEMail } from "../../../logic/Mail/Store/SearchEMail";
  import { availableTags } from "../../../logic/Abstract/Tag";
  import { isRealFolder, isRealAccount, isScopeAvailable, effectiveScope, scopeLabel, scopeShortLabel, SearchScope } from "../Search/MailSearch";
  import { isAdvancedSearchOpen, searchOptions, openSearchPerson, openSaveSearch, openRulesFromSearch } from "../Selected";
  // import { ReceivedRange, receivedRangeLabel } from "../Search/SearchRanges";
  import RibbonTab from "../../Shared/Ribbon/RibbonTab.svelte";
  import RibbonGroup from "../../Shared/Ribbon/RibbonGroup.svelte";
  import RibbonButton from "../../Shared/Ribbon/RibbonButton.svelte";
  import RibbonToggleButton from "../../Shared/Ribbon/RibbonToggleButton.svelte";
  import RibbonMenuButton from "../../Shared/Ribbon/RibbonMenuButton.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import MenuDivider from "../../Shared/Menu/MenuDivider.svelte";
  import SubMenu from "../../Shared/Menu/SubMenu.svelte";
  import CategoryMenuItems from "../Search/CategoryMenuItems.svelte";
  // import ReceivedMenuItems from "../Search/ReceivedMenuItems.svelte";
  import SizeMenuItems from "../Search/SizeMenuItems.svelte";
  import FromIcon from "lucide-svelte/icons/user-round";
  import AttachmentIcon from "lucide-svelte/icons/paperclip";
  import CategorizeIcon from "lucide-svelte/icons/tags";
  // import ReceivedIcon from "lucide-svelte/icons/calendar-range";
  import SentToIcon from "lucide-svelte/icons/send";
  import UnreadIcon from "lucide-svelte/icons/mail";
  import FlagIcon from "lucide-svelte/icons/flag";
  import MoreIcon from "lucide-svelte/icons/plus";
  import AdvancedIcon from "lucide-svelte/icons/sliders-horizontal";
  import ConversationIcon from "lucide-svelte/icons/messages-square";
  import AllAccountsIcon from "lucide-svelte/icons/mails";
  import AccountIcon from "lucide-svelte/icons/inbox";
  import FolderIcon from "lucide-svelte/icons/folder";
  import SearchToolsIcon from "lucide-svelte/icons/wrench";
  import SaveSearchIcon from "lucide-svelte/icons/folder-search";
  import CreateRuleIcon from "lucide-svelte/icons/list-plus";
  import CloseIcon from "lucide-svelte/icons/x";
  import { t } from "../../../l10n/l10n";
  import { createEventDispatcher } from "svelte";

  export let account: MailAccount | null = null;
  export let folder: Folder | null = null;
  export let search: SearchEMail | null = null;

  const dispatch = createEventDispatcher<{ close: void }>();

  const tags = availableTags;
  $: scope = effectiveScope($searchOptions, account, folder);
  $: isFrom = !!$searchOptions.person && $searchOptions.isOutgoing !== true;
  // <copied to="../LeftPane/FilterMenuItems.svelte">
  $: isSentTo = !!$searchOptions.person && $searchOptions.isOutgoing === true;
  $: isSentByMe = !$searchOptions.person && $searchOptions.isOutgoing === true;
  // </copied>

  function pickPerson(fieldLabel: string, onPick: (person: Person) => void) {
    $openSearchPerson = { fieldLabel, person: $searchOptions.person, onPick };
    // The From toggle shows as pressed only once the person is picked
    $searchOptions = { ...$searchOptions };
  }

  function setPerson(person: Person | null, isOutgoing: boolean) {
    $searchOptions = person
      ? { ...$searchOptions, person, isOutgoing }
      : { ...$searchOptions, person: null, isOutgoing: null };
  }

  function onSaveSearch() {
    $openSaveSearch = search;
  }

  $: ruleAccount = search?.account ??
    (isRealFolder(folder) ? folder.account : isRealAccount(account) ? account : null);
  function onCreateRule() {
    $openRulesFromSearch = search;
  }
</script>
