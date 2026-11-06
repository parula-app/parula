import { appGlobal } from "../../../../../logic/app";
import { SMIMEPrivateKey } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEPrivateKey";
import { SMIMEPublicKey, KeyStatus } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEPublicKey";
import { importPublicKey, readPublicKeyFile } from "../../../../../logic/Mail/Encryption/KeyUtils";
import { base64ToBytes } from "../../../../../../lib/asn1/decoders/pem";
import { expect, test, describe } from "vitest";

// The browser has this, but Node does not.
globalThis.indexedDB ??= {
  cmp(a: Uint8Array, b: Uint8Array): number {
    let length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i++) {
      if (a[i] != b[i]) {
        return a[i] < b[i] ? -1 : 1;
      }
    }
    return Math.sign(a.length - b.length);
  },
} as any;

// `keyStatus()` asks the backend for the CA certificates. We trust our test root CA.
appGlobal.remoteApp ??= {
  async getCACertificates(type: string): Promise<string[]> {
    return type == "bundled" ? [kRootCert] : [];
  },
};

/* Test CA "Test Root CA" -> "Test Intermediate CA" -> "Test User" <user@example.com>,
 * made with `openssl req -x509` and `openssl x509 -req`, valid for 20 years.
 * The user's key and certificate: */
const kUserKey = `
-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDM6hpDynrvN3Td
ujW5autw3Dni2ZcTVCrgJByRhkV1ScvRIE1i+6uVe0e9yDhtD8lOes4VoPCmSWfe
RGS6W86PgHT/jIeGGefu6xkoLGrSlrbz6OZ/4t6LIRRPwpPSnICHOyauXtD4i9sE
FDW72GOYF4C3SI8+dJC2arzFfWysfGZZZSi39omeeuAybgiajtnWpqv8bkHfUQID
/FM4dcjITyiClErL8QTx+E9XX3MKn5aD8W1LoQ4Ecp4p9CKIDcqbWqAAntg5Ybyh
vTm/gmHAPZsI7eAKqclybY9rg17AWmvfYwzuoT/Kgw5slfOTR5U6QwV4XSs/2avL
wIAEsUzlAgMBAAECggEAAywpSaOACXKXs/QbvCBp5aaSaQ70QUe0RAg2S55JnOiB
oZEvgyJ0dF0pgSIK4sz6N9ivMDoJTiwrEcLU0JoDX29LDToCtVW/pJBBJJq716e4
mU7U7/Ki/k8kWZzG8NCP+kGbiad5peBCcCetvxgGG+pA1nWaFCRpXI2kzD9ZUdOy
VbLSHQZUWmuTe20zzy8McpQX8hX2QwdwWuTBIhCE9gNoTRe9c6wXCfx6v9quUB8m
h8hTrmJdskVkaqMhpZ9oGSkdo5L4Dsiipm7o0rk3NsenRL9TMMcQF+sdNU0IZlf8
CJ3hjz7LVyaJ0kWL7B/3h+5tLr5G8hT612UtW2PhIQKBgQDqcy+wgE+QbEcXuaNM
RyDWfUHnvxWcq466DPimwc9c6FuGBj45/TgvjCm4MZ451VHjqB3924w/Xtj/quBs
FatQ2XWZRz1SjfWosJYAtUziCj94rUvjhEJ2LHH0e6ChDFuzlDi4NdBjJLipV27n
zWU99dm2EocEPNZQEDAtMoXfIQKBgQDfv+ueBrg/ym9Z9k3pdDO13CCGYUW8WnMT
CTc2blYH7dYcjNoI1OSUiVBngQfWxXD1JKbMn5c9k1LTaN/xphsk4MkiWp0YfAdW
Sw8p/oe3F7sVut3PieJxt/JQUH69gddKYI6W/teAR9AUKpGOudBpyWlRugPl2h7x
HYqOzUQJRQKBgQCzn4qjHLtYuEyDldvR3hD/pDnxNwp03U/dpYCAKq8XzIIKng/g
1+vLKgTwtTs3rgMue6h2zVWXW7C/uQh2Zue5atJZnCYUcOUM2DYk1sLPz/AvIf6p
krRk28p2+JzpppE/dck7ASfmPcUpIO68tDXkEc86WtmM2puL/csbZcEBYQKBgBZY
Y15/y0zLmb1BRNyotzVVS4ZAFqfN3KotBG+SK1NVZEmro2a4ZC+VWwtLLo47X6GL
zICo+4CxwtbMJXlLnnBbZprgs8mrMUxj6JrICaO2Yf+0jsxYN94lgbSVpWKloeuS
owrfXoQ4J8arzaeUVQULkVIRIqyE0QxBaAIE6+OFAoGAdFmx9vrrQC9xqJHYATrW
+m+IZkKJwYNuIPOursRKXeJOQpUg+LsEfIBTSU7UdeoG36d2lx2UYuAh/llqYb2L
EKD867qr3FHGT94n1ezp1sHL00tqrE3e2zZiRn9JJ9BUeDyDYY5H/tNpSLc5fOJS
Ux4IKj+XJgDoGN973maylmc=
-----END PRIVATE KEY-----
`;

