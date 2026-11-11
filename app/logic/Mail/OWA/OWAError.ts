import { gt } from "../../../l10n/l10n";

export class OWAError extends Error {
  readonly type: string;
  constructor(response: any) {
    let message = response.message || `HTTP ${response.status} ${response.statusText}`;
    let type = `HTTP ${response.status}`
    if (response.json) {
      let body = response.json.Body || response.json;
      if (body.FaultMessage) {
        message = body.FaultMessage;
        type = body.ExceptionName;
      }
      if (body.ResponseMessages?.Items?.[0]) {
        body = body.ResponseMessages.Items[0];
      }
      if (body.MessageText) {
        message = body.MessageText;
        type = body.ResponseCode;
      }
      if (body.WasSuccessful === false) {
        message = body.ErrorMessage || message;
        type = "ErrorCode " + body.ErrorCode;
      }
    }
    super(message);
    this.type = type;
    if (this.type == "ErrorItemNotFound") {
      this.message = gt`This was deleted on the server`;
    }
  }
}
