/** The official MLS interop test vectors for the wire format, from
 * <https://github.com/mlswg/mls-implementations> `test-vectors/messages.json`.
 *
 * Every field is one hex-encoded, serialized RFC 9420 struct. Parsing it and
 * serializing it again must give back the exact same bytes, which pins the
 * field order, the variable-length headers, the `select` arms and the
 * `optional<T>` presence octets of both directions at once.
 *
 * The vectors are trimmed to the cipher suites we implement, and to a handful
 * of entries per suite; every struct is exercised by each entry. */
import { CipherSuite } from "../../../../logic/Chat/MLS/Crypto/CipherSuite";
import { Commit } from "../../../../logic/Chat/MLS/Messages/Commit";
import { GroupSecrets } from "../../../../logic/Chat/MLS/Messages/Welcome";
import { MLSMessage } from "../../../../logic/Chat/MLS/Messages/MLSMessage";
import { Proposal, ProposalType } from "../../../../logic/Chat/MLS/Messages/Proposal";
import { AuthenticatedContent, ContentType, WireFormat } from "../../../../logic/Chat/MLS/Messages/Framing";
import messages from "./vectors/messages.json";
import transcriptHashes from "./vectors/transcript-hashes.json";
import { expect, test } from "vitest";

for (let [index, vector] of messages.entries()) {
  let suiteID = parseInt(vector.mls_key_package.substring(12, 16), 16);
  test(`messages ${index}, cipher suite ${suiteID}`, () => {
    // The `mls_*` fields are whole MLSMessages, i.e. they include the 4-byte header
    expectMessage(vector.mls_key_package, WireFormat.KeyPackage);
    expectMessage(vector.mls_group_info, WireFormat.GroupInfo);
    expectMessage(vector.mls_welcome, WireFormat.Welcome);
    expectMessage(vector.public_message_application, WireFormat.PublicMessage);
    expectMessage(vector.public_message_proposal, WireFormat.PublicMessage);
    expectMessage(vector.public_message_commit, WireFormat.PublicMessage);
    expectMessage(vector.private_message, WireFormat.PrivateMessage);

    expectRoundTrip(vector.group_secrets, data => GroupSecrets.fromBytes(data).toBytes());
    expectRoundTrip(vector.commit, data => Commit.fromBytes(data).toBytes());

    // These fields hold the bare `select` arm, without the `proposal_type` that
    // a `Proposal` prefixes it with, so we frame them to parse and unframe to compare
    expectProposalBody(vector.add_proposal, ProposalType.Add);
    expectProposalBody(vector.update_proposal, ProposalType.Update);
    expectProposalBody(vector.remove_proposal, ProposalType.Remove);
    expectProposalBody(vector.pre_shared_key_proposal, ProposalType.PreSharedKey);
    expectProposalBody(vector.re_init_proposal, ProposalType.ReInit);
    expectProposalBody(vector.external_init_proposal, ProposalType.ExternalInit);
    expectProposalBody(vector.group_context_extensions_proposal, ProposalType.GroupContextExtensions);
  });
}

/** `AuthenticatedContent` never appears on the wire, so `messages.json` has no
 * field for it; `transcript-hashes.json` is where the official vectors carry
 * one. The hashes it computes belong to the key schedule, not here. */
for (let vector of transcriptHashes) {
  let suite = CipherSuite.all.find(suite => suite.id == vector.cipher_suite);
  if (!suite) {
    continue;
  }
  test(`AuthenticatedContent for ${suite.name}`, () => {
    let content = AuthenticatedContent.fromBytes(hex(vector.authenticated_content));
    expect(content.content.contentType).toBe(ContentType.Commit);
    expect(bytes(content.toBytes())).toBe(vector.authenticated_content);
    // The confirmed transcript hash input is the same, minus the confirmation tag
    expect(vector.authenticated_content.startsWith(bytes(content.confirmedTranscriptHashInput()))).toBe(true);
  });
}

function expectMessage(encoded: string, wireFormat: WireFormat): void {
  let message = MLSMessage.fromBytes(hex(encoded));
  expect(message.wireFormat).toBe(wireFormat);
  expect(bytes(message.toBytes())).toBe(encoded);
}

function expectProposalBody(encoded: string, type: ProposalType): void {
  let framed = hex(type.toString(16).padStart(4, "0") + encoded);
  let proposal = Proposal.fromBytes(framed);
  expect(proposal.type).toBe(type);
  expect(bytes(proposal.toBytes())).toBe(bytes(framed));
}

function expectRoundTrip(encoded: string, roundTrip: (data: Uint8Array) => Uint8Array): void {
  expect(bytes(roundTrip(hex(encoded)))).toBe(encoded);
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
