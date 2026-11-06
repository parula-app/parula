// ASN.1 object definitions and identifiers, taken from various RFCs.
// RFCs are Copyright (c) IETF Trust and their authors.
// Code components are licenced under the BSD licence.

/* BSD License

Copyright (c) IETF

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR
CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. */

import { define } from "../../../../../lib/asn1/api";

/** Object identifiers */
const oids = {
  "1.2.840.113549.1.1.1": "rsaEncryption",
  "1.2.840.113549.1.1.5": "sha1WithRSAEncryption",
  "1.2.840.113549.1.1.7": "rsaESOAEP",
  "1.2.840.113549.1.1.8": "mgf1",
  "1.2.840.113549.1.1.9": "pSpecified",
  "1.2.840.113549.1.1.11": "sha256WithRSAEncryption",
  "1.2.840.113549.1.1.12": "sha384WithRSAEncryption",
  "1.2.840.113549.1.1.13": "sha512WithRSAEncryption",
  "1.2.840.113549.1.5.12": "pkcs5PBKDF2",
  "1.2.840.113549.1.5.13": "pkcs5PBES2",
  "1.2.840.113549.1.7.1": "data",
  "1.2.840.113549.1.7.2": "signedData",
  "1.2.840.113549.1.7.3": "envelopedData",
  "1.2.840.113549.1.7.6": "encryptedData",
  "1.2.840.113549.1.9.1": "E", // emailAddress
  "1.2.840.113549.1.9.3": "contentType",
  "1.2.840.113549.1.9.4": "messageDigest",
  "1.2.840.113549.1.9.5": "signingTime",
  "1.2.840.113549.1.9.14": "extensionRequest",
  "1.2.840.113549.1.9.15": "smimeCapabilities",
  "1.2.840.113549.1.9.16.1.23": "authEnvelopedData",
  "1.2.840.113549.1.9.22.1": "x509Certificate",
  "1.2.840.113549.1.12.1.1": "pbeWithSHAAnd128BitRC4",
  "1.2.840.113549.1.12.1.2": "pbeWithSHAAnd40BitRC4",
  "1.2.840.113549.1.12.1.3": "pbeWithSHAAnd3KeyTripleDESCBC",
  "1.2.840.113549.1.12.1.4": "pbeWithSHAAnd2KeyTripleDESCBC",
  "1.2.840.113549.1.12.1.5": "pbeWithSHAAnd128BitRC2CBC",
  "1.2.840.113549.1.12.1.6": "pbeWithSHAAnd40BitRC2CBC",
  "1.2.840.113549.1.12.10.1.1": "keyBag",
  "1.2.840.113549.1.12.10.1.2": "pkcs8ShroudedKeyBag",
  "1.2.840.113549.1.12.10.1.3": "certBag",
  "1.2.840.113549.1.12.10.1.4": "crlBag",
  "1.2.840.113549.1.12.10.1.5": "secretBag",
  "1.2.840.113549.1.12.10.1.6": "safeContentsBag",
  "1.2.840.113549.2.7": "hmacWithSHA1",
  "1.2.840.113549.2.9": "hmacWithSHA256",
  "1.2.840.113549.2.10": "hmacWithSHA384",
  "1.2.840.113549.2.11": "hmacWithSHA512",
  "1.2.840.113549.3.7": "desEDE3CBC",
  "1.3.6.1.5.5.7.3.4": "emailProtection",
  //"1.3.6.1.5.5.8.1.2": "hmacWithSHA1",
  "1.3.14.3.2.26": "sha1",
  "2.1.0.1.1": "printstr",
  "2.5.4.3": "CN", // commonName
  "2.5.4.6": "C", // country
  "2.5.4.7": "L", // locality (city)
  "2.5.4.8": "ST", // state
  "2.5.4.10": "O", // organisation
  "2.5.4.11": "OU", // organsational unit
  "2.5.29.14": "subjectKeyIdentifier",
  "2.5.29.15": "keyUsage",
  "2.5.29.17": "subjectAlternativeName",
  "2.5.29.19": "basicConstraints",
  "2.5.29.35": "authorityKeyIdentifier",
  "2.5.29.37": "extKeyUsage",
  "2.16.840.1.101.3.4.1.2": "aes128cbc",
  "2.16.840.1.101.3.4.1.6": "aes128gcm",
  "2.16.840.1.101.3.4.1.22": "aes192cbc",
  "2.16.840.1.101.3.4.1.26": "aes192gcm",
  "2.16.840.1.101.3.4.1.42": "aes256cbc",
  "2.16.840.1.101.3.4.1.46": "aes256gcm",
  "2.16.840.1.101.3.4.2.1": "sha256",
  "2.16.840.1.101.3.4.2.2": "sha384",
  "2.16.840.1.101.3.4.2.3": "sha512",
};

