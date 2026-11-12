import { base64ToUint8Array, uint8ArrayToHex } from "../../util/blob";

export class MAPIEntryID {
  readonly bytes: Uint8Array;

  constructor(base64: string | null | undefined) {
    this.bytes = base64ToUint8Array(base64 ?? "");
  }

  get hex(): string {
    return uint8ArrayToHex(this.bytes).toUpperCase();
  }

  get providerUID(): string {
    return uint8ArrayToHex(this.bytes.subarray(4, 20)).toUpperCase();
  }

  protected readASCII(start: number): { text: string | null, end: number } {
    let end = this.bytes.indexOf(0, start);
    if (end < 0) {
      end = this.bytes.length;
    }
    let text = String.fromCharCode(...this.bytes.subarray(start, end)).trim();
    return { text: text || null, end };
  }
}

export class MAPIAddressBookEntryID extends MAPIEntryID {
  static readonly kProviderUID = "DCA740C8C042101AB4B908002B2FE182";

  get legacyDN(): string | null {
    if (this.bytes.length < 29 || this.providerUID != MAPIAddressBookEntryID.kProviderUID) {
      return null;
    }
    return this.readASCII(28).text;
  }
}

export class MAPIStoreEntryID extends MAPIEntryID {
  static readonly kProviderUID = "38A1BB1005E5101AA1BB08002B2A56C2";

  get mailboxDN(): string | null {
    if (this.bytes.length < 61 || this.providerUID != MAPIStoreEntryID.kProviderUID) {
      return null;
    }
    let server = this.readASCII(60);
    if (!server.text) {
      return null;
    }
    return this.readASCII(server.end + 1).text;
  }
}
