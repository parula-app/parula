export class OWAGetMailboxAutoReplyConfigurationRequest {
  get action() {
    return "GetMailboxAutoReplyConfiguration";
  }
}

export class OWASetMailboxAutoReplyConfigurationRequest {
  readonly __type = "SetMailboxAutoReplyConfigurationRequest:#Exchange";
  readonly Header = {
    __type: "JsonRequestHeaders:#Exchange",
    RequestServerVersion: "Exchange2013",
  };
  readonly Options: object;

  constructor(options: object) {
    this.Options = options;
  }

  get action() {
    return "SetMailboxAutoReplyConfiguration";
  }
}
