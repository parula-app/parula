# Lookout: Missing functionality

Lookout is an Outlook look-alike frontend for Mustang. It uses Mustang's logic (`app/logic/`) unchanged, the same way `app/frontend/` does. Where Outlook has a feature that the logic does not support, Lookout leaves the command out instead of building new functionality.

This file lists those Outlook features, so that they can be planned as logic work. Each entry says where the feature is in Outlook and what the logic would need. Entries marked *UI only* already have what they need in the logic and only lack the Lookout UI.

Features that belong to Microsoft services and don't apply to Mustang are not listed: Notes, Groups and Bookings apps, Office Account, Feedback, Teams meeting options, Loop components, Meeting Notes, Dictate, Immersive Reader, Share to Teams and Send to OneNote.

## Window and ribbon

| Outlook feature | Where in Outlook | What the logic would need |
|---|---|---|
| Undo / Redo of delete, move, mark read, flag, and of event and contact changes | Quick Access Toolbar; Ctrl+Z | An undo stack for mail, calendar and contact actions |
| Tasks (To Do) and the "My Day" pane | Navigation rail; title bar | Task objects and task accounts (CalDAV VTODO, EWS / Graph tasks). The agenda part of My Day is *UI only*. |
| Recent searches and "Top results" suggestions | Title bar search box; Search tab > Recent Searches (Mail, People) | A search history. Lookout suggests people from the address books. |
| Pop-out windows: a message, the composer or a form in its own window | Double-click a message; Pop Out | Multi-window support in the desktop app and in the frontend router |
| Sync summary ("All folders are up to date", "Synchronizing *folder*", "Connected to Microsoft Exchange") | Status bar | An aggregated sync state per account: in progress, last sync time, errors. Lookout shows the syncs that it started itself, and the connection state. |
| Storage quota bar ("*x* GB free"), Mailbox Cleanup | File > Info; status bar | Quota queries (IMAP QUOTA, EWS, Graph) on `MailAccount` |
| Account manager in the title bar: profile picture, sign out, switch account | Title bar | Pictures for all account types; a logout API for every account type |
| Unread count on the taskbar or tray icon | Taskbar | Wiring the desktop backend's `setBadgeCount()` / `setTrayIcon()` to the unread counts |
| Zoom slider | Status bar | A zoom / text scale setting that the frontend applies |
| Notification center (bell) with a history of reminders and notifications | Title bar | *UI only*. Notifications exist, Lookout shows them as a bar. |
| Customize Ribbon beyond showing and hiding: new tabs and groups, adding, moving and renaming commands, reordering, Import/Export of customizations; the Customize Ribbon and Quick Access Toolbar pages of the Options dialog | File > Options > Customize Ribbon | *UI only*, but it needs a command model: Lookout's ribbon commands are components with their own state and can't be placed elsewhere. Lookout's Customize the Ribbon (right-click the ribbon, or View > Ribbon > Customize Ribbon…) shows and hides tabs and groups. |

## Mail

Folder pane, message list, reading pane, and the Home, Send / Receive, Folder, View and Search tabs.

