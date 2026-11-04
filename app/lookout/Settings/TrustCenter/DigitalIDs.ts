import type { MailIdentity } from "../../../logic/Mail/MailIdentity";
import type { PublicKey } from "../../../logic/Mail/Encryption/PublicKey";
import type { PrivateKey } from "../../../logic/Mail/Encryption/PrivateKey";
import { PGPPrivateKey } from "../../../logic/Mail/Encryption/PGP/PGPPrivateKey";
import { SMIMEPrivateKey } from "../../../logic/Mail/Encryption/SMIME/SMIMEPrivateKey";
import { KeyStatus } from "../../../logic/Mail/Encryption/SMIME/SMIMEPublicKey";
import { importPrivateKey, readKeyFile } from "../../../logic/Mail/Encryption/KeyUtils";
import { saveBlobAsFile } from "../../../frontend/Util/util";
import { assert } from "../../../logic/util/util";
import { gt } from "../../../l10n/l10n";

export type DigitalID = PublicKey & PrivateKey;

export function usableDigitalIDs(identity: MailIdentity): DigitalID[] {
  return identity.encryptionPrivateKeys.contents.filter(key => !key.obsolete);
}

export function allDigitalIDs(identity: MailIdentity): DigitalID[] {
  return identity.encryptionPrivateKeys.contents;
}

export function keysAwaitingCertificate(identity: MailIdentity): SMIMEPrivateKey[] {
  return identity.encryptionPrivateKeys.contents
    .filter(key => key instanceof SMIMEPrivateKey && !key.certificate) as SMIMEPrivateKey[];
}

export function keyName(key: PublicKey): string {
  return key.name || key.userIDs.first || key.defaultName;
}

export function digitalIDLabel(key: DigitalID): string {
  return `${keyName(key)} (${key.system})`;
}

export function identityLabel(identity: MailIdentity): string {
  return identity.realname ? `${identity.realname} (${identity.emailAddress})` : identity.emailAddress;
}

export async function setDefaultDigitalID(identity: MailIdentity, key: DigitalID, encrypt: boolean, sign: boolean) {
  let keys = identity.encryptionPrivateKeys;
  for (let otherKey of keys) {
    if (otherKey != key) {
      otherKey.encryptByDefault = false;
      otherKey.useToSign = false;
    }
  }
  key.encryptByDefault = encrypt;
  key.useToSign = sign || encrypt;
  // `getMyPrivateKey()` falls back to the first key, when no key is used to sign
  if (keys.first != key) {
    keys.replaceAll([key, ...keys.contents.filter(listed => listed != key)]);
  }
  await identity.account.save();
}

export async function importDigitalID(identity: MailIdentity, file: File, passphrase: string, name: string): Promise<DigitalID> {
  // <copied from="../../../frontend/Settings/Mail/Account/EncryptionImport.svelte" onImportFile()>
  let fileContent = await readKeyFile(file, passphrase);
  let key = await importPrivateKey(fileContent, passphrase);
  let existing = identity.encryptionPrivateKeys.find(existing => existing.id == key.id);
  if (!existing) {
    identity.encryptionPrivateKeys.add(key);
  } else if (existing instanceof SMIMEPrivateKey) {
    // Re-import of the same key, possibly with new certificates in the file
    await existing.addCertificates(fileContent);
  }
  // </copied>
  let imported = existing ?? key;
  if (name.trim()) {
    imported.name = name.trim();
  }
  await identity.account.save();
  return imported;
}

export async function exportDigitalID(identity: MailIdentity, key: DigitalID, withPrivateKey: boolean) {
  if (!withPrivateKey) {
    // <copied from="../../../frontend/Settings/Mail/Account/EncryptionKey.svelte" onExportPublic()>
    await saveBlobAsFile(key.publicKeyAsFile());
    // </copied>
    return;
  }
  // <copied from="../../../frontend/Settings/Mail/Account/EncryptionKey.svelte" onExportPrivate(), onExportPrivateDone()>
  await saveBlobAsFile(key.privateKeyAsFile());
  key.didBackup = true;
  await identity.account.save();
  // </copied>
}

export async function removeDigitalID(identity: MailIdentity, key: DigitalID) {
  // <copied from="../../../frontend/Settings/Mail/Account/EncryptionKey.svelte" onDelete()>
  identity.encryptionPrivateKeys.remove(key);
  await identity.account.save();
  // </copied>
}

export async function createOpenPGPKey(identity: MailIdentity): Promise<DigitalID> {
  // <copied from="../../../frontend/Settings/Mail/Account/EncryptionImport.svelte" onCreateNewPGP()>
  assert(!identity.isCatchAll, gt`Cannot create keys for catch-all email addresses. Please create an identity with a specific email address.`);
  let key = await PGPPrivateKey.createNewPrivateKey({
    realname: identity.realname,
    emailAddress: identity.emailAddress,
  });
  identity.encryptionPrivateKeys.add(key);
  await identity.account.save();
  // </copied>
  return key;
}

export async function createSMIMEKey(identity: MailIdentity): Promise<SMIMEPrivateKey> {
  // <copied from="../../../frontend/Settings/Mail/Account/EncryptionImport.svelte" onCreateNewSMIME()>
  assert(!identity.isCatchAll, gt`Cannot create keys for catch-all email addresses. Please create an identity with a specific email address.`);
  let key = await SMIMEPrivateKey.createNewPrivateKey(identity.emailAddress);
  identity.encryptionPrivateKeys.add(key);
  await identity.account.save();
  // </copied>
  return key;
}

export async function addCertificateFile(identity: MailIdentity, key: SMIMEPrivateKey, file: File) {
  // <copied from="../../../frontend/Settings/Mail/Account/EncryptionKey.svelte" onAddCertificateSMIME()>
  let fileContent = await file.text();
  assert(fileContent.includes("-----BEGIN CERTIFICATE-----") ||
    fileContent.includes("-----BEGIN TRUSTED CERTIFICATE-----"),
    gt`Could not find a certificate in this file. It must be in PEM format.`);
  await key.addCertificates(fileContent);
  await identity.account.save();
  // </copied>
}

export function keyStatusText(status: KeyStatus | null): string {
  switch (status) {
  case KeyStatus.NoCertificate:
    return gt`This Digital ID has no certificate yet`;
  case KeyStatus.ChainIncomplete:
    return gt`The certificates of the certificate authority are missing`;
  case KeyStatus.ChainInvalid:
    return gt`The certificate chain could not be verified`;
  case KeyStatus.SelfSignedRoot:
    return gt`This Digital ID uses a self-signed root certificate`;
  case KeyStatus.Valid:
    return gt`This Digital ID has a valid certificate`;
  }
  return "";
}

export function needsCertificate(status: KeyStatus | null): boolean {
  return status == KeyStatus.NoCertificate || status == KeyStatus.ChainIncomplete;
}
