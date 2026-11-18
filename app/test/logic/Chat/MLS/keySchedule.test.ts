/** The official MLS interop test vectors for the key schedule, from
 * <https://github.com/mlswg/mls-implementations> `test-vectors/`, trimmed to the
 * cipher suites we implement.
 *
 * They pin every secret of RFC 9420 § 8, the transcript hashes of § 8.2 and the
 * PSK secret of § 8.4 byte for byte. The main thing they catch is a swapped
 * `KDF.Extract(salt, ikm)`: the § 8 diagram takes the salt from the top
 * (`init_secret`, then `joiner_secret`) and the IKM from the left
 * (`commit_secret`, then `psk_secret`). Swapping the two yields secrets that
 * look perfectly good and match nobody else's. */
import { ExternalPSKID, KeySchedule, PreSharedKeys, TranscriptHash } from "../../../../logic/Chat/MLS/KeySchedule";
import { CipherSuite } from "../../../../logic/Chat/MLS/Crypto/CipherSuite";
import { TLSWriter } from "../../../../logic/Chat/MLS/Codec/TLSWriter";
import keySchedules from "./vectors/key-schedule.json";
import pskSecrets from "./vectors/psk_secret.json";
import transcriptHashes from "./vectors/transcript-hashes.json";
import { expect, test } from "vitest";

for (let vector of keySchedules) {
  let suite = supportedSuite(vector.cipher_suite);
  if (!suite) {
    continue;
  }
  test(`key schedule for ${suite.name}`, () => {
    let initSecret = hex(vector.initial_init_secret);
    for (let epoch of vector.epochs) {
      let groupContext = hex(epoch.group_context);
      let pskSecret = hex(epoch.psk_secret);
      let schedule = KeySchedule.advance(suite, initSecret, hex(epoch.commit_secret), groupContext, pskSecret);
      expect(bytes(schedule.joinerSecret)).toBe(epoch.joiner_secret);
      expect(bytes(schedule.welcomeSecret)).toBe(epoch.welcome_secret);
      expect(bytes(schedule.senderDataSecret)).toBe(epoch.sender_data_secret);
      expect(bytes(schedule.encryptionSecret)).toBe(epoch.encryption_secret);
      expect(bytes(schedule.exporterSecret)).toBe(epoch.exporter_secret);
      expect(bytes(schedule.externalSecret)).toBe(epoch.external_secret);
      expect(bytes(schedule.confirmationKey)).toBe(epoch.confirmation_key);
      expect(bytes(schedule.membershipKey)).toBe(epoch.membership_key);
      expect(bytes(schedule.resumptionPSK)).toBe(epoch.resumption_psk);
      expect(bytes(schedule.epochAuthenticator)).toBe(epoch.epoch_authenticator);
      expect(bytes(schedule.initSecret)).toBe(epoch.init_secret);
      expect(bytes(schedule.externalKeyPair().publicKey)).toBe(epoch.external_pub);

      // The vector's exporter label is a plain string, its context is bytes
      let exporter = epoch.exporter;
      expect(bytes(schedule.exportSecret(exporter.label, hex(exporter.context), exporter.length)))
        .toBe(exporter.secret);

      // A member who joined from a Welcome only has the joiner secret, and must
      // arrive at the very same epoch
      let joiner = KeySchedule.fromJoinerSecret(suite, hex(epoch.joiner_secret), groupContext, pskSecret);
      expect(bytes(joiner.epochSecret)).toBe(bytes(schedule.epochSecret));
      expect(bytes(joiner.initSecret)).toBe(epoch.init_secret);

      let welcome = schedule.welcomeKeyAndNonce();
      expect(welcome.key.length).toBe(suite.aead.keyLength);
      expect(welcome.nonce.length).toBe(suite.aead.nonceLength);

      initSecret = schedule.initSecret;
    }
  });
}

for (let vector of transcriptHashes) {
  let suite = supportedSuite(vector.cipher_suite);
  if (!suite) {
    continue;
  }
  test(`transcript hashes for ${suite.name}`, () => {
    // The vector gives the whole AuthenticatedContent of the Commit. The
    // ConfirmedTranscriptHashInput of § 8.2 is that, minus the trailing
    // `MAC confirmation_tag` of the FramedContentAuthData.
    let content = hex(vector.authenticated_content);
    let tagLength = suite.secretLength;
    let headerLength = new TLSWriter().variableLength(tagLength).finish().length;
    let confirmedInput = content.subarray(0, content.length - headerLength - tagLength);
    let tagInContent = content.subarray(content.length - tagLength);

    let confirmed = TranscriptHash.confirmed(suite, hex(vector.interim_transcript_hash_before), confirmedInput);
    expect(bytes(confirmed)).toBe(vector.confirmed_transcript_hash_after);

    // RFC 9420 § 6.1: confirmation_tag = MAC(confirmation_key, confirmed_transcript_hash)
    let confirmationTag = suite.mac(hex(vector.confirmation_key), confirmed);
    expect(bytes(confirmationTag)).toBe(bytes(tagInContent));
    expect(suite.verifyMAC(hex(vector.confirmation_key), confirmed, tagInContent)).toBe(true);

    expect(bytes(TranscriptHash.interim(suite, confirmed, confirmationTag)))
      .toBe(vector.interim_transcript_hash_after);
  });
}

for (let vector of pskSecrets) {
  let suite = supportedSuite(vector.cipher_suite);
  if (!suite) {
    continue;
  }
  test(`psk secret for ${suite.name} from ${vector.psks.length} PSKs`, () => {
    let psks = vector.psks.map(psk => ({
      id: new ExternalPSKID(hex(psk.psk_id), hex(psk.psk_nonce)),
      secret: hex(psk.psk),
    }));
    expect(bytes(PreSharedKeys.secret(suite, psks))).toBe(vector.psk_secret);
  });
}

test("a new group starts from a random init secret", () => {
  let suite = CipherSuite.all[0];
  let groupContext = hex("00010001");
  expect(bytes(KeySchedule.forNewGroup(suite, groupContext).epochSecret))
    .not.toBe(bytes(KeySchedule.forNewGroup(suite, groupContext).epochSecret));
});

/** null for a cipher suite that we deliberately do not implement (X448) */
function supportedSuite(id: number): CipherSuite | null {
  return CipherSuite.all.find(suite => suite.id == id) ?? null;
}

function hex(text: string): Uint8Array {
  let out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(text.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytes(data: Uint8Array): string {
  return [...data].map(b => b.toString(16).padStart(2, "0")).join("");
}
