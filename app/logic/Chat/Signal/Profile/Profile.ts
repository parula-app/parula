/** Signal profiles (Docs/05 Part A). Fetch + decrypt another user's profile (name,
 * about, aboutEmoji, avatar) with their profile key, and write our own. Mirrors how
 * WhatsAppContact.fetch / the XMPP vCard fetch populate a contact in the background.
 *
 * Profile fields are AES-256-GCM under the 32-byte profile key, fixed-bucket padded
 * (ProfileCipher). The avatar is a CDN-0 object path, GET + decrypt with the same
 * profile-key GCM stream (nonce(12) ‖ ciphertext ‖ tag(16)). The zk *versioned*
 * write commitment (ProfileKeyCommitment / ExpiringProfileKeyCredential) is a
 * deferred groups concern — ⚠️ see setOwnProfile. */
import type { SignalAccount } from "../SignalAccount";
import type { SignalContact } from "../SignalContact";
import { ServiceId } from "../ServiceId";
import { SignalHosts } from "../Connection/SignalApi";
import {
  decryptProfileName,
  encryptProfileName, encryptProfileAbout, encryptProfileEmoji,
} from "../Encryption/ProfileCipher";
import { base64Encode, base64Decode, aesGCMDecrypt } from "../Crypto/primitives";
import { appGlobal } from "../../../app";
import { blobToDataURL } from "../../../util/blob";

/** `GET /v1/profile/{aci}[/{version}[/{credentialRequest}]]` response. The base
 * fields (`VersionedProfileResponse` unwraps `BaseProfileResponse`) are flat, per
 * `entities/{BaseProfileResponse,VersionedProfileResponse}.java` +
 * `ExpiringProfileKeyCredentialProfileResponse.java`. `identityKey`/`uuid` are
 * unpadded/padded base64 strings; `unidentifiedAccess` is padded base64;
 * `name`/`about`/`aboutEmoji`/`paymentAddress`/`phoneNumberSharing` are padded
 * base64 ciphertexts (decrypted with the owner's profile key); `avatar` is a CDN
 * object path; `credential` (only on the credential endpoint) is base64. */
interface ProfileResponse {
  identityKey?: string;
  name?: string | null;
  about?: string | null;
  aboutEmoji?: string | null;
  avatar?: string | null;
  paymentAddress?: string | null;
  phoneNumberSharing?: string | null;
  unidentifiedAccess?: string | null;
  unrestrictedUnidentifiedAccess?: boolean;
  capabilities?: { [name: string]: boolean };
  badges?: any[];
  credential?: string | null;
  uuid?: string;
}

export class SignalProfile {
  constructor(protected readonly account: SignalAccount) {}

  /** Fetch + decrypt a contact's profile and apply name + avatar to them, then to
   * the linked address-book person. Best-effort: logs and returns on any error
   * (no profile key yet, 404, network). */
  async fetchProfile(contact: SignalContact): Promise<void> {
    try {
      if (!contact.profileKey) {
        return; // can't decrypt without their profile key (learned from a message / storage)
      }
      let res = await this.getProfile(contact.serviceId, contact.profileKey);
      await this.applyProfile(contact, res, contact.profileKey);
    } catch (ex) {
      console.error("Signal: fetching profile failed:", ex);
    }
  }

  /** GET the **versioned** profile JSON (Docs/05 §A.4). Only the versioned response
   * carries the encrypted name/about/avatar; the version is derived from the
   * contact's profile key + ACI (no zk credential needed — that's a groups concern). */
  protected async getProfile(serviceId: ServiceId, profileKey: Uint8Array): Promise<ProfileResponse> {
    let version = await profileKeyVersion(profileKey, serviceId);
    return await this.account.api(SignalHosts.chat).json<ProfileResponse>(
      "GET", `/v1/profile/${serviceId.toString()}/${version}`, undefined, this.account.authCredentials());
  }