| Outlook feature | Where in Outlook | What the logic would need |
|---|---|---|
| Editable Favorites (add and remove folders, drag a folder to Favorites); unified Deleted Items | Folder pane; Folder tab > Favorites | A stored list of favorite folders across accounts; a unified Trash in `AllAccounts.specialFolders`. Lookout shows the fixed unified Inbox, Sent and Drafts. |
| Custom folder order (dragging folders up and down), and with it "Show All Folders A to Z" / "Sort Subfolders A to Z" | Folder tab > Clean Up; folder context menu | A stored folder order per account. Mustang always lists the default folders first and the others A to Z. |
| Copy Folder; moving a folder to the top level of the account | Folder tab; folder context menu; dragging a folder | A recursive `Folder.copyFolderHere()`; `MailAccount.moveFolderHere()` for the top level |
| Empty Folder for any folder | Folder context menu | `Folder.empty()` on the server (IMAP expunge, EWS EmptyFolder). Lookout offers "Delete All" in Trash and Junk only, like `frontend/`. |
| Clean Up Folder / Conversation, Ignore Conversation | Home tab > Delete | Detection of redundant quoted messages in a thread; a per-thread ignore list applied to new mail |
| Recover Deleted Items, AutoArchive, retention policies | Folder tab | Exchange recoverable items; an archive policy engine |
| More Search Folder templates: unread or flagged, important, sent directly to me, from (only) specific people, old mail, words in the subject; date criteria in custom Search Folders | Folder tab > New Search Folder | OR-combined, importance, "to me only", sender-only and subject-only criteria in `SearchEMail`; dates in saved searches (the stored search ignores `sentDateMin` / `sentDateMax`). Lookout offers unread, flagged, from and to specific people, categorized, large, with attachments, with specific words and custom Search Folders. |
| IMAP folder subscriptions, Purge, Download Headers, Process Marked Headers | Folder tab > IMAP; Send / Receive tab | Subscription management and a header-only mode in the IMAP logic |
| Focused Inbox (Focused / Other) | Message list | Message classification per account |
| Conversations that include messages from other folders (e.g. own replies in Sent Items, "Show Messages from Other Folders"), actions on a whole conversation | View tab > Messages | A thread index across folders. Lookout groups by `threadID` within the folder, and actions apply to the selected messages. |
| Arrange by To, Categories, Attachments, Account, Type, flag dates | View tab > Arrange By | These fields as main properties of all messages (`SQLEMail.readAllMainProperties()`) |
| Low importance | Message list; reading pane; composer | A three-state importance in `EMail` (today the boolean `isImportant`) |
| Follow-up flags with dates (Today, Tomorrow, This Week, Next Week, Custom), reminders, Mark Complete, the "Follow up" InfoBar | Home tab > Follow Up; flag on hover | Flag start, due and completed dates and reminders in `EMail`. Lookout's Follow Up menu offers No Date and Clear Flag (`markStarred`). |
| Pin, Snooze | Hover actions (new Outlook) | A pinned state and a snooze time per message |
| Block Sender, Never Block Sender / Domain, Safe Senders, always download pictures from a sender, Report Phishing | Home tab > Junk; Report; Pictures InfoBar | Blocked and safe sender lists, ideally synced with the server; a reporting service. Lookout's Junk menu offers Mark as Junk / Not Junk, and "Download pictures" for the shown message. |
| Quick Steps, Sweep | Home tab | Stored action macros; bulk actions by sender |
| Rename categories, category shortcut keys, Quick Click | Categorize > All Categories | Renaming tags, which the servers store by name; a shortcut key per tag. Lookout's Color Categories dialog adds, deletes and recolors categories. |
| "You forwarded this message on *date*" with the date | Reading pane InfoBar | A forward timestamp, or a way to find the forwarded copy, like `EMail.findMyReply()` does for replies. Today there is only the boolean `isForwarded`. Lookout shows the date of the reply and opens it on click, when it finds the reply in the folders. |
| "External" sender tag, "*X* on behalf of *Y*" | Reading pane header | The organization's domains per account; separate `sender` and `from` in `EMail` |
| Profile card of the sender (organization, files, meetings) | Click on the sender | Directory lookups (GAL, Graph) |
| Previews of Office and PDF attachments; Save All Attachments into one chosen folder | Attachment card | File previewers; saving several files into a folder that the user picks once. Lookout's Save All Attachments… asks for each file. |
| Translate, Read Aloud | Home tab; message menu | A translation service (`MessageMenu.translate()` throws `NotImplemented`); text to speech |
| Reactions on mail | Reading pane (new Outlook) | `setMyReactionOnServer()` for mail protocols (it exists only for chat) |
| "Mark item as read when selection changes", single-key reading with the space bar | View > Reading Pane > Options | A "mark when leaving" mode for `mail.read.after`. Space bar paging is *UI only*. |
| Forward several messages as attachments at once | Home tab > Respond > More | `forwardAsAttachment()` for a list of messages |
| Reply with Meeting | Home tab > Respond | Creating an event from a message |
| Drag a message to the desktop, or onto Calendar or People in the navigation rail | Message list | `.eml` drag-out from Electron; creating an `Event` or `Person` from an `EMail` |
| "Click here to view it in a web browser" | Reading pane InfoBar | Writing the HTML to a temporary file and opening the system browser |
| Save As `.msg` / `.txt` / `.html`; Sensitivity and the delivery options in Message Properties | File > Save As; File > Info > Properties | Exporters; sensitivity and delivery properties in `EMail`. Lookout saves `.eml`, and its Properties dialog shows the Internet headers and sets the importance. |
| Find Related > Messages from Sender, also for unknown senders and for "from" only | Message context menu | A free-text sender criterion in `SearchEMail`. `includesPerson` needs a `Person` and also matches recipients. |
| Folder permissions: the permission level of existing grants, the people with access per folder, the roles Owner, Publishing Editor, Author, Contributor, None, "Default" and "Anonymous" | Folder Properties > Permissions | Reading the granted access of each person and folder (`getSharedPersons()` returns only the persons, for the whole account), and more access levels. Lookout's Permissions tab grants Reviewer, Editor or custom rights per folder or for all folders, and removes access. |
| Send All (Outbox), Send / Receive Groups, Show Progress, Cancel All, Work Offline | Send / Receive tab | A send queue, sync schedules per account, progress and cancellation, an offline mode |
| Search query syntax (`from:`, `subject:`, `received:`) | Search box | A query parser for `SearchEMail` |
| Search scopes "Subfolders" and "All Outlook Items" | Search tab > Scope | `SearchEMail` over a folder subtree; search across apps |
| Search refiners and filters: From / Sent To as free text, Subject only, Important, Mentioned, To me / Cc me, Has calendar invites | Search tab > Refine; Home tab > Filter Email; Filter menu above the message list | These criteria in `SearchEMail`, `QuickSearchEMail` and `SQLSearchEMail` |
| Received date refiner (Today, Yesterday, This Week … Last Year, Custom Dates), the Received dates in Advanced Find | Search tab > Refine > Received and More > Received; Home tab > Filter Email > This Week; Advanced Find | `SQLSearchEMail` filtering by `sentDateMin` / `sentDateMax` (it ignores them now); for saved searches, a relative date range in `SearchEMail` (e.g. "this week"), which moves along with the current day. The date UI is commented out in `Mail/Ribbon/SearchTab.svelte`, `Mail/LeftPane/FilterMenuItems.svelte`, `Mail/Search/SearchCriteria.svelte` (with `SearchFolderCriteriaDialog.svelte`) and `Mail/Search/AdvancedSearchDraft.ts`. |
| Conditional Formatting, Format Columns, Manage Views, Save Current View as a New View | View tab > Current View; View Settings | Conditional formatting needs a rule engine; the others are *UI only* |

