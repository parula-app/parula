<RibbonTab label={$t`Home *=> Ribbon tab with the most-used commands`}>
  <RibbonGroup label={$t`New`}>
    <RibbonButton label={$t`New Email`} icon={NewMailIcon}
      onClick={() => mailMustangApp.writeMail(MessageActions.accountForNewMail(folder).newEMailFrom())}
      disabled={!$accounts.hasItems && $t`Please set up a mail account first`}
      shortCutInfo={$t`Ctrl+N *=> Keyboard shortcut`} />
    <RibbonMenuButton label={$t`New Items`} icon={NewItemsIcon}>
      <MenuItem label={$t`Email Message`} icon={NewMailIcon} shortCutInfo={$t`Ctrl+Shift+M *=> Keyboard shortcut`}
        onClick={() => mailMustangApp.writeMail(MessageActions.accountForNewMail(folder).newEMailFrom())} />
      <NewEventSubMenu label={$t`Appointment *=> Create a new appointment in the calendar`} icon={AppointmentIcon} shortCutInfo={$t`Ctrl+Shift+A *=> Keyboard shortcut`}
        onCreate={calendar => createNewEvent(calendar ?? get(selectedCalendar), new Date(), false)} />
      <NewEventSubMenu label={$t`Meeting`} icon={MeetingIcon} shortCutInfo={$t`Ctrl+Shift+Q *=> Keyboard shortcut`}
        onCreate={calendar => MessageActions.newMeeting(calendar)} />
      <MenuItem label={$t`Contact *=> Create a new contact`} icon={ContactIcon} shortCutInfo={$t`Ctrl+Shift+C *=> Keyboard shortcut`}
        onClick={() => MessageActions.newContact()} />
      <MenuItem label={$t`Contact Group`} icon={ContactGroupIcon} shortCutInfo={$t`Ctrl+Shift+L *=> Keyboard shortcut`}
        onClick={() => ContactActions.newGroup(null)} />
    </RibbonMenuButton>
  </RibbonGroup>
  <RibbonGroup label={$t`Delete`}>
    <RibbonMenuButton label={$t`Junk *=> Menu to mark the selected emails as junk or not junk`} icon={JunkIcon} size="small" disabled={noSelection}>
      <JunkMenuItems {messages} />
    </RibbonMenuButton>
    <RibbonButton label={$t`Delete`} icon={DeleteIcon}
      onClick={async () => { await Promise.all(messages.map(message => message.deleteMessage())); }}
      disabled={noSelection} shortCutInfo={$t`Del *=> Delete key`} />
    <RibbonButton label={$t`Archive`} icon={ArchiveIcon}
      onClick={() => MessageActions.archive(messages)}
      disabled={noSelection} shortCutInfo={$t`Backspace *=> Backspace key`} />
  </RibbonGroup>
  <RibbonGroup label={$t`Respond *=> Ribbon group with commands to reply to or forward the email`}>
    <RibbonButton label={$t`Reply`} icon={ReplyIcon} size="small"
      onClick={() => MessageActions.respond(single, single.compose.replyToAuthor())}
      disabled={noSingle} shortCutInfo={$t`Ctrl+R *=> Keyboard shortcut`} />
    <RibbonButton label={$t`Reply All`} icon={ReplyAllIcon} size="small"
      onClick={() => MessageActions.respond(single, single.compose.replyAll())}
      disabled={noSingle || (!(single.allRecipients().length > 1 && !(single.bcc.hasItems && !single.outgoing)) && $t`There are no other recipients`)}
      shortCutInfo={$t`Ctrl+Shift+R *=> Keyboard shortcut`} />
    <RibbonButton label={$t`Forward`} icon={ForwardIcon} size="small"
      onClick={event => MessageActions.forward(single, event as MouseEvent)}
      disabled={noSingle} shortCutInfo={$t`Ctrl+F *=> Keyboard shortcut`} />
    <RibbonMenuButton label={$t`More *=> More commands to respond to the selected email`} icon={MoreRespondIcon} size="small" disabled={noSingle}>
      <MenuItem label={$t`Forward as Attachment`} icon={ForwardAttachmentIcon}
        shortCutInfo={$t`Ctrl+Alt+F *=> Keyboard shortcut`}
        onClick={async () => mailMustangApp.writeMail(await single.compose.forwardAsAttachment())} />
      <MenuItem label={$t`Redirect`} icon={RedirectIcon}
        tooltip={$t`Send this message to somebody else, who can reply to the original sender`}
        onClick={async () => mailMustangApp.writeMail(await single.compose.redirect())} />
      <MenuItem label={$t`Edit as New`} icon={EditAsNewIcon}
        tooltip={$t`Create a new message with the same content and recipients`}
        onClick={async () => mailMustangApp.writeMail(await single.compose.editAsNew())} />
      <MenuItem label={$t`New Topic to All`} icon={NewToAllIcon}
        tooltip={$t`Send a new, unrelated message to all recipients`}
        onClick={() => mailMustangApp.writeMail(single.compose.newToAll())} />
    </RibbonMenuButton>
  </RibbonGroup>
  <RibbonGroup label={$t`Move`}>
    <RibbonButton label={$t`Move`} icon={MoveIcon} disabled={noSelection}
      tooltip={$t`Move the selected messages to another folder`} shortCutInfo={$t`Ctrl+Shift+V *=> Keyboard shortcut`}
      onClick={() => { $openMoveMessages = { messages, copy: false }; }} />
    <RibbonButton label={$t`Copy`} icon={CopyIcon} size="small" disabled={noSelection}
      tooltip={$t`Copy the selected messages to another folder`} shortCutInfo={$t`Ctrl+Shift+Y *=> Keyboard shortcut`}
      onClick={() => { $openMoveMessages = { messages, copy: true }; }} />
    <RibbonMenuButton label={$t`Rules *=> Criteria after which emails should be sorted`} icon={RulesIcon} size="small">
      <RulesMenuItems message={single} account={realAccount} />
    </RibbonMenuButton>
  </RibbonGroup>
  <RibbonGroup label={$t`Tags`}>
    <RibbonButton label={$t`Unread/ Read *=> Mark the selected emails as read or unread`} icon={shouldMarkRead ? ReadIcon : UnreadIcon} size="small"
      tooltip={shouldMarkRead ? $t`Mark as Read` : $t`Mark as Unread`}
      onClick={async () => { await Promise.all(messages.map(message => message.markRead(shouldMarkRead))); }}
      disabled={noSelection} shortCutInfo={shouldMarkRead ? $t`Ctrl+Alt+U *=> Keyboard shortcut` : $t`Ctrl+U *=> Keyboard shortcut`} />
    <RibbonMenuButton label={$t`Categorize *=> Assign a category to the selected emails`} icon={CategorizeIcon} size="small" disabled={noSelection}>
      <CategorizeMenuItems {messages} />
    </RibbonMenuButton>
    <RibbonMenuButton label={$t`Follow Up *=> Flag the selected emails for follow-up`} icon={FlagIcon} size="small" disabled={noSelection}>
      <FollowUpMenuItems {messages} />
    </RibbonMenuButton>
  </RibbonGroup>
  <RibbonGroup label={$t`Find *=> Ribbon group with search commands`}>
    {#if !isSimplified}
      <RibbonTextBox label={$t`Search People`} placeholder={$t`Search People`} icon={SearchPeopleIcon}
        width="150px"
        bind:value={peopleSearch}
        bind:isListOpen={isPeopleListOpen}
        on:input={() => { isPeopleListOpen = !!peopleMatches.length; }}
        on:enter={openFirstPerson}>
        <svelte:fragment slot="list">
          {#each peopleMatches as person (person)}
            <MenuItem label={person.name || person.emailAddresses.first?.value} icon={ContactIcon}
              tooltip={person.emailAddresses.first?.value}
              onClick={() => openPerson(person)} />
          {:else}
            <MenuItem label={$t`No matches`} disabled />
          {/each}
        </svelte:fragment>
      </RibbonTextBox>
    {/if}
    <RibbonButton label={$t`Address Book`} icon={AddressBookIcon} size="small"
      onClick={() => openApp(contactsMustangApp, {})} shortCutInfo={$t`Ctrl+Shift+B *=> Keyboard shortcut`} />
    <RibbonMenuButton label={$t`Filter Email *=> Show only the emails that match a condition`} icon={FilterIcon} size="small">
      <FilterMenuItems />
    </RibbonMenuButton>
  </RibbonGroup>
  <RibbonGroup label={$t`Send/Receive *=> Ribbon group with commands to send and get emails`}>
    <RibbonButton label={$t`Send/Receive All Folders`} shortLabel={$t`Send/Receive *=> Send and get the emails of all folders`} icon={SendReceiveIcon}
      tooltip={$t`Send/Receive All Folders`}
      onClick={() => MessageActions.sendReceiveAll()}
      disabled={!$accounts.hasItems && $t`Please set up a mail account first`}
      shortCutInfo="F9" />
  </RibbonGroup>
</RibbonTab>

<script lang="ts">
  import type { EMail } from "../../../logic/Mail/EMail";
  import type { Folder } from "../../../logic/Mail/Folder";
  import type { MailAccount } from "../../../logic/Mail/MailAccount";
  import { appGlobal } from "../../../logic/app";
  import { MessageActions } from "../MessageActions";
  import { openMoveMessages } from "../Message/MessageMovePopup.svelte";
  import RibbonTab from "../../Shared/Ribbon/RibbonTab.svelte";
  import RibbonGroup from "../../Shared/Ribbon/RibbonGroup.svelte";
  import RibbonButton from "../../Shared/Ribbon/RibbonButton.svelte";
  import RibbonMenuButton from "../../Shared/Ribbon/RibbonMenuButton.svelte";
  import RibbonTextBox from "../../Shared/Ribbon/RibbonTextBox.svelte";
  import type { RibbonLayout } from "../../Shared/Ribbon/RibbonGroup";
  import { ContactActions } from "../../Contacts/ContactActions";
  import { searchPersons } from "../Composer/SelectNames";
  import type { Person } from "../../../logic/Abstract/Person";
  import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
  import JunkMenuItems from "../Message/JunkMenuItems.svelte";
  import FollowUpMenuItems from "../Message/FollowUpMenuItems.svelte";
  import RulesMenuItems from "../Rules/RulesMenuItems.svelte";
  import CategorizeMenuItems from "../Message/CategorizeMenuItems.svelte";
  import FilterMenuItems from "../LeftPane/FilterMenuItems.svelte";
  import MenuItem from "../../Shared/Menu/MenuItem.svelte";
  import NewEventSubMenu from "../../Calendar/NewEventSubMenu.svelte";
  import NewMailIcon from "lucide-svelte/icons/mail-plus";
  import NewItemsIcon from "lucide-svelte/icons/square-plus";
  import AppointmentIcon from "lucide-svelte/icons/calendar-plus";
  import MeetingIcon from "lucide-svelte/icons/users-round";
  import ContactIcon from "lucide-svelte/icons/user-round-plus";
  import ContactGroupIcon from "lucide-svelte/icons/users";
  import SearchPeopleIcon from "lucide-svelte/icons/user-search";
  import DeleteIcon from "lucide-svelte/icons/trash-2";
  import ArchiveIcon from "lucide-svelte/icons/archive";
  import JunkIcon from "lucide-svelte/icons/shield-x";
  import ReplyIcon from "lucide-svelte/icons/reply";
  import ReplyAllIcon from "lucide-svelte/icons/reply-all";
  import ForwardIcon from "lucide-svelte/icons/forward";
  import MoreRespondIcon from "lucide-svelte/icons/message-square-more";
  import ForwardAttachmentIcon from "lucide-svelte/icons/paperclip";
  import RedirectIcon from "lucide-svelte/icons/move-right";
  import EditAsNewIcon from "lucide-svelte/icons/iteration-ccw";
  import NewToAllIcon from "lucide-svelte/icons/users-round";
  import MoveIcon from "lucide-svelte/icons/folder-input";
  import CopyIcon from "lucide-svelte/icons/copy";
  import RulesIcon from "lucide-svelte/icons/list-filter";
  import ReadIcon from "lucide-svelte/icons/mail-open";
  import UnreadIcon from "lucide-svelte/icons/mail";
  import CategorizeIcon from "lucide-svelte/icons/tag";
  import FlagIcon from "lucide-svelte/icons/flag";
  import AddressBookIcon from "lucide-svelte/icons/book-user";
  import FilterIcon from "lucide-svelte/icons/funnel";
  import SendReceiveIcon from "lucide-svelte/icons/refresh-cw";
  import { t } from "../../../l10n/l10n";
  import { contactsMustangApp } from "../../../frontend/Contacts/ContactsMustangApp";
  import { createNewEvent } from "../../../frontend/Calendar/event";
  import { get } from "svelte/store";
  import { mailMustangApp } from "../../../frontend/Mail/MailMustangApp";
  import { openApp } from "../../../frontend/AppsBar/selectedApp";
  import { selectedCalendar } from "../../../frontend/Calendar/selected";

  export let messages: EMail[] = [];
  export let folder: Folder | null = null;
  export let account: MailAccount | null = null;

  const accounts = appGlobal.emailAccounts;

  $: single = messages.length == 1 ? messages[0] : null;
  $: noSelection = !messages.length && $t`Select a message first`;
  $: noSingle = !single && (messages.length ? $t`Select only one message` : $t`Select a message first`);
  $: isJunk = MessageActions.isJunk(messages);
  const ribbonLayout = getLocalStorage<RibbonLayout>("lookout.ribbon.layout", "classic");
  $: isSimplified = $ribbonLayout.value == "simplified";

  let peopleSearch = "";
  let isPeopleListOpen = false;
  $: peopleMatches = peopleSearch.trim().length >= 2
    ? searchPersons(appGlobal.addressbooks, peopleSearch.trim()).contents.slice(0, 8)
    : [];

  function openPerson(person: Person) {
    isPeopleListOpen = false;
    peopleSearch = "";
    ContactActions.edit(person);
  }

  function openFirstPerson() {
    if (peopleMatches.length) {
      openPerson(peopleMatches[0]);
    }
  }
  $: shouldMarkRead = !messages.length || !messages.every(message => message.isRead);
  $: realAccount = account && appGlobal.emailAccounts.contains(account) ? account : null;
</script>