type WebCryptoAlgorithm = "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";

/** Converts a digest (hashing) algorithm name to WebCrypto. */
export const DigestAlgorithm: Record<string, WebCryptoAlgorithm> = {
  sha1: "SHA-1",
  sha256: "SHA-256",
  sha384: "SHA-384",
  sha512: "SHA-512",
};

/** Extracts the WebCrypto hash algorithm used by a signature algorithm. */
export const SignatureAlgorithm: Record<string, WebCryptoAlgorithm> = {
  sha1WithRSAEncryption: "SHA-1",
  sha256WithRSAEncryption: "SHA-256",
  sha384WithRSAEncryption: "SHA-384",
  sha512WithRSAEncryption: "SHA-512",
}

/** Extracts the WebCrypto hash algorithm used by a key derivation algorithm. */
export const KeyDerivationAlgorithm: Record<string, WebCryptoAlgorithm> = {
  hmacWithSHA1: "SHA-1",
  hmacWithSHA256: "SHA-256",
  hmacWithSHA384: "SHA-384",
  hmacWithSHA512: "SHA-512",
}

export interface BitString {
  unused: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  data: Uint8Array;
}

export const Null = define<void>("Null", function() {
  this.null();
});

export const OctetString = define<Uint8Array>("OctetString", function() {
  this.octstr();
});

export const Oid = define<string>("Oid", function() {
  this.objid(oids);
});

export const GeneralTime = define<number>("GeneralTime", function() {
  this.gentime();
});

export const UTCTime = define<number>("UTCTime", function() {
  this.utctime();
});

/** An algorithm */
export interface AlgorithmIdentifier {
  algorithm: string | number[];
  parameters: Uint8Array;
}
export const AlgorithmIdentifier = define<AlgorithmIdentifier>("AlgorithmIdentifier", function() {
  this.seq().obj(
    this.key("algorithm").objid(oids),
    this.key("parameters").optional().any(),
  );
});

/**
 * A pair of an attribute and a value.
 * The attribute is always an OID.
 * The value is one of the string types.
 * The spec only mentions some of the string types,
 * but I've seen other ones in real certificates.
 */
interface AttributeValue {
  type: string | number[],
  value: {
    type: "utf8str" | "numstr" | "printstr" | "t61str" | "ia5str" | "visstr" | "unistr" | "bmpstr";
    value: string;
  }
}
const AttributeValue = define<AttributeValue>("AttributeValue", function() {
  this.set().obj(
    this.seq(
      this.key("type").objid(oids),
      this.key("value").choice({ utf8str: this.utf8str(), numstr: this.numstr(), printstr: this.printstr(), t61str: this.t61str(), ia5str: this.ia5str(), visstr: this.visstr(), unistr: this.unistr(), bmpstr: this.bmpstr() }),
    ),
  );
});

export const RDNSequence = define<AttributeValue[]>("RDNSequence", function() {
  this.seqof(AttributeValue);
});

export interface SubjectPublicKeyInfo {
  algorithmIdenfitier: AlgorithmIdentifier;
  subjectPublicKey: BitString;
}
export const SubjectPublicKeyInfo = define<SubjectPublicKeyInfo>("SubjectPublicKeyInfo", function() {
  this.seq().obj(
    this.key("algorithmIdentifier").use(AlgorithmIdentifier),
    /* When decoding, we could use .contains(RSAPublicKey) to
     * automatically extract the public key as an object, but
     * then the resulting object can't be re-encoded
     * (needed to generate the fingerprint) */
    this.key("subjectPublicKey").bitstr(),
  );
});

