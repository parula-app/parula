import { PublicKey } from "../PublicKey";
import { EncryptionSystem, TrustLevel } from "../enums";
import { assert } from "../../../util/util";
import type OpenPGP from "openpgp";

export class PGPPublicKey extends PublicKey {
  system = EncryptionSystem.PGP;
  /**
   * Armored (base64-encoded) public PGP key, i.e.
   * `-----BEGIN PGP PUBLIC KEY BLOCK-----` …
   * `-----END PGP PUBLIC KEY BLOCK-----`
   */
  declare publicKeyArmored: string;
  protected _openPGPPublicKey: OpenPGP.PublicKey | null = null; // cache only

  async openPGPPublicKey(openPGP?: OpenPGPModule): Promise<OpenPGP.PublicKey> {
    if (this._openPGPPublicKey) {
      return this._openPGPPublicKey;
    }
    openPGP ??= await import("openpgp");
    assert(this.publicKeyArmored, `Have no public key stored for ${this.userIDs.first} ${this.name}`);
    this._openPGPPublicKey = await openPGP.readKey({ armoredKey: this.publicKeyArmored });
    return this._openPGPPublicKey;
  }

  publicKeyAsFile(): File {
    return this.keyAsFile(this.publicKeyArmored, "application/pgp-keys", "PublicKey", "asc");
  }

  /** Reads a PGP public key from an armored file.
   * Factory function. */
  static async importPublicKey(armoredPublicKey: string): Promise<PGPPublicKey> {
    const openPGP = await import("openpgp");
    let key = new PGPPublicKey();
    key.publicKeyArmored = armoredPublicKey;
    let pgp = await openPGP.readKey({ armoredKey: armoredPublicKey });
    await key.readFromOpenPGPKey(pgp);
    return key;
  }

  protected async readFromOpenPGPKey(pgp: OpenPGP.Key) {
    this.id = pgp.getKeyID().toHex().toUpperCase();
    this.fingerprint = pgp.getFingerprint();
    this.trustLevel = TrustLevel.Sender;
    this.created = pgp.getCreationTime();
    let expiry = await pgp.getExpirationTime();
    if (expiry instanceof Date) {
      this.expires = expiry;
    }
    let pgpCipher = pgp.getAlgorithmInfo();
    let cipher = pgpCipher.algorithm;
    if (pgpCipher.curve) {
      cipher += "/" + pgpCipher.curve;
    }
    this.cipher = cipher
      .replaceAll("Encrypt", "")
      .replaceAll("Sign", "")
      .replaceAll("Legacy", "")
      .toUpperCase();
    this.keyLengthInBits = pgpCipher.bits;
    this.name = this.defaultName;
    this.userIDs.replaceAll(pgp.users.map(u => u.userID.email));
  }
}

export type OpenPGPModule = typeof import("openpgp");
