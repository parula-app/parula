/* Our own EC keys, each with a self-signed certificate for user@example.com,
 * generated with OpenSSL 3.0. Test keys only. Do not use them for anything else.
 * openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out ec.key
 * openssl req -new -x509 -key ec.key -subj "/CN=EC 256 User" -days 7300 \
 *   -set_serial 0x$(openssl rand -hex 8) -config self.cnf -extensions self -out ec.pem
 * where the section `self` of `self.cnf` has:
 * basicConstraints = critical, CA:FALSE
 * keyUsage = critical, digitalSignature, keyAgreement
 * extendedKeyUsage = emailProtection
 * subjectAltName = email:user@example.com
 * subjectKeyIdentifier = hash */

/** Curve P-256 */
export const kOwnP256 = `
-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgIWqVTeWuRti8Gcnv
vdX0nmfJrzFJ5VTzPp6A8OtXXHyhRANCAASvy/txlF3JrLy7aTLe3m8/dZ8BW3GR
9yr1cai4CuG4lX+i3BViXUXiYW6pLXsKPNbghE1ehvPuEUlFJuoxqqet
-----END PRIVATE KEY-----
-----BEGIN CERTIFICATE-----
MIIBlDCCATqgAwIBAgIJAM8856hmsFZPMAoGCCqGSM49BAMCMBYxFDASBgNVBAMM
C0VDIDI1NiBVc2VyMB4XDTI2MTEwNjEzMTkwM1oXDTQ2MTEwMTEzMTkwM1owFjEU
MBIGA1UEAwwLRUMgMjU2IFVzZXIwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASv
y/txlF3JrLy7aTLe3m8/dZ8BW3GR9yr1cai4CuG4lX+i3BViXUXiYW6pLXsKPNbg
hE1ehvPuEUlFJuoxqqeto3EwbzAMBgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwID
iDATBgNVHSUEDDAKBggrBgEFBQcDBDAbBgNVHREEFDASgRB1c2VyQGV4YW1wbGUu
Y29tMB0GA1UdDgQWBBQErEzvkgEGLoegXwhdM+o/VN3gkDAKBggqhkjOPQQDAgNI
ADBFAiAxxvuNwJLGI96Zdu3omnnXDglGnc/2u3gY53rq3oazqwIhAIneoeCUVckz
vBUWTE6fQKBKZC/wAOfisZtauyUPSFCf
-----END CERTIFICATE-----
`;

/** Curve P-384 */
export const kOwnP384 = `
-----BEGIN PRIVATE KEY-----
MIG2AgEAMBAGByqGSM49AgEGBSuBBAAiBIGeMIGbAgEBBDDLZxOPsJD/sOkOfQSa
zacN1931/fz+KgaNfiGe/AXY/RoDo0SYVQ4+aWY7HSggCMChZANiAASU0G2OgHLK
/83olMdyGpnUMgLur0HZNd/1fCnMSesJV/KXIJfyZXBhesILS1P0jJRmWOO9aaKk
dQWX40xlIpoJ3MWQ4UDB0Km09MMZZv6JKGvNJhQku0zxnuVjDMHDmkk=
-----END PRIVATE KEY-----
-----BEGIN CERTIFICATE-----
MIIB0DCCAVagAwIBAgIIGaO73wXRgMswCgYIKoZIzj0EAwIwFjEUMBIGA1UEAwwL
RUMgMzg0IFVzZXIwHhcNMjYxMTA2MTMxOTAzWhcNNDYxMTAxMTMxOTAzWjAWMRQw
EgYDVQQDDAtFQyAzODQgVXNlcjB2MBAGByqGSM49AgEGBSuBBAAiA2IABJTQbY6A
csr/zeiUx3IamdQyAu6vQdk13/V8KcxJ6wlX8pcgl/JlcGF6wgtLU/SMlGZY471p
oqR1BZfjTGUimgncxZDhQMHQqbT0wxlm/okoa80mFCS7TPGe5WMMwcOaSaNxMG8w
DAYDVR0TAQH/BAIwADAOBgNVHQ8BAf8EBAMCA4gwEwYDVR0lBAwwCgYIKwYBBQUH
AwQwGwYDVR0RBBQwEoEQdXNlckBleGFtcGxlLmNvbTAdBgNVHQ4EFgQU4kIt0tmm
4IPOb9hWGOaZO4yXSmMwCgYIKoZIzj0EAwIDaAAwZQIxAM41HF5f4JugIvShRBt6
+2zWz1Q+yjwdSiH3+oH93cmokwQAXQtI9jNIGAeD4f0aPwIwO0Y6FOJClyelMBfK
NvghZ8iUorXnlo1/MxBk+ekci/Q3A041SaB2LUgCdV9tsP3p
-----END CERTIFICATE-----
`;

