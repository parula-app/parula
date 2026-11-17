import type { Participant } from "../../Participant";

export class OWAGetUserAvailabilityRequest {
  /** Free/Busy requests are wrapped in an additional object for some reason. */
  readonly request: any = {
    __type: "GetUserAvailabilityInternalJsonRequest:#Exchange",
    Header: {
      __type: "JsonRequestHeaders:#Exchange",
      RequestServerVersion: "Exchange2013",
      TimeZoneContext: {
        __type: "TimeZoneContext:#Exchange",
        TimeZoneDefinition: {
          __type: "TimeZoneDefinitionType:#Exchange",
          Id: "UTC",
        },
      },
    },
    Body: {
      __type: "GetUserAvailabilityRequest:#Exchange",
      FreeBusyViewOptions: {
        __type: "FreeBusyViewOptions:#Exchange",
        TimeWindow: {
          __type: "Duration:#Exchange",
        },
        RequestedView: "Detailed",
      },
    },
  };

  constructor(participants: Participant[], from: Date, to: Date) {
    this.request.Body.MailboxDataArray = participants.map(participant => ({
      __type: "MailboxData:#Exchange",
      Email: {
        __type: "EmailAddress:#Exchange",
        Address: participant.emailAddress,
      },
    }));
    this.request.Body.FreeBusyViewOptions.TimeWindow.StartTime = from.toISOString();
    this.request.Body.FreeBusyViewOptions.TimeWindow.EndTime = to.toISOString();
  }

  get action() {
    return "GetUserAvailabilityInternal";
  }
}