/** An RSA public key */
export interface RSAPublicKey {
  n: bigint; // modulus
  e: bigint; // public exponent
}
export const RSAPublicKey = define<RSAPublicKey>("RSAPublicKey", function() {
  this.seq().obj(
    this.key("n").int(),
    this.key("e").int(),
  );
});

/** A certificate extension */
interface Extension {
  extnID: string | number[],
  critical?: boolean,
  extnValue: Uint8Array,
}
const Extension = define<Extension>("Extension", function() {
  this.seq().obj(
    this.key("extnID").objid(oids),
    this.key("critical").optional().bool(),
    this.key("extnValue").octstr(),
  );
});

export const Extensions = define<Extension[]>("Extensions", function() {
  this.seqof(Extension);
});

const GeneralName = define("GeneralName", function() {
  this.choice({
    otherName: this.seq().obj(this.key("typeid").objid(oids), this.key("value").any().explicit(0)).implicit(0),
    rfc822Name: this.ia5str().implicit(1),
    DNSName: this.ia5str().implicit(2),
    uri: this.ia5str().implicit(6),
    ipAddress: this.octstr().implicit(7),
    id: this.objid(oids).implicit(8),
  });
});

export const SubjectAlternativeName = define("SubjectAlternativeName", function() {
  this.seqof(GeneralName);
});

export const KeyUsage = define<BitString>("KeyUsage", function() {
  this.bitstr();
});

export const ExtKeyUsage = define<string[]>("ExtKeyUsage", function() {
  this.seqof(Oid);
});

/** The part of a certificate that is (to be) signed */
export interface TBSCertificate {
  version?: bigint,
  serialNumber: bigint,
  signature: AlgorithmIdentifier,
  issuer: AttributeValue[],
  validity: Record<"notBefore" | "notAfter", { type: "utctime" | "gentime", value: number }>,
  subject: AttributeValue[],
  publicKey: SubjectPublicKeyInfo,
  issuerUniqueId?: BitString,
  subjectUniqueId?: BitString,
  extensions: Extension[],
}
export const TBSCertificate = define<TBSCertificate>("TBSCertificate", function() {
  this.seq().obj(
    this.key("version").optional().explicit(0).int(),
    this.key("serialNumber").int(),
    this.key("signature").use(AlgorithmIdentifier),
    this.key("issuer").seqof(AttributeValue),
    this.key("validity").seq().obj(
      this.key("notBefore").choice({ utctime: this.utctime(), gentime: this.gentime() }),
      this.key("notAfter").choice({ utctime: this.utctime(), gentime: this.gentime() }),
    ),
    this.key("subject").seqof(AttributeValue),
    this.key("publicKey").use(SubjectPublicKeyInfo),
    this.key("issuerUniqueID").optional().implicit(1).bitstr(),
    this.key("subjectUniqueID").optional().implicit(2).bitstr(),
    this.key("extensions").optional().explicit(3).seqof(Extension),
  );
});

/** An X.509 certificate */
export interface Certificate {
  tbsCertificate: TBSCertificate;
  signatureAlgorithm: AlgorithmIdentifier;
  signatureValue: BitString;
}
export const Certificate = define<Certificate>("Certificate", function() {
  this.seq().obj(
    this.key("tbsCertificate").use(TBSCertificate),
    this.key("signatureAlgorithm").use(AlgorithmIdentifier),
    this.key("signatureValue").bitstr(),
  );
});

