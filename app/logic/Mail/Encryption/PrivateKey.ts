import type { PublicKey } from "./PublicKey";

/** Added to `PublicKey` */
export interface PrivateKey {
  /** User wishes to sign all outgoing emails */
  useToSign: boolean;
  didBackup: boolean;
  /** Set when the key is created.
   * Do not save this property. It should be false on load. */
  justCreated: boolean;
  // Decrypt the private key
  passphrase: string;

  /** User wishes to send encrypted emails whenever possible */
  encryptByDefault: boolean;

  privateKeyAsFile(): File;

  /** A copy without the secret key, with our name and trust, e.g. for where a public key is shown or saved. See #1916 */
  publicKey(): PublicKey;

  /** With the secret key and passphrase, only for our identity config. `toJSON()` has only the public key, so it can't leak into mails or contacts. */
  toPrivateJSON(): any;
  fromPrivateJSON(json: any): void;
}
