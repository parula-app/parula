import { Account } from "./Account";
import { notifyChangedProperty } from "../util/Observable";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";

export class TCPAccount extends Account {
  @notifyChangedProperty
  hostname: string | null = null;
  @notifyChangedProperty
  port: number | null = null;
  @notifyChangedProperty
  tls = TLSSocketType.Unknown;
  /** Allow TLS 1.0 and 1.1, for old servers */
  @notifyChangedProperty
  acceptOldTLS = false;

  getHostname(): string | null {
    return this.hostname;
  }
  getTLS(): TLSSocketType {
    return this.tls;
  }

  fromConfigJSON(json: any) {
    super.fromConfigJSON(json);
    this.hostname = sanitize.hostname(json.hostname, null);
    this.port = sanitize.portTCP(json.port, null);
    this.tls = sanitize.enum(json.tls, [TLSSocketType.Plain, TLSSocketType.TLS, TLSSocketType.STARTTLS], TLSSocketType.Unknown);
    this.acceptOldTLS = sanitize.boolean(json.acceptOldTLS, false);
  }
  toConfigJSON(): any {
    let json = super.toConfigJSON();
    json.hostname = this.hostname;
    json.port = this.port;
    json.tls = this.tls;
    json.acceptOldTLS = this.acceptOldTLS;
    return json;
  }

  toString(): string {
    return `${this.protocol.toUpperCase()} account: ${this.name}, username ${this.username}, username ${this.username}, hostname ${this.hostname}, port ${this.url}, TLS ${this.tls == TLSSocketType.TLS ? "TLS" : this.tls == TLSSocketType.STARTTLS ? "STARTTLS" : "Plain" }`;
  }
}

export enum TLSSocketType {
  Unknown = 0,
  Plain = 1,
  TLS = 2,
  STARTTLS = 3,
}