## Composer

New message, reply and forward, with the Message, Insert, Options and Format Text tabs.

| Outlook feature | Where in Outlook | What the logic would need |
|---|---|---|
| Automatic saving of drafts, "Draft saved at *time*" | File > Options > Mail > Save messages | A save timer around `ComposeActions.saveAsDraft()`. Lookout keeps an inline reply in memory while another message is selected, and Ctrl+S saves it to Drafts. |
| Saving drafts of encrypted messages | Save; "Save changes?" on close | Encryption before `saveAsDraft()`, which asserts `!shouldEncrypt` today. Lookout disables Save and says why. |
| High / Low Importance for outgoing mail | Message tab > Tags | Writing `Importance` / `X-Priority` (MIME) and the EWS / Graph importance when sending. `isImportant` is only read. |
| Follow Up flag for me or for recipients | Message tab > Tags | Flag dates (see Mail) and the flag in the sent message |
| Delivery receipt, read receipt | Options tab > Tracking | DSN and `Disposition-Notification-To`, the EWS receipt flags, and handling of incoming receipt requests |
| Voting buttons | Options tab > Tracking | Exchange voting properties |
| Delay Delivery, Schedule Send | Options tab > More Options; Send menu | An outbox with send times, or EWS `DeferredSendTime` |
| Direct Replies To, Save Sent Item To | Options tab > More Options | A per-message `replyTo` and sent folder in `send()` |
| Sensitivity (Private, Confidential), Do Not Forward, sensitivity labels | Options tab; Message tab | A sensitivity header; rights management |
| HTML / Plain Text / Rich Text per message | Format Text tab > Format | A per-message override of the `mail.send.format` setting in `CreateMIME` and the protocol senders; RTF / TNEF for Rich Text |
| Several named signatures per account (New, Rename, Delete), "Choose default signature" for new messages and for replies / forwards, the own signature visible in the editor, Personal Stationery | Signature menu > Signatures… | Named signatures per `MailIdentity` with defaults for new mail and replies, inserted when composing. Today each identity has one `signatureHTML`, appended when sending. Lookout's Signature menu lists one signature per identity and inserts the others; Signatures… edits them. |
| Font family, color, highlight, alignment, paragraph indent, line spacing | Message tab > Basic Text; Format Text tab | Editor extensions (`@tiptap/extension-text-style` is installed), and a sanitizer that keeps these styles |
| Tables, online pictures, shapes, icons, screenshots, Quick Parts, equations | Insert tab | Editor features. Lookout offers Attach File, Pictures, Link, Date & Time, Symbol, Horizontal Line and Emoji. |
| Attach Item: a message, a business card, a calendar | Insert tab > Include | Attaching an `EMail` as `.eml`, a `Person` as vCard, a calendar range as iCalendar |
| Choosing between ambiguous names in Check Names, the company directory in Check Names and Select Names | Message tab > Names; Select Names dialog | Address resolution against the server directory (GAL). Lookout's Check Names and Select Names search the local address books. |
| From: "Other E-mail Address…" | From menu | Sending with any From address. Today only identities and catch-all identities can send. |
| Outlook-style reply header (From / Sent / To / Subject block) | Reply body | A quote format option in `ComposeActions`. The logic writes "*name* wrote on *date*:" and a blockquote. |
| MailTips (recipient is out of office, large audience, external recipients) | InfoBars in the composer | EWS `GetMailTips`, Graph mail tips |
| Format Painter, Zoom, Thesaurus, Translate, Language, Accessibility checker | Message tab; Format Text tab; Review tab | Editor features (copying marks, a zoom factor), a thesaurus, a translation service, an accessibility checker |

