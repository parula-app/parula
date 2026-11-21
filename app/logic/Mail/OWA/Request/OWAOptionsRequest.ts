/** For the commands of the OWA options, e.g. the inbox rules.
 * Unlike `OWARequest`, they have no `Body`, but the parameters next to the `Header`. */
export class OWAOptionsRequest {
  [Symbol.toStringTag]: string;
  readonly __type: string;
  readonly Header = {
    __type: "JsonRequestHeaders:#Exchange",
    RequestServerVersion: "Exchange2013",
  };

  constructor(action: string, parameters?: Record<string, any>) {
    this[Symbol.toStringTag] = action;
    this.__type = action + "Request:#Exchange";
    Object.assign(this, parameters);
  }

  get action() {
    return this[Symbol.toStringTag];
  }
}
