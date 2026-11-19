# Parula

Parula is a new full-featured email client, chat, video conference, calendar, contacts and files app.

https://parula.app

# Architecture

Parula is a full desktop client for Linux, Windows, macOS, Android and iOS,
running as local app, with local data, and written entirely in TypeScript and HTML.
It is currently based on Electron and CapacitorJS as runtime,
but can use other runtimes like Gecko as well.

Data is stored and processed locally, and not passing through a server
or cloud service (apart from your self-chosen mail server etc, obviously).

We put an emphasis on clean code architecture and design and APIs,
with a strict separation between logic and UI code, and observers,
to allow easy modification and adaptions to new needs.
It will also support extensions, using a high-level API.

# Features

Here is an incomplete list of highlights. The app has lots more features for you to discover.

## Mail

Created by the most experienced Thunderbird developers

### Protocols

* [JMAP Mail](https://datatracker.ietf.org/doc/html/rfc8621) - The newest and best Internet-standard protocol for mail
* [IMAP4rev2](https://www.ietf.org/rfc/rfc9051.html)
  * [SPECIAL USE](https://datatracker.ietf.org/doc/html/rfc6154) - Automatic detection of Sent, Spam etc. folders
  * [CONDSTORE and MODSEQ](https://datatracker.ietf.org/doc/html/rfc4551) - Quick folder syncs
  * [ACL](https://datatracker.ietf.org/doc/html/rfc4314) - access the mailbox of your colleage, or grant him access to yours
* [SMTP](https://datatracker.ietf.org/doc/html/rfc5321)
* EWS - for Exchange on-premise
  * Shared folders - access the mailbox of your colleage, or grant him access to yours
* OWA - Outlook Web Access native JSON protocol
  * Shared folders
* ActiveSync
* Microsoft Graph - for Office365
* POP3 (alpha)

### Features

* Multiple accounts
* Display
  * Unified inbox
  * 4 mail views to choose: vertical, table view, 3-pane, and chat view
  * Display of plaintext and HTML mail
  * Dark mode shows email content with dark background
  * Display of inline images
  * Remote images blocked by default, for privacy. Can be enabled manually.
  * Anti-phishing - Display of sender domain, for unknown contacts
* Organization
  * Smart folders - Folders based on saved searches configured by you
  * Filter action rules - Automatically treat incoming mail based on criteria defined by you
  * Tags
  * Folders
  * Star
  * Quick search - Blazingly fast search in the current folder - faster than you can type
  * Global search - across all folders and accounts, using multiple criteria
  * Mark as spam ("j" shortcut, for "junk"), read ("m"), star ("s")
* Composer
  * Markdown shortcuts. Tips for shortcuts in button tooltips.
  * Add inline images
  * Drag&drop attachments
* Structured Mail (SML) (in development)
  * Polls
  * Meeting time poll
  * Book me
* Autoconfiguration
  * ISPDB for common email providers
  * [Autoconfig](https://www.ietf.org/archive/id/draft-ietf-mailmaint-autoconfig-04.html) - We **invented** it, now it's widely used on the Internet
  * Microsoft Exchange AutoDiscover V1 XML with authentication
  * Microsoft Exchange AutoDiscover V2 JSON without authentication
  * Manual config
* Encryption
  * PGP
    * Subject protection
    * AutoCrypt
  * S/MIME

## Calendar

### Protocols

* [CalDAV](https://datatracker.ietf.org/doc/html/rfc4791)
* [JMAP Calendar](https://www.ietf.org/archive/id/draft-ietf-jmap-calendars-26.html) - We are the first client ever to implement it.
* EWS - for Exchange on-premise
  * Shared calendars
* OWA - Outlook Web Access native JSON protocol
  * Shared calendars
* ActiveSync
* Microsoft Graph - for Office365

### Features

* Repeated events
* In other timezones
* Receive meeting invitations by mail
  * See whether you're free directly in the mail app
  * Add meeting to your calendar
  * Send confirmation or rejection to the organizer
* Send meeting invitations by mail
  * Works even across borders of organizations
  * Compatible with Office365, Exchange, Outlook, Google, Apple Mail and others
* Availability
  * If you invite for a meeting, and the other invitees are in your organization and you have access, you can see whether they are free at a given meeting time.
* Video-conference
  * Automatically creates a video-conference with join URL for the meeting time
  * Includes the join URL in the meeting invitation
  * Your video conference account is connected to your calendar, so you only need to click one button
  * Multiple accounts and providers supported (soon)
* Shared calendar
  * See your colleague's calendar, if he gave you access
  * You can give your colleague access to your calendar, if you choose

## Contacts

### Protocols

* [CardDAV](https://datatracker.ietf.org/doc/html/rfc6352)
* [JMAP Contacts](https://www.rfc-editor.org/rfc/rfc9610.html) - We are the first  ever to implement it.
* EWS - for Exchange on-premise
  * Shared contacts
* OWA - Outlook Web Access native JSON protocol
  * Shared contacts
* ActiveSync
* Microsoft Graph - for Office365

### Features
* History - Shows all your communication with that person, including
  * E-Mail
  * Chat
  * Meetings - Calendar events
  * Phone calls done in the app (planned)
  * Files sent or received (planned)

## Meet

Video conference

### Protocols
* WebRTC-based video conference
* SIP - Make and receive normal phone calls directly from the app
  * Phone operators, with SIP
  * Your own phone switch, with SIP
* Microsoft Teams (planned)

### Features

* Camera, microphone
* Screen-sharing of entire desktop or specific app
* Multiple views
  * Gallery in various sizes
  * Sidebar + speaker
  * Speaker only
* Participant list
  * Shows hand raised
  * Shows participant has cam/mic on/off
  * Moderation (later)
* Hand raise
* Participants with camera turned off are nonetheless listed at the bottom, even when the participant sidebar is collapsed, so that you know who is listening
* Clearly displayed whether your camera and mic are on or off, to avoid that others can accidentally see or hear you
* Select camera and microphone to use

## Chat

In development

### Protocols
* XMPP
  * 1:1 chat
  * Group chat
  * Edit messages
  * Retract messages
  * Encryption with OMEMO Double Ratchet
* Matrix
  * 1:1 chat
  * Group chat
  * Edit messages
  * Retract messages
  * Encryption with Megolm
* Rocket.Chat (planned)
* Teams (planned)
* WhatsApp
  * 1:1 chat
  * Group chat
  * Encryption with Double Ratchet
  * Native implementation, works like WhatsApp Android
  * Connects directly, no intermediate server
  * Set up as secondary client
* Signal
  * 1:1 chat
  * Group chat
  * Encryption with Double Ratchet
  * Native implementation
  * Connects directly, no intermediate server
  * Set up as secondary client

## File sharing

In development

### Protocols

* E-mail attachments shown, shorted by person
* WebDAV - NextCloud, ownCloud, openCloud, SharePoint, OneDrive, GMX, web.de (read only)
* Graph - Office365/SharePoint, openCloud (planned)
* Create sharing links, as public URL or only for specific users on the same server (planned)
  * NextCloud
  * openCloud
* Local file system (alpha)

### Features

* Gallery view
* List view with details
* Preview of
  * Images
  * PDF
  * Word and Excel files, in Microsoft Word online or Collabora, if configured as WebApps (see below)
* Create sharing links
  * Send them by email

## Web Apps

* Load any web application, with a Dock-like app bar
* Single-Sign-On: Apps can use the login context of your mail accounts,
  so that you're automatically logged in.
* Microsoft Word online, Excel online, Collabora and many others work
  directly in the app
* Configure your company webapp, e.g. your CRM system (soon)
* Switch from mail to that app, and the sender of the email
  directly loads in your CRM app (soon)


# Developers

## Install

See docs/INSTALL.md

## Documentation

Architecture, Design choices: See docs/
