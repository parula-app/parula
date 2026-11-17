# Bugs
* Mail: Move multiple mails (desktop) - UI and backend buggy
* Composer: Bulleted lists - Paragraphs vs. lines
* Mobile
  * Composer
  * Contacts Person page
    * Combo box background color
    * Edit/Save buttons not on second line
    * Star
    * Name field labels
    * Avatar

# Release
* Polish based on feedback
* License notification bar
* Payment: Upgrade
  * Upgrade page in Settings: Billing
  * Server
* OAuth
  * Google: Renewal TAC - Started, waiting for Google
  * Microsoft: localhost redirect URL - Client ID vs. account unclear
* Calendar: DB change; main account
* Calendar: Find identity #682

# Polish
* Contacts History
  * Now bar
  * Make icon clickable

# Next
  * JMAP Calendar and Contacts
    * Fix bugs
    * Calendar: Recurrence
  * Graph Calendar and Contacts
  * PGP
    * Data: Move to ContactEntry
    * Data: Move EMail properties into class
    * Composer
      * Dropdown for PGP vs. S/MIME (if private keys for both systems)
    * Msg reader
      * Expander scrollable, maybe whole header
  * SML
    * Purchase
    * Poll
  * Actions (Filters)
    * Run on fetch, not full download
  * Calendar
    * Free/Busy
    * Tasks
  * Contacts
    * Add new line with no value when editing
      (if we can do it without moving the other boxes)
    * Same name: Checkboxes
  * Import Outlook PST
  * FastTree
    * Drag&Drop: Open on drag over - for: Move messages to deep subfolders -> Rewrite FastTree
  * Bug: FastList doesn't update some rows #66
  * Threads
    * Search all folders
    * Hide quotes
    * Message list: Threaded view?
    * Mail Chat view: Open thread
  * Tags: Table view: Make it part of subject column
  * Tags: Shrink tag list when not enough space

# Feedback
## Zucca
* TB import: Duplicated own Identity
* Attachments list: Fetch with email headers (not only during full download)
## Elena
* Clear profile
* Debug dump of settings
* Composer
  * PersonEntry: Delete key
  * Open attachment
* Setup
  * OAuth2 login: Close window. Login button disabled.
  * Icons based on provider or domain
* Mail Persons view: Sort by recency or by name
* Contacts
  * Merge: too many clicks, with confirmation dialog
  * Delete: requires 2 clicks: Edit, then Delete. Too slow.
* Saved Searches delete: Update list
* List view: Sort order
* MailChat/Thread: Jail HTML: Styles and size
## Nick
* Mac: Use Mac Password manager
* Manual setup: OAuth2 UI: "Browser" goes back to "Separate window"
## mjl
* Back button (after clicking on an email address in an email, want to go back to email)
* Tags in "Move to folder" button - icon not obvious. change tooltip.
* Keyboard shortcuts
* How to show keyboard shortcuts
  * When selected, show on bottom right
  * When hovering, show in tooltip
  * Shortcut help window
  * Press Windows key, show shortcuts on all elements
* Unread vs. new mails
   * way to show unread mails in folder panel
   * Show new unread messages instead of imap recent
* Search on top right, contacts, doesn't show search mode
* Icon for HTML formatted view is not clear
* Threading
* Good
  * modern feeling
## Stefanie
* Onboarding
  * Start with email setup, not selection screen
  * Don't exit setup
* gmx.net / web.de unable to verify the first certificate on macOS 14.5
* Demo: Files: Add Files for persons
* Chat: selected person not shown
* Mail: Get out of Folder settings mode
## Freshness
* Icons for accounts: user-set
* Pic for users, in identities


# WebApps

* Add custom app
  * Name
  * URL
  * Icon (Default: Automatic from favicon of URL)
  * For Meet: Other people can see the same document based on the URL
  * For Integration:
    * URL for email address search
    * URL for email subject substring search
    * URL for project search
* Store: Add more apps
* window.open()
* Save/load last URL of app, in separate localStorage item

## During meeting
* URL
  * Catch clipboard with URL
  * Share link via meeting
  * Open URL shared
* Share screen of Mustang (?)


# Chat

## UI
* Message menu
  * Emoji reaction
  * Reply