const kUserCert = `
-----BEGIN CERTIFICATE-----
MIIDUjCCAjqgAwIBAgIUXZAZBzx4C+nshKqwC8Zh3U0aj+QwDQYJKoZIhvcNAQEL
BQAwHzEdMBsGA1UEAwwUVGVzdCBJbnRlcm1lZGlhdGUgQ0EwHhcNMjYxMDIyMTE1
OTIzWhcNNDYxMDE3MTE1OTIzWjAUMRIwEAYDVQQDDAlUZXN0IFVzZXIwggEiMA0G
CSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDM6hpDynrvN3TdujW5autw3Dni2ZcT
VCrgJByRhkV1ScvRIE1i+6uVe0e9yDhtD8lOes4VoPCmSWfeRGS6W86PgHT/jIeG
Gefu6xkoLGrSlrbz6OZ/4t6LIRRPwpPSnICHOyauXtD4i9sEFDW72GOYF4C3SI8+
dJC2arzFfWysfGZZZSi39omeeuAybgiajtnWpqv8bkHfUQID/FM4dcjITyiClErL
8QTx+E9XX3MKn5aD8W1LoQ4Ecp4p9CKIDcqbWqAAntg5YbyhvTm/gmHAPZsI7eAK
qclybY9rg17AWmvfYwzuoT/Kgw5slfOTR5U6QwV4XSs/2avLwIAEsUzlAgMBAAGj
gZAwgY0wCQYDVR0TBAIwADAOBgNVHQ8BAf8EBAMCBaAwEwYDVR0lBAwwCgYIKwYB
BQUHAwQwGwYDVR0RBBQwEoEQdXNlckBleGFtcGxlLmNvbTAdBgNVHQ4EFgQUvzyF
uhv5JU+F2+SsVToparPW3QIwHwYDVR0jBBgwFoAUWLQBR41bj+5o+HZh5ONorXns
J6YwDQYJKoZIhvcNAQELBQADggEBAJE3ipCJ1ytgpH3CBK/uEqbZHoEFEUOAc6pM
/tQkQJnHEbhhMh+BM0VMl2W6BdNoh7p5CET8LHx8nxOw0oME6e5wfQ6+3/IuUE2K
kqYM5pvdtctXvTq/JK4NSQ9d/5g2rm0gBCYXldlM4zsry2XTYHGoIM8b6RNSSkUY
POoBZMaA8l1OaefQw5EqzrkxQljo0bhiSZ5WtfOawLee7l5re4ykz6H3KxZWUoML
kKWN+GbhauQC6JD8ioFPazf42dhehiZLjZW1RUJnTg7LvDTvhvgG0bA75eYJNxuo
AknK/V+NxsLvScjELbH4UQgGsZIWa//vxmdj1O9Q6ct+WlrqD40=
-----END CERTIFICATE-----
`;

