// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../../logic/app";
import { appGlobal } from "../../../../../logic/app";
import { SMIMEPublicKey, KeyStatus } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEPublicKey";
import { CCADBCertificates } from "../../../../../logic/Mail/Encryption/SMIME/CCADBCertificates";
import { Certificate } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEASN1";
import { trustTestCAs } from "../../../Contacts/testCertificate";
import { k1DayMS, k1HourMS, k1WeekMS } from "../../../../../logic/util/date";
import { afterAll, beforeEach, expect, test, vi } from "vitest";

/* Generated with:
 * openssl req -x509 -newkey rsa:2048 -keyout root.key -out root.pem -days 3650 -nodes \
 *   -subj "/CN=Test Public Root CA" -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
 * openssl req -newkey rsa:2048 -keyout int.key -out int.csr -nodes -subj "/CN=Test Public Email CA"
 * openssl x509 -req -in int.csr -CA root.pem -CAkey root.key -CAcreateserial -out int.pem -days 3500 -extfile ca.ext
 *   (ca.ext: basicConstraints=critical,CA:TRUE; keyUsage=critical,keyCertSign,cRLSign; extendedKeyUsage=emailProtection,clientAuth)
 * openssl req -newkey rsa:2048 -keyout leaf.key -out leaf.csr -nodes -subj "/CN=Public User/emailAddress=public@example.com"
 * openssl x509 -req -in leaf.csr -CA int.pem -CAkey int.key -CAcreateserial -out leaf.pem -days 3000 -extfile leaf.ext
 *   (leaf.ext: CA:FALSE, extendedKeyUsage=emailProtection, subjectAltName=email:public@example.com)
 * and the same with "Rogue Root CA", "Rogue Email CA" and rogue@example.com.
 * Each converted with `openssl x509 -in x.pem -outform DER | base64 -w0`.
 */