  /** Decrypt the name + avatar with `profileKey` and apply onto the contact. */
  protected async applyProfile(contact: SignalContact, res: ProfileResponse, profileKey: Uint8Array): Promise<void> {
    if (res.identityKey) {
      contact.identityKey = base64Decode(res.identityKey);
    }
    if (res.name) {
      let { givenName, familyName } = await decryptProfileName(profileKey, base64Decode(res.name));
      let name = [givenName, familyName].filter(Boolean).join(" ").trim();
      if (name) {
        contact.name = name;
      }
    }
    if (res.avatar) {
      let picture = await this.fetchAvatar(res.avatar, profileKey);
      if (picture) {
        contact.picture = picture;
      }
    }
    await this.applyToPerson(contact);
  }

  /** Download the avatar object from CDN 0 and decrypt it (profile-key GCM stream).
   * @returns a data: URL, or null on any failure. */
  async fetchAvatar(path: string, profileKey: Uint8Array): Promise<string | null> {
    try {
      let bytes = await this.account.api(SignalHosts.cdn0).getBytes("/" + path);
      let plaintext = await decryptAvatar(profileKey, bytes);
      return await blobToDataURL(new Blob([plaintext as BlobPart], { type: "image/jpeg" }));
    } catch (ex) {
      console.error("Signal: fetching profile avatar failed:", ex);
      return null;
    }
  }

  /** Copy the fetched name/avatar onto the linked address-book person (if any),
   * without clobbering data the user already set. */
  protected async applyToPerson(contact: SignalContact): Promise<void> {
    let person = contact.findPerson();
    if (!person) {
      return;
    }
    let changed = false;
    if (contact.name && person.name != contact.name && !person.name) {
      person.name = contact.name;
      changed = true;
    }
    if (contact.picture && !person.picture) {
      person.picture = contact.picture;
      changed = true;
    }
    if (changed) {
      await person.save();
    }
  }

  /** Write our own profile (`PUT /v1/profile`). Encrypts name/about/aboutEmoji
   * under our profile key and sends the `CreateProfileRequest` JSON.
   *
   * The server's `CreateProfileRequest.commitment` is `@NotNull`, so we always
   * send the 97-byte zk `ProfileKeyCommitment` (see {@link profileKeyCommitment}).
   * `avatar=false`+`sameAvatar=true` means AvatarChange.UNCHANGED (no avatar
   * upload); the avatar-upload form is only returned on AvatarChange.UPDATE.
   * Returns the server response (empty on a field-only write). */
  async setOwnProfile(profile: { givenName: string, familyName?: string, about?: string, aboutEmoji?: string }): Promise<any> {
    if (!this.account.profileKey || !this.account.aci) {
      throw new Error("Signal: no profile key / ACI to write a profile");
    }
    let profileKey = this.account.profileKey;
    let body: ProfileWriteJSON = {
      version: await profileKeyVersion(profileKey, this.account.aci),
      name: base64Encode(await encryptProfileName(profileKey, profile.givenName, profile.familyName ?? "")),
      avatar: false,
      sameAvatar: true,
      commitment: base64Encode(await profileKeyCommitment(profileKey, this.account.aci)),
    };
    if (profile.about != null) {
      body.about = base64Encode(await encryptProfileAbout(profileKey, profile.about));
    }
    if (profile.aboutEmoji != null) {
      body.aboutEmoji = base64Encode(await encryptProfileEmoji(profileKey, profile.aboutEmoji));
    }
    return await this.account.api(SignalHosts.chat).json("PUT", "/v1/profile", body, this.account.authCredentials());
  }
}

/** Decrypt an avatar: nonce(12) ‖ GCM-ciphertext ‖ tag(16) under the profile key. */
export async function decryptAvatar(profileKey: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  let nonce = data.subarray(0, 12);
  return await aesGCMDecrypt(profileKey, nonce, data.subarray(12));
}

/** The 64-hex `ProfileKeyVersion` for the URL/write. Byte-for-byte per libsignal
 * `zkgroup/src/api/profiles/profile_key_version.rs#get_profile_key_version`: a Sho
 * seeded with the label, then `absorbAndRatchet(profileKey(32) ‖ aci_uuid(16))`,
 * squeeze 32 bytes (PROFILE_KEY_VERSION_LEN), lower-hex-encode (→ 64 chars). */