Font sizes are left out on purpose, not missing: the mail editor has no font size box and no font size keys (Ctrl+] / Ctrl+[, Ctrl+Shift+> / <), in both frontends.

## Rules

Rules and Alerts and Create Rule. All Mustang rules are client rules that run when Mustang downloads new mail.

| Outlook feature | Where in Outlook | What the logic would need |
|---|---|---|
| Turn a rule on or off | Checkbox in the rule list | An `enabled` property in `FilterRuleAction`, honored by `EMail.processMessage()` |
| Run Rules Now (choose rules, folder, subfolders, read / unread) | Folder tab; Rules Wizard; rule list | A method that applies rules to the messages already in a folder |
| Exceptions ("except if …") | Rules Wizard | Negated criteria in `FilterRuleAction` |
| Stop processing more rules | Rules Wizard | A flag in `FilterRuleAction` that ends the rule loop in `processMessage()` |
| More actions: forward, forward as attachment, redirect, reply with a template, flag with a date, clear categories, set importance, play a sound, display an alert, run a script | Rules Wizard; Change Rule menu | New action types in `FilterRuleAction.doAction()`. Lookout offers move, copy, delete, mark read / unread, flag, categories and junk / not junk. |
| More conditions: subject only, sender or recipient address (free text), header contains, sent only to me, my name in To / Cc, importance, sensitivity, meeting invitation, through a specific account | Rules Wizard; Create Rule | New criteria in `SearchEMail`. Without a free-text address, rules from senders who are not in an address book, "Always Move Messages From" for such senders and "Always Move Messages To" can't be created, because `includesPerson` needs a `Person`. |
| Server-side rules (Exchange inbox rules, Sieve, JMAP), "client-only" marker | Rules and Alerts | Reading and writing server rules per protocol |
| Copy a rule with a folder to another account, "Create this rule on all accounts" | Rules and Alerts > Copy | Cloning a rule into another account with a folder mapping. Lookout copies rules without a folder to any account, and rules with a folder within their account. |
| Import / Export rules | Rules and Alerts > Options | A rules file format |

## Automatic Replies (Out of Office)

Not built: Mustang has no automatic-reply logic for any protocol.