/** Trusted, as a root of the OS */
const kRoot = "MIIDLTCCAhWgAwIBAgIUB/w87NOEh3GhvxiPSKKNdU+ixf0wDQYJKoZIhvcNAQELBQAwHjEcMBoGA1UEAwwTVGVzdCBQdWJsaWMgUm9vdCBDQTAeFw0yNjExMDUxMTEyNTRaFw0zNjExMDIxMTEyNTRaMB4xHDAaBgNVBAMME1Rlc3QgUHVibGljIFJvb3QgQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCoWd8+FdtPvv3bWavgw/lFuagA85ePXjl4j2HzNzljC5YFldxri4QFuLoLR2NuIdmnQ1ndmbEcPGLnTIRvqHP2EP76YtU0XgwyjrkZtXZhhEIxqYrXn3vIpZT0282c9v2V+tJfBcld1eXSLshw5k9GpIk9imufj8ptsAMxGXnBEAe99aeTRDhdI9jSQ4QqmxihB6wbIzqa1+SJ9bsakxPtautH6BinXoT1VOfWESAAa8XctlBAed2kxAY0aSIW34Z0wUnOKAhuAB1FGK7IX0kxhhAO28LHWKgYtoGdo5BGtkq9boZM+RL/dYnpn2JgM8UihZpiLj3xBu22eUlMXU01AgMBAAGjYzBhMB0GA1UdDgQWBBQ1Mqq7Hr9Y8eX/LBGXnBTpvKsvdDAfBgNVHSMEGDAWgBQ1Mqq7Hr9Y8eX/LBGXnBTpvKsvdDAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBBjANBgkqhkiG9w0BAQsFAAOCAQEANVVJcmcNkgqtfrOuRrKhU5xex8RjZAPK/Zzq/ntoE7lcAZlxlNtYAwI/NKGFNdt6IdllvpqLFFZuBR1pwcxw7oi/TBA4fjBIYwGqSbJLIjrc2REi2wmf/v862Q+RvV4E+7vKVm2WvM24u5WZG+rIusm7H3UZ7nRRDVe6mW+XXC+h4G+64eq/1JmkSZsJ2T2iBkX1P3cLhdb0OG3JhAsfoqB/gbRiRk0xIyrMq4c5dykZtKap7PlyjWRK7zBqmJFqSA0eIkoCNBqdgTEU70qJ93UBhB++yzriHWck4Z92YFmd6EPV4M8URv+JVEO3/zh3PtQmyCbnqACg1GoQ3YTkEA==";
/** Issued by `kRoot`. Public: in the CCADB list */
const kIntermediate = "MIIDTzCCAjegAwIBAgIUDtvkRjA8Mowe96ZRmaPDwYQX0O8wDQYJKoZIhvcNAQELBQAwHjEcMBoGA1UEAwwTVGVzdCBQdWJsaWMgUm9vdCBDQTAeFw0yNjExMDUxMTEyNTRaFw0zNjA2MDUxMTEyNTRaMB8xHTAbBgNVBAMMFFRlc3QgUHVibGljIEVtYWlsIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsmM8DBNHjaReGDUeer9sRmearijMcr5dcS/whIwu4UL5I0pino/Yt1t41icEet5zvIr6K0/qyCs4etc71fB9kCQKHy1kfK3J8Yg9aqKVPJC3d/NRwX2z8rADYpPz646OTbEYuipx5ALboTVJOfUojdyK0hJsmZu//zNEYT4aig/H4gW6osKdHlCqw1tAUQ+/qnj6vKMEn+zwqKTLhcayWD5nPpnt4PKdb7BWH0xsYmkI4fiIqg9Vo74w8G2i0pmrj1X/5AG9XDNRi4eGVuWYQwCCBFC8G+xZnyE/RGeYXqxZMnaod9xakrNHJVF4JvK+w5YIq+cBWyTLLaoMlvc6IQIDAQABo4GDMIGAMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMB0GA1UdJQQWMBQGCCsGAQUFBwMEBggrBgEFBQcDAjAdBgNVHQ4EFgQUReyFzQfBsU+a6lU0wEC4Gfl5uRwwHwYDVR0jBBgwFoAUNTKqux6/WPHl/ywRl5wU6byrL3QwDQYJKoZIhvcNAQELBQADggEBAJMIGmvbMcr/n5Ns8jYHoLlsqi4kpyRvynX4UYz3tn+tcHzPhjFUKQnIaN4j13+2PIY+Ms/3gUrrQVAFYGVUeS2J0b+f8tJsEeHG1bdahw/O2WGFEMd+4lBcjm0nL9DBF9gKrlNRuhJoBkNkMEiQQ5srzXo569VESw7Eqc2mqoWqT3L5/9SfEi0i/Y4ZFE2gF5u8qD+ZJz7Hv/MmGyMPVHNvGF0rlsFmzrnIh2S8HKyLjJHunpu+J/faV2n21pmB0RtouJDWs2JSREfQd5Eo/agd4ZF9WXNZSnNMWAY59Acj71M/u+zjB5Q6JwnhrVnmRgwHKVobJriGyNV5uJze7Lg=";
/** Issued by `kIntermediate` */
const kLeaf = "MIIDfDCCAmSgAwIBAgIUDrLx0+VHp61n4h/mzQwUhPBzd7MwDQYJKoZIhvcNAQELBQAwHzEdMBsGA1UEAwwUVGVzdCBQdWJsaWMgRW1haWwgQ0EwHhcNMjYxMTA1MTExMjU0WhcNMzUwMTIyMTExMjU0WjA5MRQwEgYDVQQDDAtQdWJsaWMgVXNlcjEhMB8GCSqGSIb3DQEJARYScHVibGljQGV4YW1wbGUuY29tMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEApJ3YQ86TZfbVBbQdi1iUiMjxLXF7NS4pxcn45Kqr6+V0wBuzS8CBM60k0LDbuKew59AVfG71SNHWHNpI8t1ilC/sLXbb+dNDhjRhS7UOTye+nLUFGH1nJS9qfiw4ZPJc6XvlcKvpGM/gv5UvzkfwyFxFVz6/sUAxibTFk4Pa1/A/QxPubRXXJU54FcDoMD+AZQgdyv/YeY8ewCUk7ldonWmySUnECnUlB363H3B8cnhz/utPPAaBWJKUR16QDgG9kBFI2KaJAvnFRtguMqtNI+7Ky86Uo+4sgZec9bDejztlBkscy1NAWIcEN2kNcFHKKIw+ZvqJ8oYdRhBSiOiMJwIDAQABo4GVMIGSMAwGA1UdEwEB/wQCMAAwDgYDVR0PAQH/BAQDAgWgMBMGA1UdJQQMMAoGCCsGAQUFBwMEMB0GA1UdEQQWMBSBEnB1YmxpY0BleGFtcGxlLmNvbTAdBgNVHQ4EFgQU+Xvx6vgwHlX5GHxKT/sEdzFHc/0wHwYDVR0jBBgwFoAUReyFzQfBsU+a6lU0wEC4Gfl5uRwwDQYJKoZIhvcNAQELBQADggEBAHr2eNz38MXFtAeDhH9W8RgQlLZgC2Vt7Z6JnC3IGXzY3QxzoEBLgqBPMSmLn4IajCyztCQRTVuod3JySFkocuqe4Dk+SlKz9JS2bCnVF6TUDeRULHG541fAAW08cj28X7JrXw6fLS1+8PQ4rP6nLck9DdNBDPzAqDpptth6gG/rdXySumPNCHy/HfbzhTe0gZqBTkEqmN/Sje5cApT0kCC31S3RFb3ZR5JuZTzl/22OVQU1fXuyG9YSbscP11G0xFcPal+gPVBVw1GST1LIBA4ucLJAQauJ2RytcX5TTCTUwmY2jzu3WYfsF/MpT1ma41oPXEx7MR7p+geGIv0qX6w=";
/** Issued by "Rogue Root CA", which nobody trusts */
const kRogueIntermediate = "MIIDQzCCAiugAwIBAgIUENx1i9F0lkiaNp6flK6xnq6nfmAwDQYJKoZIhvcNAQELBQAwGDEWMBQGA1UEAwwNUm9ndWUgUm9vdCBDQTAeFw0yNjExMDUxMTEyNTVaFw0zNjA2MDUxMTEyNTVaMBkxFzAVBgNVBAMMDlJvZ3VlIEVtYWlsIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvUQgneYJ6Wd55i/QlQyiDWqzt2g4vJDC6A6lMY5/Vkut+qzj8zCKnY7BshEPwfmcVfG/h1WveZLeUk3PQoQaaLxVfk+mKNHmGmI729PeEykQeu4om/4RfheH+oKFy8PTHEmleeC8FoOcMkjZFbloOmvLebC0T37fOqrywXxtUmUQwwNCVgS1cM+jdRilMYMid9xhgM7iSkCLhO2VznJAhNeGebtXCm2qCV/SLjy38ZYujAO9RifZIfLOTjavsPvIB/cgIW1tbsWJLRpjmn/uhHVL2HfWIhWhOObpDtkch5xG/u0A5XaZNolSfDK+kvK6iFGC7p9TzZ7yGVOUIx9ajQIDAQABo4GDMIGAMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMB0GA1UdJQQWMBQGCCsGAQUFBwMEBggrBgEFBQcDAjAdBgNVHQ4EFgQUf7PNHsPl9vMMGmCw1g2frDdG6IMwHwYDVR0jBBgwFoAUg8/I01ZF/fFA29Tu1sLilK1Q7vAwDQYJKoZIhvcNAQELBQADggEBAH78USiYoWKk/r2EOpqLhmh0v9xMEAJCrhX/oUH1Ps+DRE6AWSidYErR0bTbqaIBsBkmdRNRxpFpwKbmv1JRvJXIHz2xXRPCcbcT6RGQxtxTwN3lvEy0CYuMYmI+7k7y3xLB8W8i1CGNYhtrMyd68aLsYOa57JmeBMyhvaAwxxCB/wmYaIzzCZw/o7WjDUnhJ/w4dpok6927IMDmXv0wknfq7+upGl5VcEA3OFVi6jt/lzxsed72R61eIGS5uCpvuE/cB1yfsPsp2uldxblvhU/2ZrtH86a/rA84f9tzbQCdaQXQObCiz6JLQvr0M9uycRrTv8a3V2CvXnB3jCkHZrA=";
/** Issued by `kRogueIntermediate` */
const kRogueLeaf = "MIIDczCCAlugAwIBAgIUcVKGvU+nkW0hDSJcts4EraNeftYwDQYJKoZIhvcNAQELBQAwGTEXMBUGA1UEAwwOUm9ndWUgRW1haWwgQ0EwHhcNMjYxMTA1MTExMjU1WhcNMzUwMTIyMTExMjU1WjA3MRMwEQYDVQQDDApSb2d1ZSBVc2VyMSAwHgYJKoZIhvcNAQkBFhFyb2d1ZUBleGFtcGxlLmNvbTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAM0KSrHv8/3cFej1CuvyU8htbXSbynTD3KTtMfdGrVSYBZQ/iyslMLaeqFvO7P4ZInXEJY5zs63UlXaZ3GC3Lvp0+8yygUGLyxEwSj1Dvn7quhGu7ULAqEDisWlm/mCmxqhF4RRegKhcUn+g/uDXk54bVVNharjH98IgIOyP5Jx4oTF8ncNXCTYqF5ipmsjR75KshcUYkPO2VvNiqXE+OGIYN3Lpdq4mcEjSi9i2/3aMzB2kNEDazg6hLmP6TM1bsRF1SSBcDCzHt0J7URxorlgDfQOdwe5IwhurqRYShQNE4skKwAEQhSaM5XRRRIIVZjjq9mlpEwMUW+vJhHjNLN0CAwEAAaOBlDCBkTAMBgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIFoDATBgNVHSUEDDAKBggrBgEFBQcDBDAcBgNVHREEFTATgRFyb2d1ZUBleGFtcGxlLmNvbTAdBgNVHQ4EFgQU2mAHVqAslVX3ZSe3QthExYdLECwwHwYDVR0jBBgwFoAUf7PNHsPl9vMMGmCw1g2frDdG6IMwDQYJKoZIhvcNAQELBQADggEBADb3KTplcTcFXxpBIawAVugDdriseMSjUTZiDR8KpqNPXdIjz7RxNvATnAW3YUhMEXPo2g3Y7IfWI/jmAhP1V+jCiDHbcfAfmyw365d0lPeiQ1YM+3nEfxKb2aknC9ma9cW7ZhKpurUFgyeHepxgQaXs4RASsORMZZQg5QshJsa/YhhWp60oZEsTxznNWG5zXj3w40e8H34DRy16u8gNgchIXlTrhRS5QH3MVb2nzjG+bSdt1L5gJnwIixsNIM4+wd9+9jdwfRL1TUiHZmsUHTe9Cfe29mlPDWhSVLtDbvzQ6Zg+wqHBMqp0MQAbGvIUA0Pf94ghMafEdo/iL9uSC7g=";

