import type { PrivateKey } from "./PrivateKey";
import { EncryptionSystem, TrustLevel } from "./enums";
import { Observable, notifyChangedProperty } from "../../util/Observable";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { AbstractFunction } from "../../util/util";
import { ArrayColl } from "svelte-collections";

export class PublicKey extends Observable {
  @notifyChangedProperty
  name: string;
  id: string;
  fingerprint: string;
  /** Must be set by subclass */
  system: EncryptionSystem;
  created: Date;
  /** null = never or unknown */
  expires: Date | null;
  cipher: string;
  keyLengthInBits: number | null = null;
  @notifyChangedProperty
  _trustLevel: TrustLevel = TrustLevel.Sender;
  @notifyChangedProperty
  _encryptByDefault = false;
  /** expired, disabled by our user, revoked by owner etc. */
  @notifyChangedProperty
  _obsolete = false;
  @notifyChangedProperty
  caName: string | null;
  readonly userIDs = new ArrayColl<string>;
  /**
   * Armored (base64-encoded) public PGP key for storage.
   * null, if this is a private key, or the system doesn't support armored string keys.
   */
  publicKeyArmored: string | null;

  get trustLevel(): TrustLevel {
    return this._trustLevel;
  }
  set trustLevel(val: TrustLevel) {
    if (val != TrustLevel.Distrusted &&
        this.trustLevel == TrustLevel.Distrusted) {
      this.obsolete = false;
    }
    this._trustLevel = val;
    if (this.trustLevel == TrustLevel.Distrusted) {
      this.obsolete = true;
      this.encryptByDefault = false;
    }
  }

  /** This recipient wishes that all emails to him are encrypted. */
  get encryptByDefault(): boolean {
    return this._encryptByDefault;
  }
  set encryptByDefault(val: boolean) {
    this._encryptByDefault = val;
  }

  get obsolete(): boolean {
    // Derive expiry live: the stored flag was set when the key was imported,
    // but keys expire while sitting in the store.
    return this._obsolete || !!this.expires && this.expires.getTime() < Date.now();
  }
  set obsolete(val: boolean) {
    this._obsolete = val;
    if (this._obsolete) {
      this.encryptByDefault = false;
    }
  }

  /** Name to show for a key that the user has not named, e.g. "A1B2" */
  get defaultName(): string {
    return this.id.substring(0, 4).toUpperCase();
  }

  /** Formats fingerprint as batches of 4 uppercase chars, separated by spaces.
   * Replace the space at position 25 with a newline. */
  get fingerprintDisplay(): string {
    const batchLength = 4;
    let batches: string[] = [];
    let fingerprint = this.fingerprint.toUpperCase();
    for (let i = 0; i < fingerprint.length; i += batchLength) {
      batches.push(fingerprint.substring(i, i + batchLength));
    }
    return batches.join(" ");
  }

  publicKeyAsFile(): File {
    // Implement using this.keyAsFile()
    throw new AbstractFunction();
  }
  protected keyAsFile(armored: string, mimetype: string, filenamePrefix: string, fileExt: string): File {
    return new File([armored], this.keyFilename(filenamePrefix, fileExt), { type: mimetype });
  }
  /** Filename to save this key, or something that belongs to it, to disk.
   * @param filenamePrefix What the file contains, e.g. "SecretKey" */
  keyFilename(filenamePrefix: string, fileExt: string): string {
    // A key that has no certificate yet has no user ID
    return [filenamePrefix, this.userIDs.first, this.name].filter(part => part).join("-") + "." + fileExt;
  }

  isForEMailAddress(emailAddress: string): boolean {
    let address = emailAddress?.toLowerCase();
    return !!address && this.userIDs.some(userID => userID.toLowerCase() == address);
  }

  get sortOrder(): number {
    return -(
      sanitize.translate(this.system, { [EncryptionSystem.PGP]: 2, [EncryptionSystem.SMIME]: 1 }, 0) +
      (this.encryptByDefault ? 20 : (this as any as PrivateKey).useToSign ? 10 : 0) +
      (this.obsolete ? -100 : 0));
  }

  toJSON() {
    let json = {} as any;
    json.publicKeyArmored = this.publicKeyArmored;
    json.system = this.system;
    json.name = this.name;
    json.id = this.id;
    json.fingerprint = this.fingerprint;
    json.created = this.created.toISOString();
    json.expires = this.expires?.toISOString();
    json.cipher = this.cipher;
    json.keyLengthInBits = this.keyLengthInBits;
    json.fingerprint = this.fingerprint;
    json.trustLevel = this.trustLevel;
    json.caName = this.caName;
    json.userIDs = this.userIDs.contents;
    json.encryptByDefault = this.encryptByDefault;
    json.obsolete = this.obsolete;
    return json;
  }
  fromJSON(json: any) {
    this.publicKeyArmored = sanitize.nonemptystring(json.publicKeyArmored, null);
    this.system = sanitize.enum<EncryptionSystem>(json.system, Object.values(EncryptionSystem));
    this.id = sanitize.alphanumdash(json.id);
    this.name = sanitize.label(json.name, this.defaultName);
    this.fingerprint = sanitize.alphanumdash(json.fingerprint);
    this.created = sanitize.date(json.created);
    this.expires = sanitize.date(json.expires, null);
    this.cipher = sanitize.nonemptylabel(json.cipher, null);
    this.keyLengthInBits = sanitize.integer(json.keyLengthInBits, null);
    this.trustLevel = sanitize.enum<TrustLevel>(json.trustLevel, Object.values(TrustLevel), TrustLevel.Sender);
    this.caName = sanitize.nonemptystring(json.caName, null);
    this.userIDs.replaceAll(sanitize.array(json.userIDs).map(userID => sanitize.nonemptystring(userID)));
    this.encryptByDefault = sanitize.boolean(json.encryptByDefault, false);
    this.obsolete = sanitize.boolean(json.obsolete, false);
  }
}