/** An RSA Private key */
export interface RSAPrivateKey extends RSAPublicKey {
  d: bigint; // private exponent
  p: bigint; // prime 1
  q: bigint; // prime 2
  dP: bigint; // dP == d % (p - 1n)
  dQ: bigint; // dQ == d % (q - 1n)
  qInv: bigint; // 1 == qInv * q % p
  version: 0n;
}
export const RSAPrivateKey = define<RSAPrivateKey>("RSAPrivateKey", function() {
  this.seq().obj(
    this.key("version").int(),
    this.key("n").int(),
    this.key("e").int(),
    this.key("d").int(),
    this.key("p").int(),
    this.key("q").int(),
    this.key("dP").int(),
    this.key("dQ").int(),
    this.key("qInv").int(),
  );
});

export const PrivateKeyInfo = define("PrivateKeyInfo", function() {
  this.seq().obj(
    this.key("version").int(),
    this.key("privateKeyAlgorithm").use(AlgorithmIdentifier),
    this.key("privateKey").octstr(),
  );
});

export interface EncryptedPrivateKeyInfo {
  encryptionAlgorithm: AlgorithmIdentifier;
  encryptedData: Uint8Array;
}
export const EncryptedPrivateKeyInfo = define<EncryptedPrivateKeyInfo>("EncryptedPrivateKeyInfo", function() {
  this.seq().obj(
    this.key("encryptionAlgorithm").use(AlgorithmIdentifier),
    this.key("encryptedData").octstr(),
  );
});

export interface PBES2Params {
  keyDerivationFunc: AlgorithmIdentifier;
  encryptionScheme: AlgorithmIdentifier;
}
export const PBES2Params = define("PBES2Params", function() {
  this.seq().obj(
    this.key("keyDerivationFunc").use(AlgorithmIdentifier),
    this.key("encryptionScheme").use(AlgorithmIdentifier),
  );
});

export interface PBKDF2Params {
  salt: { type: "specified", value: Uint8Array } | { type: "other", value: AlgorithmIdentifier };
  iterationCount: bigint;
  keyLength?: bigint;
  prf: AlgorithmIdentifier;
}
export const PBKDF2Params = define<PBKDF2Params>("PBKDF2Params", function() {
  this.seq().obj(
    this.key("salt").choice({ "specified": this.octstr(), "other": this.use(AlgorithmIdentifier) }),
    this.key("iterationCount").int(),
    this.key("keyLength").optional().int(),
    this.key("prf").use(AlgorithmIdentifier).def({ algorithm: "hmacWithSHA1" }),
  );
});

/* CMS */
export const RSAESOAEPParams = define("RSAESOAEPParams", function() {
  this.seq().obj(
    this.key("hashFunc").explicit(0).use(AlgorithmIdentifier),
    this.key("maskGenFunc").explicit(1).use(AlgorithmIdentifier),
    this.key("pSourceFunc").explicit(2).use(AlgorithmIdentifier),
  );
});

const RecipientInfo = define("RecipientInfo", function() {
  this.choice({
    ktri: this.seq().obj(
      this.key("version").int(),
      this.key("rid").choice({
        issuerAndSerialNumber: this.seq().obj(
          this.key("issuer").seqof(AttributeValue),
          this.key("serialNumber").int(),
        ),
        subjectKeyIdentifier: this.implicit(0).octstr(), // TODO
      }),
      this.key("keyEncryptionAlgorithm").use(AlgorithmIdentifier),
      this.key("encryptedKey").octstr(),
    ),
    kari: this.explicit(1).any(), // Not supported
    kekri: this.explicit(2).any(), // Not supported
    pwri: this.explicit(3).any(), // Not supported
    ori: this.explicit(4).any(), // Not supported
  });
});

/** Raw DER, e.g. to keep bytes that we do not need to look into */
export const Any = define<Uint8Array>("Any", function() {
  this.any();
});

const Attribute = define("Attribute", function() {
  this.seq().obj(
    this.key("attrType").objid(oids),
    this.key("attrValue").setof(Any),
  );
});

export const Attributes = define("Attributes", function() {
  this.setof(Attribute);
});

const SMIMECapability = define("SMIMECapability", function() {
  this.seq().obj(
    this.key("capabilityID").objid(oids),
    // Only ciphers with a variable key length, e.g. RC2, use this
    this.key("parameters").optional().any(),
  );
});