function pem(base64: string): string {
  return Certificate.encodePEM(Certificate.decodeFromBase64(base64), { label: "CERTIFICATE" });
}

/** Like the CCADB report: the columns that we need between others,
 * and the PEM in apostrophes */
function ccadbCSV(...rows: [extKeyUsage: string, certificate: string][]): string {
  return [
    `"CA Owner","Certificate Subject Common Name","Extended Key Usage","Comments","PEM Info"`,
    ...rows.map(([extKeyUsage, certificate]) => `"Test CA","Test, Inc.","${extKeyUsage}","Says ""hi""","'${pem(certificate)}'"`),
  ].join("\n");
}

let downloads: string[];
let response: () => Promise<string>;
let files: Record<string, Uint8Array>;

trustTestCAs();
Object.assign(appGlobal.remoteApp, {
  async getCACertificates(type: string): Promise<string[]> {
    return type == "system" ? [pem(kRoot)] : [];
  },
  async getConfigDir(): Promise<string> {
    return "/config";
  },
  async readFile(path: string): Promise<ArrayBufferLike> {
    if (!files[path]) {
      throw Object.assign(new Error("No such file"), { code: "ENOENT" });
    }
    return files[path].buffer;
  },
  async writeFile(path: string, permissions: number, contents: Uint8Array): Promise<void> {
    files[path] = contents;
  },
  async kyCreate(): Promise<any> {
    return {
      async get(url: string): Promise<string> {
        downloads.push(url);
        return await response();
      },
    };
  },
});

