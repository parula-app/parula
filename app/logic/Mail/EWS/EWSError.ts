import { XML2JSON } from "./XML2JSON";
import type { JsonRequest } from "./EWSAccount";
import type { Json } from "../../util/util";
import { gt } from "../../../l10n/l10n";

export class EWSError extends Error {
  readonly request: JsonRequest;
  readonly status: number;
  readonly statusText: string;
  readonly type: string;
  readonly XML: Json | undefined;
  readonly error: Json | undefined;
  readonly responseText: string | undefined;
  constructor(aResponse: any, aRequest: JsonRequest) {
    let message = aResponse.statusText;
    if (!message) {
      if (aResponse.status == 401 || aResponse.status == 440) {
        message = gt`Login error`;
      }
    }
    let type = 'HTTP ' + aResponse.status;
    let XML;
    let error;
    let responseText;
    let responseXML = aResponse.responseXML;
    if (responseXML) {
      try {
        let messageNode = responseXML.querySelector("Message");
        if (messageNode) {
          message = messageNode.textContent;
        }
        let responseCode = responseXML.querySelector("ResponseCode");
        if (responseCode) {
          type = responseCode.textContent;
        }
        let errorNode = responseXML.querySelector("[ResponseClass=\"Error\"]");
        if (errorNode) {
          let errorResponse = XML2JSON(errorNode) as any;
          message = errorResponse.MessageText;
          type = errorResponse.ResponseCode;
        }
        let innerErrorMessageNode = responseXML.querySelector("[Name=\"InnerErrorMessageText\"]");
        if (innerErrorMessageNode) {
          message = innerErrorMessageNode.textContent;
        }
        let innerErrorResponseNode = responseXML.querySelector("[Name=\"InnerErrorResponseCode\"]");
        if (innerErrorResponseNode) {
          type = innerErrorResponseNode.textContent;
        }
        let xmlNode = responseXML.querySelector("MessageXml");
        if (xmlNode) {
          // This identifies the XML element causing the error.
          XML = XML2JSON(xmlNode);
        }
        if (messageNode || responseCode || errorNode || xmlNode) {
          error = XML2JSON(responseXML.documentElement);
        }
      } catch (ex) {
        // The response wasn't XML, so we can't extract an error message.
        responseText = aResponse.responseText;
      }
    } else {
      responseText = aResponse.responseText;
    }
    super(message || responseText?.slice(0, 500) || type); // the server may answer with a whole HTML page
    this.request = aRequest;
    this.status = aResponse.status;
    this.statusText = aResponse.statusText;
    this.type = type;
    this.XML = XML;
    this.error = error;
    this.responseText = responseText;
  }
}

export class EWSItemError extends Error {
  readonly request: JsonRequest;
  readonly error: any;
  readonly type: string;
  constructor(errorResponseJSON: any, aRequest: JsonRequest) {
    if (Array.isArray(errorResponseJSON.MessageXml?.Value)) {
      for (let { Name, Value } of errorResponseJSON.MessageXml.Value) {
        errorResponseJSON[Name.replace(/^InnerError/, "")] = Value;
      }
    }
    super(errorResponseJSON.MessageText);
    this.request = aRequest;
    this.error = errorResponseJSON;
    this.type = errorResponseJSON.ResponseCode;
    if (this.type == "ErrorItemNotFound" || this.message.endsWith("Object reference not set to an instance of an object.")) {
      this.message = gt`This was deleted on the server`;
    }
  }
}
