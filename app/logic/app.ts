import type { MailAccount } from './Mail/MailAccount';
import type { ChatAccount } from './Chat/ChatAccount';
import type { Person } from './Abstract/Person';
import type { Addressbook, SearchOnlyAddressbook } from './Contacts/Addressbook';
import type { Calendar } from './Calendar/Calendar';
import type { MeetAccount } from './Meet/MeetAccount';
import type { VideoConfMeeting } from './Meet/VideoConfMeeting';
import type { FileSharingAccount } from './Files/FileSharingAccount';
import type { TopicAccount } from './Topic/TopicAccount';
import type { Topic } from './Topic/Topic';
import type { Workspace } from './Abstract/Workspace';
import { WebApps } from './WebApps/WebApps';
import { Addons } from './Addons/Addons';
import { isMobile } from './build';
import { Observable, notifyChangedProperty } from './util/Observable';
import { ArrayColl, Collection, mergeColls } from 'svelte-collections';

class AppGlobal extends Observable {
  readonly emailAccounts = new ArrayColl<MailAccount>();
  readonly chatAccounts = new ArrayColl<ChatAccount>();
  readonly addressbooks = new ArrayColl<Addressbook>();
  readonly searchOnlyAddressbooks = new ArrayColl<SearchOnlyAddressbook>();
  readonly calendars = new ArrayColl<Calendar>();
  readonly calendarEvents = mergeColls(this.calendars.map(cal => cal.eventsWithRecurrences)).sortBy(ev => ev.startTime);
  readonly meetAccounts = new ArrayColl<MeetAccount>();
  readonly meetings = new ArrayColl<VideoConfMeeting>();
  readonly fileSharingAccounts = new ArrayColl<FileSharingAccount>();
  readonly topicAccounts = new ArrayColl<TopicAccount>();
  readonly workspaces = new ArrayColl<Workspace>();
  readonly webApps = new WebApps();
  readonly addons = new Addons();

  personalAddressbook: Addressbook;
  collectedAddressbook: Addressbook;
  readonly persons: Collection<Person> = mergeColls(this.addressbooks.map(ab => ab.persons));
  readonly topics: Collection<Topic> = mergeColls(this.topicAccounts.map(acc => acc.topics));
  //readonly allContacts: Collection<Contact> = mergeColls(this.addressbooks.map(ab => ab.contacts));
  remoteApp: any;
  /** The user's real name. Obj set in `startup.ts`, and name when loading accounts. */
  me: Person;

  @notifyChangedProperty
  isSmall = false;
  @notifyChangedProperty
  isMobile = isMobile;
}

export const appGlobal = new AppGlobal();