| Outlook feature | Where in Outlook | What the logic would need |
|---|---|---|
| Automatic replies on / off, messages for inside and outside the organization, time range, "My contacts only" | File > Info > Automatic Replies | Server auto-reply settings per protocol: EWS `GetUserOofSettings` / `SetUserOofSettings`, Graph `automaticRepliesSetting`, JMAP `VacationResponse`, ManageSieve `vacation` for IMAP |
| "Automatic replies are being sent for this account" InfoBar with Turn Off | Below the ribbon | Reading the state above at start and periodically |
| Automatic Reply Rules | Automatic Replies > Rules | Exchange OOF rules |
| Block my calendar, decline new invitations, cancel my meetings during the period | Automatic replies (new Outlook) | Calendar integration of the above |
| Auto reply for IMAP and POP accounts without server support | Rules Wizard: "reply using a specific template" | A reply action in rules |

## Calendar views

Date navigator, calendar list, Day / Work Week / Week / Month and split view.

| Outlook feature | Where in Outlook | What the logic would need |
|---|---|---|
| Show As (Free, Working Elsewhere, Tentative, Busy, Out of Office), with its patterns on the event blocks | Event blocks; Appointment tab > Options; context menu | `Event.showAs`, mapped to EWS `LegacyFreeBusyStatus`, JMAP `freeBusyStatus`, iCalendar `TRANSP` / `X-MICROSOFT-CDO-BUSYSTATUS`. Lookout shows own events as Busy, and invitations by their response. |
| Private appointments (lock icon) | Event blocks; Appointment tab > Tags | `Event.isPrivate` (EWS `Sensitivity`, iCalendar `CLASS`, JSCalendar `privacy`) |
| Categories with colors on events | Event blocks; Categorize; Appointment tab > Tags | `Event.categories` and category colors per account. Only JMAP has `Event.color`, which Lookout uses like `frontend/`. |
| First day of the week, first week of the year | File > Options > Calendar > Work time | A week start setting. `logic/util/date.ts getWeekStart()` always starts the week on Monday. |
| Work hours: off-work time shaded per calendar (also in the Schedule View and for shared calendars), the Work Week view with the work days, scrolling to the work start, new events at the work start; editing the work hours per weekday | Calendar views; File > Options > Calendar > Work time | Work hours per calendar, read from and saved on the server: PR #1495. Lookout's code for it is commented out until #1495 is in master; `Calendar/WorkingHours.ts`, `Settings/Calendar/WorkHours.svelte` and `test/Calendar/WorkingHours.test.ts` come back from the branch history (fe7fd83f8). Until then, Lookout shades no off-work time, the Work Week is Monday to Friday, and new events and the scroll position start at 8:00. |
| Changing the calendar's own time zone; Swap Time Zones | File > Options > Calendar > Time zones | A display time zone other than the system's. `logic/` and Lookout compute days, all-day events and times in the time zone of the operating system (JS `Date`), as Outlook does with the Windows time zone. Lookout shows that zone in Options and adds the second and third time zone as rulers. |
| Calendar groups | Home tab > Calendar Groups | Stored groups of calendars (EWS "Common Views") |
| Create, rename, copy, move or delete a calendar on the server | Folder tab > New Calendar, Copy Calendar, Move Calendar; calendar context menu | Calendar folder management per protocol. Lookout's New Calendar and Create New Blank Calendar make a calendar on this computer; Rename Calendar renames only in this app; Delete Calendar removes shared calendars and the calendars that the user added. |
| Open Calendar from a room list or from the Internet (ICS subscription), Publish Online, E-mail Calendar | Home tab > Open Calendar; Share | A room list API; read-only ICS subscription accounts; publishing |
| Calendar description, Home Page and AutoArchive tabs of Calendar Properties | Calendar context menu > Properties | A description on `Calendar`; archiving |
| Delegates, meetings "on behalf of" | Share Calendar > Delegate | Delegate APIs (EWS `AddDelegate`) and organizer handling for delegated calendars |
| Read-only shared calendars and their permission level | Folder pane; Calendar Permissions | `myRights` / read-only state on `Calendar` (EWS `EffectiveRights`, JMAP `myRights`, CalDAV privileges). Lookout allows edits, and the server refuses them. |
| Move an event to another calendar; copy an event (Ctrl+drag, Copy to My Calendar) | Dragging between calendars; context menu; Appointment tab > Actions | `Event.moveToCalendar()` exists, but `frontend/` disabled it because of bugs (#1277), so Lookout drags only within a calendar. Copy semantics for events (new UID, organizer). |
| Reminders window with Snooze, Dismiss, Dismiss All | Reminders window | Reminder state per occurrence (dismissed, snoozed until), synced (EWS `ReminderNextTime`) |
| Print (Daily, Weekly, Monthly, Tri-fold) | File > Print | Print layouts and printing in the desktop app. File > Save Calendar (as `.ics`) is built. |
| Holidays | File > Options > Calendar > Add Holidays | Holiday calendars per country |
| Weather and work location in the day headers | Day headers (new Outlook) | A weather service; the Exchange work location API |
| Conditional Formatting, Filter and Format Columns in View Settings | View tab > View Settings | A rule engine for events (conditions on fields) for conditional formatting and filters; Format Columns is *UI only* |

## Event form and scheduling

Appointment and meeting form, recurrence, Scheduling Assistant and Tracking.

| Outlook feature | Where in Outlook | What the logic would need |
|---|---|---|
| High / Low Importance of events (Show As, Private and Categorize: see Calendar views) | Appointment tab > Tags | `Event.importance` (EWS `Importance`, iCalendar `PRIORITY`) |
| Optional attendees and resources (rooms) | Optional field; Scheduling Assistant | `Participant.role` mapped to EWS `OptionalAttendees` / `Resources`, iCalendar `ROLE` / `CUTYPE`, JSCalendar `roles` / `kind`. Lookout has one Required field. |
| Room Finder, Add Rooms, location suggestions | Location; Scheduling Assistant | A room list API (EWS `GetRoomLists` / `GetRooms`) |
| AutoPick, suggested times | Scheduling Assistant | Availability suggestions (EWS `GetUserAvailability` with suggestions) |
| Tentative, Out of Office and Working Elsewhere in the free/busy rows, attendees' working hours, calendar details | Scheduling Assistant | `Calendar.arePersonsFree()` returns only free or busy. It would need the busy type, working hours and the detailed view (EWS `DetailedMerged`). |
| Free/busy for CalDAV and JMAP calendars | Scheduling Assistant | `arePersonsFree()` for CalDAV (free-busy query) and JMAP (`Principal/getAvailability`). Lookout hides the Scheduling Assistant for these calendars. |
| Cancel Invitation (turn an unsent meeting back into an appointment) | Meeting tab > Attendees | Removing the organizer and the attendees from an event |
| Response Options: Request Responses, Allow New Time Proposals, Allow Forwarding, Hide Attendee List | Meeting tab > Response Options | Event properties (EWS `IsResponseRequested`, `AllowNewTimeProposal`; iCalendar `RSVP`) |
| Save a meeting without sending; the "Send update?" choices after moving or editing a meeting: send, don't send, send only to added or removed attendees | Save; dialog after moving or editing a meeting | A send parameter on `Event.save()` / `OutgoingInvitation.sendInvitations()`. The logic always sends, so Lookout only asks whether to move the meeting and send the update. |
| A note to the attendees with a cancellation | Cancel Meeting | A message parameter on `Event.deleteIt()` / `sendCancellations()` |
| From ▾ (organizer identity) | Meeting form, above Title | Choosing the identity for `OutgoingInvitation.createOrganizer()`, which always uses the calendar's `inviteAs` identity |
| Meeting Options (online meeting settings) | Online Meeting group | Settings of the meeting on the meeting server, `MeetAccount` has only `createMeetingURL()` |
| Propose New Time, Accept Proposal | Respond menu | iTIP `COUNTER` / `DECLINECOUNTER`, EWS proposed times |
| Time zone per event, separate start and end time zones | Appointment tab > Time Zones | A time zone picker (commented out in `frontend/`) and `Event.endTimezone`. Lookout shows the event's time zone when it differs from the local one. |
| Moving the entire series from an occurrence, for a series in another time zone | Open an occurrence > Entire series | Moving a series by as much as the user moved an occurrence, in the time zone of the series: `Event.copyEditableFieldsFromOccurrence()`, PR #1588. Until it is in master, Lookout moves the series with its own `EventEditFlow.applyOccurrenceToSeries()` by the same days and minutes in the local time zone; then it switches to the logic method. |
| Default reminders (15 minutes, 18 hours for all-day events) | File > Options > Calendar | A calendar setting |
| Save an appointment without a title ("(No subject)") | Save & Close | `hasMinimalProps()` requires a title |
| Forward as iCalendar | Forward menu | Only `forwardEventByMail()` exists, which is what Forward does |
| Tables in the event description | Insert tab | Editor features (as in the composer). |
| Pictures in the event description | Event form > Insert > Pictures | Inline images (`cid:`) for events: `Event` drops inline attachments, and nothing turns the editor's `data:` images into attachments on save, as `EMail` does. The event form shares the composer's Insert, Format Text and Review tabs without Pictures. |

## People

Address books, contact list, contact card, contact and contact group forms.

| Outlook feature | Where in Outlook | What the logic would need |
|---|---|---|
| "Save changes?" when closing a contact form, discarding changes | Contact form | An edit copy for `Person` and `Group`, like `Event.startEditing()` / `finishEditing()`. The form edits the live object (as in `frontend/`), so Lookout has no Cancel button. |
| Middle name, title, suffix, nickname, File As; sorting by last name | Contact form > Full Name; list order | These fields on `Person` with vCard, JSContact and EWS mapping, and a File As rule. Lookout sorts by the display name. |
| Birthday, anniversary, spouse, assistant, manager | Contact form > Details | Date and relation fields on `Person`; birthdays could then show in the calendar |
| Categories, Follow Up and Private flags on contacts | Home tab > Tags | `Person.tags` like `EMail.tags`, and flag fields, with server mapping (EWS `Categories`, vCard `CATEGORIES`) |
| Favorites | People (new Outlook) | A favorite flag on `Person`, synced where the server supports it |
| Deleted contacts, restore | Deleted folder (new Outlook); Deleted Items | A trash for contacts, or server-side soft delete. `deleteIt()` deletes permanently. |
| Create, rename and delete address books on the server | Folder tab | Address book management on the server (CardDAV MKCOL, EWS CreateFolder, JMAP `AddressBook/set`). Lookout's New Folder makes an address book on this computer, Rename Folder renames only in this app, and Delete Folder removes the address books that the user added. |
| Forward Contact as vCard, Forward Group | Home tab > Share; contact group form | An `Attachment` from generated data for a new `EMail`. The logic can already write vCards. |
| Add a one-off email address to a contact group; Update Now | Contact group form > Members | One-off members in `Group` (today only `Person` objects); a directory lookup per member. Lookout's New E-mail Contact… creates a contact in the address book and adds it. |
| Address Book dialog to browse the company directory | Home tab > Find > Address Book | Listing and paging in `SearchOnlyAddressbook`, which can only search. Lookout's Address Book dialog lists the local address books and searches the directories. |
| Presence badge on the contact picture | Contact list; contact card | Presence from chat accounts, mapped to persons |
| Linked contacts, duplicate merging | Profile card > Manage sources (new Outlook) | A duplicate finder (same email address or name). `Person.merge()` exists. |
| Organization: manager, direct reports | Profile card (new Outlook) | Directory lookups (EWS, Graph) |
| Mail merge, printing contacts | Home tab > Actions; File > Print | Printing in the desktop app; a mail merge generator |
| Map It | Contact form > Addresses | A map link for an address (e.g. an OpenStreetMap search URL opened with `openExternalURL()`). `frontend/` has no map link either. |
| "Display as" name of an email address, "This is the mailing address" | Contact form > General | A display name per email entry and a mailing address flag on `ContactEntry` |
| Field types and formats for user-defined fields, the field chooser lists of Outlook (Frequently-used, Miscellaneous fields) | Contact form > All Fields > New… | Typed custom fields on `ContactEntry`. Lookout's All Fields page edits the existing entries and adds text fields. |
| Search in subfolders, Categorized and other refiners | Search tab | Categories on contacts. Lookout refines by phone number, address and email address. |

## File backstage and Options

Info, Open & Export, Save As, Print, the app page, Add Account and the Options dialog. Lookout's Options dialog is organized like the settings of `frontend/`: General, Mail, Calendar, People, Files and the other apps, each with its accounts and their pages (Account Settings), and Trust Center. The account setup is the setup dialog of `frontend/`.

| Outlook feature | Where in Outlook | What the logic would need |
|---|---|---|
| Printer choice and status, Print Options (copies, page range, print attached files), Table Style, printing several selected messages | File > Print | A printer list and print options from the desktop backend (the webview's `print()` options); a table layout. Lookout prints the selected message in Memo Style through the system print dialog. |
| Account Settings: Repair, Set as Default, Change Folder; Change Profile, Manage Profiles; the Data Files, RSS Feeds, SharePoint Lists and Published Calendars tabs | File > Info > Account Settings (in Lookout: Options > Mail, Calendar or People > *account*) | Re-running the autoconfig for an existing account; a default account setting; profiles; RSS and SharePoint accounts; calendar publishing |
| Internet calendar subscriptions (ICS / webcal URLs) | File > Account Settings > Internet Calendars > New… | Read-only ICS subscription calendars. Lookout's Calendars tab adds calendars on this computer and CalDAV calendars. |
| "Remember password" off, Require logon using Secure Password Authentication (SPA), Mail to keep offline | Add Account > POP and IMAP Account Settings | Accounts without a stored password (asking at login); a sync window for offline mail |
| Options pages Search, Accessibility and Add-ins, and Outlook options that Mustang has no setting for (e.g. Send / Receive groups, AutoArchive, Empty Deleted Items on exit, the reminder sound file, the name order and File As order of contacts) | File > Options | Settings and their implementation in the logic |
| Trust Center pages other than Email Security (Trusted Publishers, Privacy Options, Form-based Sign-in, Attachment Handling, Automatic Download, Macro Settings, Programmatic Access); in Email Security: clear text signed messages, S/MIME receipts, reading signed mail in plain text, script in folders, Publish to GAL, hash and encryption algorithms, security labels | File > Options > Trust Center | Settings for these in the logic (e.g. a global remote content setting, S/MIME receipt requests, algorithm choice); publishing certificates to the directory (EWS) |
| Import from other programs and files: Outlook (.pst), Apple Mail, Windows Mail, CSV files; from Thunderbird also the local mail folders, calendars, message filters and saved passwords | File > Open & Export > Import > Import from another program or file | Importers in `logic/Mail/Import/` (today only Thunderbird's account settings and address books). Lookout's wizard imports these two; each imported account asks for its password or sign-in. |
| Export of mail folders (Outlook Data File .pst, CSV, with subfolders) and CSV export of calendars and contacts | File > Open & Export > Export | Exporters: a folder's messages as mbox or a ZIP of `.eml` files; a CSV writer with field mapping. Lookout exports calendars as iCalendar (.ics), address books as vCard (.vcf) and topics as HTML or Markdown, like `frontend/`. |
| Open Outlook Data File (.pst, .ost) | File > Open & Export > Open Outlook Data File | A PST / OST reader. With a writer, it would also give the .pst export above. |

Settings of `frontend/` that Lookout's Options dialog leaves out:
- Appearance > Colors: they set CSS variables of `frontend/`, which Lookout's theme doesn't use, so they would change nothing. Lookout has the theme choice (light, dark, system), like Outlook's Office Theme.
- About > Debug (only in development builds).
- The picture of the account (`account.icon`) on the account's General page. Lookout shows the app's icon.

## Logic bugs found while building Lookout

This is a bug in `app/logic/`, which Lookout must not change. It is not fixed on this branch. The other bugs found while building Lookout are fixed in master: moving a folder (#1488), all-day events on the day the clocks go back (#1489), no update to the attendees when only the series end changes (#1491), a meeting link after turning "Online meeting" off (#1493), and no update to the attendees after "This and following" or "Delete this and following" (#1589).

- **A weekly rule without weekdays counts as every day in `RecurrenceRule.timesMatch()`.** Servers can send a weekly rule without BYDAY (meaning: the weekday of the series start). Rebuilding the same series with its weekday then counts as a time change, which asks "Save changes?" and, on saving, removes all exceptions. Lookout's recurrence dialog keeps an unchanged rule as it is, so this doesn't happen there; `frontend/`'s recurrence editor triggers it just by opening. The fix is in PR #1494.