/** The algorithms that an S/MIME agent supports, in the order that it prefers
 * them. Sent as a signed attribute, so that the recipients know which cipher
 * to use when they encrypt back. RFC 8551 section 2.5.2. */
export const SMIMECapabilities = define("SMIMECapabilities", function() {
  this.seqof(SMIMECapability);
});

/** Identifies only the kind of CMS blob, e.g. signedData or envelopedData.
 * Decode the full structure with `SignedData` or `EnvelopedData`. */
export const ContentInfo = define("ContentInfo", function() {
  this.seq().obj(
    this.key("contentType").objid(oids),
    this.key("content").explicit(0).optional().any(),
  );
});

export const EnvelopedData = define("EnvelopedData", function() {
  this.seq().obj(
    this.key("contentType").objid(oids),
    this.key("content").explicit(0).seq().obj(
      this.key("version").int(),
      this.key("originatorInfo").implicit(0).optional().seq().obj( // Not supported
        this.key("certs").implicit(0).optional().setof(Any),
        this.key("crls").implicit(1).optional().setof(Any),
      ),
      this.key("recipientInfos").setof(RecipientInfo),
      this.key("encryptedContentInfo").seq().obj(
        this.key("contentType").objid(oids),
        this.key("contentEncryptionAlgorithm").use(AlgorithmIdentifier),
        this.key("encryptedContent").implicit(0).optional().octstr(),
      ),
      this.key("unprotectedAttrs").implicit(1).optional().use(Attributes),
    ),
  );
});

/** The parameters of the AES-GCM ciphers. RFC 5084 section 3.2. */
export const GCMParameters = define("GCMParameters", function() {
  this.seq().obj(
    this.key("nonce").octstr(),
    /** Length of the authentication tag, in bytes */
    this.key("icvLen").int().def(12n),
  );
});

/** Encrypted with a cipher that authenticates the content as well, i.e.
 * AES-GCM. Unlike `EnvelopedData`, the authentication tag is not appended to
 * the content, but sent separately, in `mac`. RFC 5083 section 2. */
export const AuthEnvelopedData = define("AuthEnvelopedData", function() {
  this.seq().obj(
    this.key("contentType").objid(oids),
    this.key("content").explicit(0).seq().obj(
      this.key("version").int(),
      this.key("originatorInfo").implicit(0).optional().seq().obj( // Not supported
        this.key("certs").implicit(0).optional().setof(Any),
        this.key("crls").implicit(1).optional().setof(Any),
      ),
      this.key("recipientInfos").setof(RecipientInfo),
      this.key("authEncryptedContentInfo").seq().obj(
        this.key("contentType").objid(oids),
        this.key("contentEncryptionAlgorithm").use(AlgorithmIdentifier),
        this.key("encryptedContent").implicit(0).optional().octstr(),
      ),
      this.key("authAttrs").implicit(1).optional().use(Attributes),
      this.key("mac").octstr(),
      this.key("unauthAttrs").implicit(2).optional().use(Attributes),
    ),
  );
});

export const DigestInfo = define("DigestInfo", function() {
  this.seq().obj(
    this.key("digestAlgorithm").use(AlgorithmIdentifier),
    this.key("digest").octstr(),
  );
});

export const SignerInfo = define("SignerInfo", function() {
  this.seq().obj(
    this.key("version").int(),
    this.key("sid").choice({
      issuerAndSerialNumber: this.seq().obj(
        this.key("issuer").seqof(AttributeValue),
        this.key("serialNumber").int(),
      ),
      subjectKeyIdentifier: this.implicit(0).octstr(), // TODO
    }),
    this.key("digestAlgorithm").use(AlgorithmIdentifier),
    this.key("signedAttrs").implicit(0).optional().use(Attributes),
    this.key("signatureAlgorithm").use(AlgorithmIdentifier),
    this.key("signature").octstr(),
    this.key("unsignedAttrs").implicit(1).optional().use(Attributes),
  );
});

