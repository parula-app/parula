import { OWAOptionsRequest } from "./OWAOptionsRequest";

const kKeepOutlookRules = { AlwaysDeleteOutlookRulesBlob: false, Force: false };

export function owaGetInboxRulesRequest(): OWAOptionsRequest {
  return new OWAOptionsRequest("GetInboxRule");
}

export function owaRemoveInboxRuleRequest(ruleID: string): OWAOptionsRequest {
  return new OWAOptionsRequest("RemoveInboxRule", {
    Identity: { RawIdentity: ruleID },
    ...kKeepOutlookRules,
  });
}

export function owaNewInboxRuleRequest(parameters: Record<string, any>): OWAOptionsRequest {
  return new OWAOptionsRequest("NewInboxRule", {
    InboxRule: parameters,
    ...kKeepOutlookRules,
  });
}

export function owaSetInboxRuleRequest(parameters: Record<string, any>): OWAOptionsRequest {
  return new OWAOptionsRequest("SetInboxRule", {
    InboxRule: parameters,
    ...kKeepOutlookRules,
  });
}
