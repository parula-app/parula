import { PersonUID } from "../../../Abstract/PersonUID";
import type { Person } from "../../../Abstract/Person";
import { PGPPublicKey } from "./PGPPublicKey";
import { TrustLevel } from "../enums";
import { addArmorHeader, addPublicKeyToPersonUID } from "../KeyUtils";
import { getBaseDomainFromHost, getDomainForEmailAddress } from "../../../util/netUtil";
import { PriorityAbortable } from "../../../util/flow/Abortable";
import { appGlobal } from "../../../app";
import { type URLString, assert, capitalizeStart } from "../../../util/util";
import { sanitize } from "../../../../../lib/util/sanitizeDatatypes";

/**
 * Search the public key of person at the PGP key servers.
 * If found, adds the key to the person record, if not already there.
 * @returns success or not
 */
export async function queryPGPKeyServersForUID(uid: PersonUID): Promise<boolean> {
  let key: KeyWithSource | null;
  try {
    key = await queryPGPKeyServers(uid);
    if (!key) {
      return false;
    }
  } catch (ex) {
    return false;
  }
  let publicKey = await PGPPublicKey.importPublicKey(key.key);
  if (publicKey.obsolete) {
    return false;
  }
  // WKD is domain-validated, and keys.openpgp.org verifies email address.
  // Both match S/MIME Class 1 validation from CAs.
  publicKey.trustLevel = TrustLevel.ThirdParty;
  publicKey.caName = key.source;
  addPublicKeyToPersonUID(uid, publicKey);
  await uid.findPerson()?.save();
  return true;
}

/**
 * Search the public key of person at the PGP key server via
 * the WKS protocol.
 * Searches at the email provider domain, and also some well-maintained
 * central key server at `openpgp.org`.
 * @returns success or not
 */
export async function queryPGPKeyServersForPerson(person: Person): Promise<boolean> {
  let promises: Promise<boolean>[] = [];
  for (let entry of person.emailAddresses) {
    let uid = PersonUID.fromContactEntry(person, entry);
    promises.push(queryPGPKeyServersForUID(uid));
  }
  let results = await Promise.all(promises);
  await person.save();
  return results.some(found => found);
}

/**
 * Search the public key of person at the PGP key server via
 * the WKS protocol.
 * Searches at the email provider domain, and also some well-maintained
 * central key server at `openpgp.org`.
 * @returns ASCII-armored public key, or null
 */
export async function queryPGPKeyServers(uid: PersonUID): Promise<KeyWithSource | null> {
  let emailAddress = sanitize.emailAddress(uid.emailAddress, null)?.toLowerCase();
  assert(emailAddress, "Need email address");
  return await new PriorityAbortable(new AbortController(), [
    queryWKD(emailAddress),
    queryVKS(emailAddress),
  ]).run();
}

/**
 * Implements the Verifying Keyserver protocol
 * to query the central OpenPGP.org key server.
 * @see <https://keys.openpgp.org/about/api/>
 * @returns ASCII-armored public key, or null
 */
async function queryVKS(emailAddress: string, server?: URLString): Promise<KeyWithSource> {
  server ??= "https://keys.openpgp.org";
  let url = server + "/vks/v1/by-email/" + encodeURIComponent(emailAddress);
  let armoredKey = await fetchText(url);
  assert(armoredKey?.trim(), "Not found via VKS");
  return {
    key: armoredKey!,
    source: "Keys.OpenPGP.org",
  };
}

/**
 * Implements the Web Key Directory protocol
 * to query the PGP keys at the email provider.
 * @see <https://www.ietf.org/archive/id/draft-koch-openpgp-webkey-service-21.html>
 * @returns ASCII-armored public key, or null
 */
async function queryWKD(emailAddress: string): Promise<KeyWithSource> {
  let domain = getDomainForEmailAddress(emailAddress);
  let localPart = emailAddress.split("@")[0];
  let hash = await computeWKDHash(emailAddress);

  let advancedURL = `https://openpgpkey.${domain}/.well-known/openpgpkey/${domain}/hu/${hash}?l=${encodeURIComponent(localPart)}`;
  let directURL = `https://${domain}/.well-known/openpgpkey/hu/${hash}?l=${encodeURIComponent(localPart)}`;

  let binary = await new PriorityAbortable(new AbortController(), [
    fetchBinary(advancedURL),
    fetchBinary(directURL),
  ]).run();
  assert(binary, "Not found via WKD");
  let base64 = binaryToBase64(binary);
  let armoredKey = addArmorHeader(base64, "PGP PUBLIC KEY BLOCK");
  // it.dept.stanford.edu -> Stanford
  let domainName = capitalizeStart(getBaseDomainFromHost(domain).replace(/\..*/, ""));
  return {
    key: armoredKey,
    source: domainName,
  };
}

/**
 * WKD hash for an email (simplified S‑256 hex, no extra base‑32).
 * Spec: https://datatracker.ietf.org/doc/html/draft-koch-openpgp-webkey-service
 */
async function computeWKDHash(original: string): Promise<string> {
  const encoded = new TextEncoder().encode(original.toLowerCase());
  const hashBuffer = await crypto.subtle.digest("SHA-1", encoded);
  const hashBytes = new Uint8Array(hashBuffer);
  return zbase32Encode(hashBytes);
}

interface KeyWithSource {
  /** Armored public key */
  key: string;
  /** User-readable name for the source that validated this key */
  source: string;
}

function binaryToBase64(bytes: Uint8Array) {
  let str = "";
  for (const byte of bytes) {
    str += String.fromCharCode(byte);
  }
  return btoa(str);
}

const ZBASE32_ALPHABET = "ybndrfg8ejkmcpqxot1uwisza345h769";

/**
 * z‑base‑32 encode the given bytes (RFC‑style z‑base‑32, 32‑character output).
 */
function zbase32Encode(bytes: Uint8Array): string {
  let result = "";
  let buffer = 0;
  let bits = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      const index = (buffer >>> (bits - 5)) & 0x1f;
      result += ZBASE32_ALPHABET[index]!;
      bits -= 5;
    }
  }

  if (bits > 0) {
    const index = (buffer << (5 - bits)) & 0x1f;
    result += ZBASE32_ALPHABET[index]!;
  }

  return result.padEnd(32, "0"); // WKD expects 32 octets
}

let ky: any;

async function fetchText(url: URLString): Promise<string | null> {
  if (!ky) {
    ky = await appGlobal.remoteApp.kyCreate({
      timeout: 3000,
    });
  }
  let text = await ky.get(url, {
    result: "text",
    retry: 0,
  });
  assert(text && typeof (text) == "string", "Empty result");
  return text;
}

async function fetchBinary(url: URLString): Promise<Uint8Array | null> {
  if (!ky) {
    ky = await appGlobal.remoteApp.kyCreate({
      timeout: 3000,
    });
  }
  let arrayBuffer = await ky.get(url, {
    result: "arrayBuffer",
    retry: 0,
  });
  assert(arrayBuffer && arrayBuffer.byteLength, "Empty result");
  return new Uint8Array(arrayBuffer);
}

/*async function fetchBinary(url: URLString): Promise<Uint8Array | null> {
  let response = await fetch(url);
  if (response.status < 200 || response.status >= 300) {
    return new Error(response.statusText);
  }
  let arrayBuffer = await response.arrayBuffer();
  assert(arrayBuffer && arrayBuffer.byteLength, "Empty result");
  return new Uint8Array(arrayBuffer);
}*/