const kRootCert = `
-----BEGIN CERTIFICATE-----
MIIDHzCCAgegAwIBAgIUH5UAvmi+QRB5BaG4vIomhipaAoIwDQYJKoZIhvcNAQEL
BQAwFzEVMBMGA1UEAwwMVGVzdCBSb290IENBMB4XDTI2MTAyMjExNTkyM1oXDTQ2
MTAxNzExNTkyM1owFzEVMBMGA1UEAwwMVGVzdCBSb290IENBMIIBIjANBgkqhkiG
9w0BAQEFAAOCAQ8AMIIBCgKCAQEA02GsHrbMGagTK/EJRwD/106wJsOmbUammn6Y
Rr+64DkQoLEby2U6rHhnmMmbn4Bdc4+i1I0sw9iaoaR2RiA5EsPAchOhB7k5mb8N
D673GrDuyMnf6u8XhyNtMsYXmBi4iDtj+FxEtYG5hpA6clgc9Xf8mskY51Pr5e1k
F7qcpRAYNWXFZuj1MdeiH5NT1HMb1IaFNcyVXtgCKtt4lnmIOAiOv1SWVZslYyRK
1qO+KGueGGX5jpyaV78uRbHsMHcSf4u4zOHcbHNlOYggJTmgM5+9yOgEz4D5DJ96
NZkhZAWnKY7cLsogOOwjudS7nEiJ5dnbjs8UMDv6CtVd/EefmQIDAQABo2MwYTAd
BgNVHQ4EFgQUujMbd0/t5/JT704KFCUXecEbgRswHwYDVR0jBBgwFoAUujMbd0/t
5/JT704KFCUXecEbgRswDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYw
DQYJKoZIhvcNAQELBQADggEBAE2KVEvvZZlpPhpbtzLKXecHEz5clWqB2vU4uwV6
9y1nsEF9sXw6TL6IMQLONzYPdX2k3Ra3ikI2hQP4qfjLtLR64RfvXBIXhLZefnmX
X48NYbAaEtVDB4Z5aTwkQngBNYBN4UT3056sPzCZmuSMwVEN4gSIxjcNaMfFe+7D
jdn/6abwHqScluefQo5HLWvnz1dw+SAvWJ1yOjIR76sHFUqJ+nzBtq6ALVVyE2rv
54n/VcNAP/a5qxQunvV03M8/7LQM2jy/lBBQNNo7NhZUCdOdEeI/boYSReELzYTn
626X8JdPbvEJ4HlPKzQFV5TvYV330mHyesv800DQlMbwYo0=
-----END CERTIFICATE-----
`;

/* The whole chain, as a CA delivers it in a .p7b file, in the order root, user, intermediate:
 * openssl crl2pkcs7 -nocrl -certfile root.pem -certfile user.pem -certfile intermediate.pem */
const kChain = `
-----BEGIN PKCS7-----
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
Wce7xlPsMAfIbExnZS+ksDUxAA==
-----END PKCS7-----
`;

function der(pem: string): Uint8Array {
  return base64ToBytes(pem.replace(/-----[A-Z0-9 ]+-----|\s/g, ""));
}

const kFiles: [string, File, boolean][] = [
  ["PEM certificate", new File([kUserCert], "user.pem"), false],
  ["DER certificate", new File([der(kUserCert)], "user.cer"), false],
  ["PKCS#7 chain, PEM", new File([kChain], "chain.p7b"), true],
  ["PKCS#7 chain, DER", new File([der(kChain)], "chain.p7b"), true],
  // Some CAs label PKCS#7 as certificate
  ["PKCS#7 chain, PEM labelled CERTIFICATE", new File([kChain.replaceAll("PKCS7", "CERTIFICATE")], "certnew.p7b"), true],
];

async function expectUserCertificate(key: SMIMEPublicKey, hasChain: boolean) {
  expect(key.commonName).toBe("Test User");
  expect(key.userIDs.contents).toEqual(["user@example.com"]);
  // The CAs are in the chain, in issuing order, and did not replace the user's certificate
  expect(key.chain.contents.map(ca => ca.commonName)).toEqual(hasChain ? ["Test Intermediate CA", "Test Root CA"] : []);
  if (hasChain) {
    expect(await key.keyStatus()).toBe(KeyStatus.Valid);
  }
}

describe.each(kFiles)("Certificate file: %s", (name, file, hasChain) => {
  test("for a contact", async () => {
    let key = await importPublicKey(await readPublicKeyFile(file));
    expect(key).toBeInstanceOf(SMIMEPublicKey);
    await expectUserCertificate(key as SMIMEPublicKey, hasChain);
  });

  test("for our own key", async () => {
    let key = await SMIMEPrivateKey.importPrivateKey(kUserKey);
    await key.addCertificateFile(await readPublicKeyFile(file));
    await expectUserCertificate(key, hasChain);
  });
});

test("A text file is read as it is", async () => {
  expect(await readPublicKeyFile(new File([kUserCert], "user.pem"))).toBe(kUserCert);
});

test("A file without a certificate is rejected", async () => {
  let fileContent = await readPublicKeyFile(new File(["Hello"], "hello.txt"));
  await expect(importPublicKey(fileContent)).rejects.toThrow();
  // Adding a certificate, to a contact's key and to our own key
  let contactKey = await SMIMEPublicKey.importPublicKey(kUserCert);
  await expect(contactKey.addCertificateFile(fileContent)).rejects.toThrow();
  let ownKey = await SMIMEPrivateKey.importPrivateKey(kUserKey);
  await expect(ownKey.addCertificateFile(fileContent)).rejects.toThrow();
});