* User is typing
* Group chat
  * Need: Router, for: Click on name -> Contacts
  * Show list of participants?
  * Show number of participants
* Contact person
* Join group
  * Via group name or URL
  * Search
* Create group
* Link URLs
* Detect MarkDown in plaintext messages

## Editor
* Emojis
* Attachments
* Giffy

## XMPP
* Finish implementatoin

## Matrix
* Fix impl
* Key sync doesn't work right
* Message impl
  * Room title change
  * Person name chage
* Bug: Re-logins by itself

## Other protocols
* Teams
  * Have partial impl
* Signal
* WhatsApp
* DIM <https://www.dim.chat>
* Discord

# Contacts
* Groups
* Placeholder when we have no image for a person

# Calendar
* Time/Date entry fields
* Protocol implementation
  * CalDav
  * JMAP JSCalendar
* Invitation send
* Invitation receive
* Free/busy dialog

# Meet
## UI
* Self: Black after turning off cam
* Meeting pic in UI before joining conference

## Protocol
* LiveKit
  * Waiting room
  * Server
    * Invite links
  * Reconnect
* M3 server
  * Open/close cam and mic
  * Participant opening/closing cam is delayed
  * Mute/unmute without destroying stream
  * TURN server
  * Re-connect
  * Lower resolution video
  * Show Internet connection quality for self and other participants
* XMPP 1:1
* XMPP group?
* Matrix 1:1
* Matrix group?
* Jitsi server
* Video streaming

## Proprietary protocols
* Teams
* WebEx
* Amazon conf
* WhatsApp
* Zoom

# Mail

## IMAP
* UIDONLY (if available): Enable and test
* Fallback: When UID not at all supported
* Download all msgs in folder: When?
* Subscribed folders only, and subscription UI
* Move folder

### Intentionally not implemented
* Expunge on quit

## JMAP
* EventSource
* WebSocket

## Graph
* Notification

## POP3

## Missing features
* Spam filter
* Archive
* Undo
* IMAP Quota
* IMAP ACL: Share mailbox/folders with colleages
* Thread pane sort
* Threading in Thread pane
* Save/Load mail as .eml file
* OS send file as email (dangerous) #315
* Format/flowed

### Editor
* blockquote cite vs. third party
* Insert link
* Emojis

## Filters
* User manually moves mail into folder
  * -> Ask whether to keep doing that
  * -> create filter based on From address
* User searches manually
  * Button to save the search as Virtual folder
  * Button to create a filter action
    -> Use the search criteria as filter criteria
    -> Let user specify filter actions
* Filter actions
  * Redirect
* Run filters using Sieve or locally

## Security
* Unknown senders
  * Known name, but unknown email address
    * Warn when reading
    * Warn when replying
  * Score emails
    * Email address or domain name in name
    * Link text doesn't match link target
  * Make email domain bold, userpart in grey and not bold DONE
  * Remove email address and domain names from name DONE
  * Shorten name to 30 chars DONE
* HTML
  * Test sanitization
  * Make `<iframe>` untrusted and test it
  * Block HTTP loads
  * Show link target domain
* Promos
  * Link text doesn't match link target

## Conversation view
* Collapse specific emails (and save their collapsed state)
* Power user: Turn branches of a conversation into its own separate conversation
* Power user: Show branch structure (e.g. using indents)

## Later
* Refactor IMAP orchestration?: Separate IMAP protocol folder object and IMAP orcestration folder object. The latter does folder cache, IMAP poll/refresh, offline cache etc.

## Import
* Thunderbird
  * Account settings - DONE
  * Mails
  * Contacts - Partially implemented
  * Calendar
* Outlook
  * Account settings
  * Contacts
  * Calendar
  * Mails

# Later
* mailto handler
* WhatsApp
  * 1:1 chat
  * Group chat
  * Video conf
* Teams
  * 1:1 chat
  * Video conf
* SIP
  * Voice call to phone system
  * Incoming calls
  * jssip
* AI
  * mcp-framework

## App logic
* init
  * Move chat account load into Chat app
* Router
  * Use Svelte router with objects stack?

## Power users
* Configurable hotkeys
* Scripts for Automation (Simple Addons?)
