export class OWASubscribeToHierarchyNotificationRequest {
  /** This request is a special snowflake. Not only did they copy the Persona
   * approach of wrapping the request in an object, they then put their data
   * in a separate property of that object rather than in the request. */
  readonly request = {
    __type: "NotificationSubscribeJsonRequest:#Exchange",
    Header: {
      __type: "JsonRequestHeaders:#Exchange",
      RequestServerVersion: "Exchange2013",
    },
  };
  readonly subscriptionData = [{
    __type: "SubscriptionData:#Exchange",
    SubscriptionId: "HierarchyNotification",
    Parameters: {
      __type: "SubscriptionParameters:#Exchange",
      NotificationType: "HierarchyNotification",
    },
  }];

  get action() {
    return "SubscribeToNotification";
  }
}

export class OWASubscribeToRowNotificationRequest {
  /** This request needs the time zone for some reason. */
  readonly request = {
    __type: "NotificationSubscribeJsonRequest:#Exchange",
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
  };
  readonly subscriptionData = [{
    __type: "SubscriptionData:#Exchange",
    SubscriptionId: "RowNotification ",
    Parameters: {
      __type: "SubscriptionParameters:#Exchange",
      NotificationType: "RowNotification",
      FolderId: "",
    },
  }];

  constructor(folderID: string) {
    this.subscriptionData[0].SubscriptionId += folderID;
    this.subscriptionData[0].Parameters.FolderId = folderID;
  }

  get action() {
    return "SubscribeToNotification";
  }
}