export const SignedData = define("SignedData", function() {
  this.seq().obj(
    this.key("contentType").objid(oids),
    this.key("content").explicit(0).seq().obj(
      this.key("version").int(),
      this.key("digestAlgorithms").setof(AlgorithmIdentifier),
      this.key("contentInfo").seq().obj(
        this.key("contentType").objid(oids),
        this.key("content").explicit(0).optional().any(),
      ),
      this.key("certificates").implicit(0).optional().setof(Certificate),
      this.key("crls").implicit(1).optional().setof(Any),
      this.key("signerInfos").setof(SignerInfo),
    ),
  );
});

export const CertificationRequestInfo = define("CertificationRequestInfo", function() {
  this.seq().obj(
    this.key("version").int(),
    this.key("subject").seqof(AttributeValue),
    this.key("subjectPublicKeyInfo").use(SubjectPublicKeyInfo),
    this.key("attributes").implicit(0).use(Attributes),
  );
});

export const CertificationRequest = define("CertificationRequest", function() {
  this.seq().obj(
    this.key("certificationRequestInfo").use(CertificationRequestInfo),
    this.key("signatureAlgorithm").use(AlgorithmIdentifier),
    this.key("signature").bitstr(),
  );
});

/* PKCS#12, RFC 7292 */

/** The contents of a .p12 or .pfx file: private keys and certificates,
 * protected by a passphrase. `macData` guards against tampering. */
export const PFX = define("PFX", function() {
  this.seq().obj(
    this.key("version").int(),
    this.key("authSafe").use(ContentInfo),
    this.key("macData").optional().seq().obj(
      this.key("mac").use(DigestInfo),
      this.key("macSalt").octstr(),
      this.key("iterations").def(1n).int(),
    ),
  );
});

/** The `authSafe` of a `PFX`, grouping the bags by how they are protected:
 * either `data`, i.e. in the clear, or `encryptedData` */
export const AuthenticatedSafe = define("AuthenticatedSafe", function() {
  this.seqof(ContentInfo);
});

/** Content that is encrypted with a passphrase. RFC 5652 section 8 */
export const EncryptedData = define("EncryptedData", function() {
  this.seq().obj(
    this.key("version").int(),
    this.key("encryptedContentInfo").seq().obj(
      this.key("contentType").objid(oids),
      this.key("contentEncryptionAlgorithm").use(AlgorithmIdentifier),
      this.key("encryptedContent").implicit(0).optional().octstr(),
    ),
  );
});

/** One private key, certificate or CRL, and how it is stored.
 * `bagValue` depends on `bagId`, e.g. an `EncryptedPrivateKeyInfo`
 * for a pkcs8ShroudedKeyBag, or a `CertBag` for a certBag. */
const SafeBag = define("SafeBag", function() {
  this.seq().obj(
    this.key("bagId").objid(oids),
    this.key("bagValue").explicit(0).any(),
    // Only names and IDs, which we do not need
    this.key("bagAttributes").optional().setof(Any),
  );
});

export const SafeContents = define("SafeContents", function() {
  this.seqof(SafeBag);
});

export const CertBag = define("CertBag", function() {
  this.seq().obj(
    this.key("certId").objid(oids),
    this.key("certValue").explicit(0).octstr(),
  );
});

/** Parameters of the password-based encryption algorithms
 * that are specific to PKCS#12, e.g. pbeWithSHAAnd40BitRC2CBC */
export const PBEParams = define("PBEParams", function() {
  this.seq().obj(
    this.key("salt").octstr(),
    this.key("iterations").int(),
  );
});

/* Usage for the above definitions:
 * Decode a certificate in PEM format (string):
 * cert = Certificate.decodePEM(plaintext, { label: "CERTIFICATE" });
 * Decode a certificate in DER format (Uint8Array):
 * cert = Certificate.decode(uint8array);
 * Encode a certificate to DER format (Uint8Array):
 * uint8array = Certificate.encode(cert);
 * Encode a certificate to PEM format (string):
 * plaintext = Certificate.encodePEM(cert, { label: "CERTIFICATE" });
 * Decode the RSA public key from a certificate:
 * RSAPublicKey.decode(cert.tbsCertificate.publicKey.subjectPublicKey.data)
 */