export async function profileKeyVersion(profileKey: Uint8Array, aci: ServiceId): Promise<string> {
  let { Sho } = await import("../Encryption/ZKGroup/sho");
  let sho = new Sho("Signal_ZKGroup_20200424_ProfileKeyAndUid_ProfileKey_GetProfileKeyVersion");
  let combined = new Uint8Array(48);
  combined.set(profileKey.subarray(0, 32));
  combined.set(aci.uuid, 32);
  sho.absorbAndRatchet(combined);
  let raw = sho.squeezeAndRatchet(32);
  return [...raw].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** The 97-byte zkgroup `ProfileKeyCommitment` the server REQUIRES on every
 * `PUT /v1/profile` (`CreateProfileRequest.commitment` is `@NotNull`). Computed
 * byte-for-byte per libsignal `zkgroup/src/crypto/profile_key_commitment.rs`:
 *
 *   j3 = Sho("…ProfileKeyCommitment_Calcj3", profileKey(32)‖uid(16)).getScalar()
 *   (M3, M4) = ProfileKeyStruct(profileKey, uid)         // = profileKeyStructPoints
 *   J1 = j3·G_j1 + M3,  J2 = j3·G_j2 + M4,  J3 = j3·G_j3
 *
 * Serialized (bincode) as `ReservedByte(0x00) ‖ J1(32) ‖ J2(32) ‖ J3(32)` and
 * base64-encoded (standard, with padding) by `ProfileKeyCommitmentAdapter`. */
export async function profileKeyCommitment(profileKey: Uint8Array, aci: ServiceId): Promise<Uint8Array> {
  let { Sho } = await import("../Encryption/ZKGroup/sho");
  let { profileKeyStructPoints } = await import("../Encryption/ZKGroup/groupParams");
  let { Writer } = await import("../Encryption/ZKGroup/serialize");
  // G_j1, G_j2, G_j3: three SHO points off the empty-seeded "…SystemParams_Generate"
  // label (profile_key_commitment.rs SystemParams::generate; equals SYSTEM_HARDCODED).
  let gensSho = new Sho("Signal_ZKGroup_20200424_Constant_ProfileKeyCommitment_SystemParams_Generate");
  gensSho.absorbAndRatchet(new Uint8Array(0));
  let Gj1 = gensSho.getPoint();
  let Gj2 = gensSho.getPoint();
  let Gj3 = gensSho.getPoint();
  let j3Sho = new Sho("Signal_ZKGroup_20200424_ProfileKeyAndUid_ProfileKeyCommitment_Calcj3");
  let combined = new Uint8Array(48);
  combined.set(profileKey.subarray(0, 32));
  combined.set(aci.uuid, 32);
  j3Sho.absorbAndRatchet(combined);
  let j3 = j3Sho.getScalar();
  let { M3, M4 } = profileKeyStructPoints(profileKey, aci.uuid);
  let J1 = Gj1.multiply(j3).add(M3);
  let J2 = Gj2.multiply(j3).add(M4);
  let J3 = Gj3.multiply(j3);
  return new Writer().u8(0).point(J1).point(J2).point(J3).finish();
}

/** `PUT /v1/profile` body — the server's `CreateProfileRequest` record. Field names
 * and JSON shape per `entities/CreateProfileRequest.java`. All byte fields are
 * base64 (standard, with padding). `commitment` is `@NotNull` (always required);
 * `version` is 64 hex chars; `name`/`about`/`aboutEmoji`/`paymentAddress` are
 * fixed-bucket-padded ciphertexts; `avatar`(bool)/`sameAvatar` drive AvatarChange;
 * `badgeIds` is an optional list. */
interface ProfileWriteJSON {
  version: string;
  name: string;
  about?: string;
  aboutEmoji?: string;
  paymentAddress?: string;
  avatar: boolean;
  sameAvatar: boolean;
  commitment: string;
  badgeIds?: string[];
}
