import type { TTimeZoneID } from "./TJSCalendar";

/** <https://www.ietf.org/archive/id/draft-ietf-jmap-calendars-26.html#name-calendars> */
export interface TJMAPCalendar {
  readonly id: string;
  name: string;
  description?: string;
  color?: string;
  sortOrder: number;
  readonly isDefault: boolean;
  isSubscribed: boolean;
  includeInAvailability: "all" | "attending" | "none";
  defaultAlertsWithTime?: any;
  defaultAlertsWithoutTime?: any;
  timeZone?: TTimeZoneID;
  shareWith?: Record<string, TJMAPCalendarRights>;
  readonly myRights: TJMAPCalendarRights;
  onDestroyRemoveContents: boolean;
  onSuccessSetIsDefault?: string;
}

/** <https://www.ietf.org/archive/id/draft-ietf-jmap-calendars-26.html#name-calendars> */
export interface TJMAPCalendarRights {
  mayReadFreeBusy: boolean;
  mayReadItems: boolean;
  mayWriteAll: boolean;
  mayWriteOwn: boolean;
  mayUpdatePrivate: boolean;
  mayRSVP: boolean;
  mayShare: boolean;
  mayDelete: boolean;
}