const kList = ccadbCSV(
  ["ExtKeyUsageClientAuth,ExtKeyUsageEmailProtection", kIntermediate],
  ["", kRogueIntermediate],
);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-06-01T10:00:00Z"));
  downloads = [];
  files = {};
  response = async () => kList;
  SMIMEPublicKey.publicIntermediates = new CCADBCertificates("https://ccadb.example.com/intermediates.csv", "intermediates.json");
});

afterAll(() => {
  vi.useRealTimers();
});

async function keyStatus(certificate: string): Promise<KeyStatus> {
  let key = await SMIMEPublicKey.importPublicKey(pem(certificate));
  return await key.keyStatus();
}

test("A certificate whose intermediate CA is missing is valid, if the intermediate is in the public list", async () => {
  expect(await keyStatus(kLeaf)).toBe(KeyStatus.Valid);
  expect(downloads).toEqual(["https://ccadb.example.com/intermediates.csv"]);
});

test("An intermediate CA from the list must still chain to a trusted root", async () => {
  expect(await keyStatus(kRogueLeaf)).not.toBe(KeyStatus.Valid);
});

test("Keeps only the CAs that may issue S/MIME certificates", async () => {
  response = async () => ccadbCSV(["ExtKeyUsageServerAuth,ExtKeyUsageClientAuth", kIntermediate]);
  expect(await keyStatus(kLeaf)).not.toBe(KeyStatus.Valid);
});

