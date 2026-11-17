import "../../../../../logic/app";
import { setupTestFolder } from "../../SQL/setup";
import { getPublicKeyByKeyID } from "../../../../../logic/Mail/Encryption/KeyUtils";
import { EncryptionSystem, TrustLevel } from "../../../../../logic/Mail/Encryption/enums";
import { expect, test } from "vitest";

/**
 * The sender is not in the addressbook, and we have no private key of our own.
 * His key comes with the message, in the AutoCrypt header, so the signature
 * must verify and the reader must show it.
 */
test("PGP signature of a sender who is not in the addressbook", async () => {
  let { folder } = await setupTestFolder();
  let email = folder.newEMail();
  email.mime = new TextEncoder().encode(kPGPSignedAutoCrypt.replace(/\n/g, "\r\n"));
  await email.parseMIME();

  expect(email.system).toBe(EncryptionSystem.PGP);
  expect(email.text.trim()).toBe("Hello, this is PGP signed.");
  // The reader looks the key up by ID, and finds the one that came with the message
  let signingKey = await getPublicKeyByKeyID(email.signedByKeyID, email);
  expect(signingKey).toBe(email.signedKey);
  expect(signingKey.userIDs.contents).toEqual(["alice@example.com"]);
  expect(signingKey.trustLevel).toBe(TrustLevel.Sender);
  // and it is offered for the reply
  expect(email.from.encryptionPublicKey).toBe(email.signedKey);
});

/**
 * A mailing list wrapped the signed message into a `multipart/mixed`,
 * adding its footer. We cannot verify the signature that way, but the
 * message must still read normally, and this must not be reported as error.
 */
test("PGP signature nested inside a multipart/mixed", async () => {
  let { folder } = await setupTestFolder();
  let errors: Error[] = [];
  folder.account.errorCallback = ex => errors.push(ex);
  let email = folder.newEMail();
  email.mime = new TextEncoder().encode(kNestedPGPSigned.replace(/\n/g, "\r\n"));
  await email.parseMIME();

  expect(errors).toEqual([]);
  expect(email.text).toContain("Hello, this is PGP signed.");
  expect(email.signedByKeyID).toBe(null);
});

/** gpg detached signature, with the sender key in the AutoCrypt header.
 * `Date:` is the signature creation time, which `checkSignatures()` compares. */
const kHeaders = `From: Alice <alice@example.com>
To: User <user@example.com>
Subject: PGP signed test
Date: Thu, 03 Sep 2026 01:23:47 GMT
Message-ID: <sig-pgp@example.com>
MIME-Version: 1.0
Autocrypt: addr=alice@example.com; keydata=mQENBGqYzCMBCAC98FKaDKRkUSrWa7e3VPnl/Twu8rEPdl4sodXdPiNzSma843Jy1dWUdp9Z
 Q7VUfnPWo85UgkKYChrC5Mal7SyyoqNqs3Vv6TJKUghXaFcLqIgYFR4XYLyaLu+RVFvzeIUq
 PIu5SaECblJ5/1blU16O3Z9qacwDIh+6sazgXk5/St+59yl4QKVrV/XNchb1jvtAooHj1Zti
 gbM3gdCK959ruva50tyNJiKeZLISHFWEGfVixUMAtChXIMMk2tjqubGOFphTe4S2XKMwbG+y
 emhsvW43/UnU+XUb06XpIUAFYTOTr65Prmn2kgxHiUSDc7s1ygaV0qVyPwoeyQposwQlABEB
 AAG0GUFsaWNlIDxhbGljZUBleGFtcGxlLmNvbT6JAVQEEwEKAD4WIQRlJCpzMvq3+T8nJ+MV
 dM/vfNRO4QUCapjMIwIbAwUJA8JnAAULCQgHAgYVCgkICwIEFgIDAQIeAQIXgAAKCRAVdM/v
 fNRO4dRQB/9LyLaH+r+zBC9RAVksJ6Hp2dhNSgWTKXAQR0S3lrazLlL5oHY0MhfpnfgNp9c5
 jakPJgcfVciCyIWGfIJqV6QSo131DewdiBl562ljomSAAyAFGRXgkPnwrxQkmzs4wBZTMazz
 A0zjzp1XDjcL171pdAj8eCLMvxGLR6nN5KtKxAdU96Fu9zUg9UPFKKFWT5eD6Evqny7Di6Op
 f3ZqeKNHN18SHu21QCuSaJk20LJAn0FQ0plkhWVZdErswPgQrKcpsEKpjqiP9HVrdpPU22Bj
 iM0SK2Pci4DO+ADcSGZ37b1i9fp/okuBXQL5L1Ig+5wo17HZNpIH9+dryxSMCol1
`;

const kSignedPart = `Content-Type: multipart/signed; micalg=pgp-sha256; protocol="application/pgp-signature"; boundary="----=_Part_PGP_1"

------=_Part_PGP_1
Content-Type: text/plain; charset=utf-8

Hello, this is PGP signed.
------=_Part_PGP_1
Content-Type: application/pgp-signature; name="signature.asc"
Content-Disposition: attachment; filename="signature.asc"

-----BEGIN PGP SIGNATURE-----

iQEzBAABCAAdFiEEZSQqczL6t/k/JyfjFXTP73zUTuEFAmqYzCMACgkQFXTP73zU
TuH7aAf/fGIkPwLYRrUYU9kM2vJE8clG7KnZmle6gxtw2HcRg9NqukbtwIKLYCU6
E1LJ5l0nQDE9Ed76mPSaP0frFcY4fatdb3iVjlzD4T31vyNqkO3InuZpDm7xsyNt
81gZJsw6Ljxv5zOodpJ+bKkbWismyGq9kESFIN6IQGQNtEa45yNTWyDbJvGi4sPR
rZCN4i3GCVyN87UaWHIJujGXqJZ6VrSA2Ib5FWcBcsOVwhVkE8DibPk1kGQUUIGa
IBzBAjsy/d3/r7fAY8cKE/GB0JBtsLb7Xg921frDIXVDZxMbIXgXO981HlnYc9jP
m/y0PSeZfDC9lCRdAajFdD5uIUnPPQ==
=1iWu
-----END PGP SIGNATURE-----
------=_Part_PGP_1--
`;

const kPGPSignedAutoCrypt = kHeaders + kSignedPart;

/** As mailing lists send it: the signed message is only one part of a
 * `multipart/mixed`, with the list footer next to it. */
const kNestedPGPSigned = kHeaders + `Content-Type: multipart/mixed; boundary="----=_Part_List"

------=_Part_List
` + kSignedPart + `------=_Part_List
Content-Type: text/plain; charset=utf-8

Mailing list footer
------=_Part_List--
`;