/** Curve P-521 */
export const kOwnP521 = `
-----BEGIN PRIVATE KEY-----
MIHuAgEAMBAGByqGSM49AgEGBSuBBAAjBIHWMIHTAgEBBEIBWBYfzV8Pwje7PlUi
mZzeIb+LlJeWGHdql0uVpYz1r1PGzUUqs0/+/8CgBG6WiWooI0atufwEybKcNdxh
hMiK5SKhgYkDgYYABABbR9jA2LjuIJBae67kWWRTUTjGBB6wzXs70bjDsI2Wd85v
sxMg+SY/lAJCq4ZzbuqaJwaOWC+bzhwgX4oI9HSehAGQpN3xTAfZlqjR1Xb1Gjq3
euaSPpzoAu0MbWkfCSQWW2noPpXbGjSFKGFztasuQTXI9V+LIQOIxQ6QS55q8Kyb
ZQ==
-----END PRIVATE KEY-----
-----BEGIN CERTIFICATE-----
MIICHDCCAX2gAwIBAgIJAPdJ/Frn3Yu/MAoGCCqGSM49BAMCMBYxFDASBgNVBAMM
C0VDIDUyMSBVc2VyMB4XDTI2MTEwNjEzMTkwM1oXDTQ2MTEwMTEzMTkwM1owFjEU
MBIGA1UEAwwLRUMgNTIxIFVzZXIwgZswEAYHKoZIzj0CAQYFK4EEACMDgYYABABb
R9jA2LjuIJBae67kWWRTUTjGBB6wzXs70bjDsI2Wd85vsxMg+SY/lAJCq4Zzbuqa
JwaOWC+bzhwgX4oI9HSehAGQpN3xTAfZlqjR1Xb1Gjq3euaSPpzoAu0MbWkfCSQW
W2noPpXbGjSFKGFztasuQTXI9V+LIQOIxQ6QS55q8KybZaNxMG8wDAYDVR0TAQH/
BAIwADAOBgNVHQ8BAf8EBAMCA4gwEwYDVR0lBAwwCgYIKwYBBQUHAwQwGwYDVR0R
BBQwEoEQdXNlckBleGFtcGxlLmNvbTAdBgNVHQ4EFgQUPnJdq0T/ArXqr9gp/OdI
xyCDDE8wCgYIKoZIzj0EAwIDgYwAMIGIAkIBLdWkMAiwViJ386zrrpqmzotU+F/A
M9znA00zCorplKjbt2ovZ8K0zrh6fK42Ow5mb2j3GW4v0SwKOUdDo3w23foCQgE+
gb7RE97z9V/Xi94YiZyal3bItiry2j0wtxw8pisYk6bJmOd5LKKsczePmd+oXzhq
72PefbvdhwBa8ncHA1RUWg==
-----END CERTIFICATE-----
`;

/** Curve secp256k1, which WebCrypto does not have.
 * openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:secp256k1 */
export const kSecp256k1Key = `
-----BEGIN PRIVATE KEY-----
MIGEAgEAMBAGByqGSM49AgEGBSuBBAAKBG0wawIBAQQgeVVEFPhScSNcJF5//WMa
M2W2Jz2Lyjcoc9XI0hLPQ8ahRANCAARXYpvnizZUCW2kOrF31dbXHYLgR7e62orH
O0U3s6MSavB8jbP4XtSVH1tC51jjbCAKXPgRFnPaE5d7RQrUX6Gk
-----END PRIVATE KEY-----
`;

/** Ed25519, which S/MIME here does not support.
 * openssl genpkey -algorithm ed25519 */
export const kEd25519Key = `
-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIIXYd/0pXjPMwo3WZfoCzfOPmNm/MkX2wKtwa0DBCiZ0
-----END PRIVATE KEY-----
`;