test("The first checks download the list once, also when they run at the same time", async () => {
  let statuses = await Promise.all([keyStatus(kLeaf), keyStatus(kLeaf), keyStatus(kRogueLeaf)]);
  expect(statuses[0]).toBe(KeyStatus.Valid);
  expect(statuses[1]).toBe(KeyStatus.Valid);
  expect(downloads).toHaveLength(1);
});

test("The list is cached on disk", async () => {
  expect(await keyStatus(kLeaf)).toBe(KeyStatus.Valid);
  SMIMEPublicKey.publicIntermediates = new CCADBCertificates("https://ccadb.example.com/intermediates.csv", "intermediates.json");
  expect(await keyStatus(kLeaf)).toBe(KeyStatus.Valid);
  expect(downloads).toHaveLength(1);
});

test("A check that fails with a recent list does not download it again", async () => {
  response = async () => ccadbCSV(["", kRogueIntermediate]);
  expect(await keyStatus(kRogueLeaf)).not.toBe(KeyStatus.Valid);
  expect(downloads).toHaveLength(1);
  vi.setSystemTime(Date.now() + 20 * k1HourMS);
  expect(await keyStatus(kLeaf)).not.toBe(KeyStatus.Valid);
  expect(await keyStatus(kLeaf)).not.toBe(KeyStatus.Valid);
  expect(downloads).toHaveLength(1);
});

test("A check that fails with a list older than a day downloads it once more", async () => {
  response = async () => ccadbCSV(["", kRogueIntermediate]);
  expect(await keyStatus(kRogueLeaf)).not.toBe(KeyStatus.Valid);
  vi.setSystemTime(Date.now() + k1DayMS + k1HourMS);
  response = async () => kList;
  expect(await keyStatus(kLeaf)).toBe(KeyStatus.Valid);
  expect(downloads).toHaveLength(2);
});

test("A failed download is not repeated by every check", async () => {
  response = async () => { throw new Error("Network down"); };
  expect(await keyStatus(kLeaf)).not.toBe(KeyStatus.Valid);
  expect(await keyStatus(kLeaf)).not.toBe(KeyStatus.Valid);
  expect(downloads).toHaveLength(1);
});

test("The list is downloaded again after a week", async () => {
  expect(await keyStatus(kLeaf)).toBe(KeyStatus.Valid);
  vi.setSystemTime(Date.now() + k1WeekMS + k1HourMS);
  expect(await keyStatus(kLeaf)).toBe(KeyStatus.Valid);
  expect(downloads).toHaveLength(2);
});

test("A bad download keeps the old list", async () => {
  expect(await keyStatus(kLeaf)).toBe(KeyStatus.Valid);
  for (let bad of ["<html>Server error</html>", "", ccadbCSV(), kList.replaceAll("MII", "xyz"), kList + " ".repeat(20 * 1000 * 1000)]) {
    vi.setSystemTime(Date.now() + k1WeekMS + k1HourMS);
    response = async () => bad;
    expect(await keyStatus(kLeaf)).toBe(KeyStatus.Valid);
  }
  expect(downloads).toHaveLength(6);
});

test("A bad download without a cached list fails the check without an exception", async () => {
  response = async () => "\"PEM Info\"\n\"'-----BEGIN CERTIFICATE-----\nMIIgarbage\n-----END CERTIFICATE-----'\"";
  expect(await keyStatus(kLeaf)).toBe(KeyStatus.ChainIncomplete);
});
