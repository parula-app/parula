/** The whole group life cycle, with several clients in one process.
 *
 * The interop vectors only ever drive a *passive* member: they can pin what we
 * make of somebody else's Commit, but never what our own Commit looks like,
 * because its path secrets are freshly random. So this file runs real clients
 * against each other — every message goes through `toBytes()`/`fromBytes()`, as
 * it would over the wire — and checks after every epoch that everybody's
 * `epoch_authenticator` (RFC 9420 § 8.7) is the same, which it can only be if
 * their trees, transcript hashes and key schedules all agree.
 *
 * Cipher suite 1 throughout: what is exercised here is the state machine, and
 * the suites are covered by the vector tests. */
import { MLSClient } from "../../../../logic/Chat/MLS/MLSClient";
import { CommitResult, MLSGroup } from "../../../../logic/Chat/MLS/MLSGroup";
import type { MLSStorage } from "../../../../logic/Chat/MLS/MLSStorage";
import { AddProposal, RemoveProposal } from "../../../../logic/Chat/MLS/Messages/Proposal";
import { BasicCredential } from "../../../../logic/Chat/MLS/Messages/Credential";
import { MLSMessage } from "../../../../logic/Chat/MLS/Messages/MLSMessage";
import { WireFormat } from "../../../../logic/Chat/MLS/Messages/Framing";
import { CipherSuite } from "../../../../logic/Chat/MLS/Crypto/CipherSuite";
import { MLSError } from "../../../../logic/Chat/MLS/util";
import { randomBytes } from "../../../../logic/Chat/Signal/Crypto/primitives";
import { expect, test } from "vitest";

let suite = CipherSuite.forID(0x0001);

test("a group of three, from creation to everybody in the same epoch", () => {
  let alice = client("alice");
  let bob = client("bob");
  let charlie = client("charlie");

  let aliceGroup = MLSGroup.create(alice, randomBytes(suite.secretLength), suite);
  expect(aliceGroup.epoch).toBe(0n);
  expect(aliceGroup.members.length).toBe(1);
  expect(aliceGroup.ourLeafIndex).toBe(0);

  let bobGroup = add(aliceGroup, bob);
  expect(aliceGroup.epoch).toBe(1n);
  agree(aliceGroup, bobGroup);
  expect(bobGroup.ourLeafIndex).toBe(1);
  expect(bobGroup.members.length).toBe(2);

  // Bob commits this time, so that the second epoch is not all Alice's doing
  let charlieKeyPackage = charlie.createKeyPackage();
  let result = bobGroup.commit([new AddProposal(charlieKeyPackage.keyPackage)]);
  expect(aliceGroup.process(deliver(result.commit)).added.length).toBe(1);
  bobGroup.applyOwnCommit(result);
  let charlieGroup = MLSGroup.fromWelcome(charlie, deliver(result.welcome).welcome);
  agree(aliceGroup, bobGroup, charlieGroup);
  expect(charlieGroup.members.length).toBe(3);
  expect(charlieGroup.ourLeafIndex).toBe(2);
});

test("building a commit does not move the group until it is applied", () => {
  let alice = client("alice");
  let bob = client("bob");
  let aliceGroup = MLSGroup.create(alice, randomBytes(suite.secretLength), suite);

  let result = aliceGroup.commit([new AddProposal(bob.createKeyPackage().keyPackage)]);
  expect(aliceGroup.epoch).toBe(0n);
  expect(aliceGroup.members.length).toBe(1);
  expect(result.state.context.epoch).toBe(1n);

  // A second commit against the same epoch is what a rejected one would be
  // replaced by, and it must be buildable
  let second = aliceGroup.commit([]);
  expect(second.state.context.epoch).toBe(1n);
  aliceGroup.applyOwnCommit(second);
  expect(aliceGroup.epoch).toBe(1n);
  expect(() => aliceGroup.applyOwnCommit(result)).toThrow(/creates epoch 1/);
});

test("application messages in both directions, out of order, and across an epoch", () => {
  let alice = client("alice");
  let bob = client("bob");
  let aliceGroup = MLSGroup.create(alice, randomBytes(suite.secretLength), suite);
  let bobGroup = add(aliceGroup, bob);

  let hello = aliceGroup.encrypt(utf8("hello bob"));
  let reply = bobGroup.encrypt(utf8("hello alice"), utf8("metadata"));
  expect(text(bobGroup.process(deliver(hello)).plaintext)).toBe("hello bob");
  let received = aliceGroup.process(deliver(reply));
  expect(text(received.plaintext)).toBe("hello alice");
  expect(received.senderLeafIndex).toBe(1);

  // § 9.1: keys are single use, so the same message cannot be replayed
  expect(() => bobGroup.process(deliver(hello))).toThrow(MLSError);

  // § 15.3: the delivery service may hand them to us in any order
  let first = aliceGroup.encrypt(utf8("one"));
  let second = aliceGroup.encrypt(utf8("two"));
  let third = aliceGroup.encrypt(utf8("three"));
  expect(text(bobGroup.process(deliver(third)).plaintext)).toBe("three");
  expect(text(bobGroup.process(deliver(first)).plaintext)).toBe("one");
  expect(text(bobGroup.process(deliver(second)).plaintext)).toBe("two");

  // A message that a Commit overtook still belongs to the epoch it was sent in
  let late = aliceGroup.encrypt(utf8("sent before the commit"));
  let result = aliceGroup.commit([]);
  bobGroup.process(deliver(result.commit));
  aliceGroup.applyOwnCommit(result);
  agree(aliceGroup, bobGroup);
  expect(text(bobGroup.process(deliver(late)).plaintext)).toBe("sent before the commit");
});

test("a member updates its own leaf key and somebody else commits it", () => {
  let alice = client("alice");
  let bob = client("bob");
  let charlie = client("charlie");
  let aliceGroup = MLSGroup.create(alice, randomBytes(suite.secretLength), suite);
  let bobGroup = add(aliceGroup, bob);
  let charlieGroup = add(aliceGroup, charlie, bobGroup);
  let oldKey = bobGroup.tree.leaf(1).encryptionKey;

  let proposal = bobGroup.proposeUpdate();
  expect(aliceGroup.process(deliver(proposal)).kind).toBe("proposal");
  expect(charlieGroup.process(deliver(proposal)).kind).toBe("proposal");
  // Alice's own commit covers the proposal she cached, by reference
  let result = aliceGroup.commit();
  charlieGroup.process(deliver(result.commit));
  bobGroup.process(deliver(result.commit));
  aliceGroup.applyOwnCommit(result);

  agree(aliceGroup, bobGroup, charlieGroup);
  expect(bytes(bobGroup.tree.leaf(1).encryptionKey)).not.toBe(bytes(oldKey));
  // Bob only knows the private key of that leaf because he proposed it
  expect(text(aliceGroup.process(deliver(bobGroup.encrypt(utf8("still here")))).plaintext)).toBe("still here");
});

test("a removed member cannot follow the group any more", () => {
  let alice = client("alice");
  let bob = client("bob");
  let charlie = client("charlie");
  let aliceGroup = MLSGroup.create(alice, randomBytes(suite.secretLength), suite);
  let bobGroup = add(aliceGroup, bob);
  let charlieGroup = add(aliceGroup, charlie, bobGroup);

  let result = aliceGroup.commit([new RemoveProposal(1)]);
  let removal = bobGroup.process(deliver(result.commit));
  charlieGroup.process(deliver(result.commit));
  aliceGroup.applyOwnCommit(result);

  expect(removal.weWereRemoved).toBe(true);
  expect(removal.removed.length).toBe(1);
  expect(bobGroup.removed).toBe(true);
  expect(bob.group(aliceGroup.groupID)).toBe(null);
  agree(aliceGroup, charlieGroup);
  expect(aliceGroup.members.length).toBe(2);
  expect(aliceGroup.tree.leaf(1)).toBe(null);

  let secret = aliceGroup.encrypt(utf8("bob is gone"));
  expect(text(charlieGroup.process(deliver(secret)).plaintext)).toBe("bob is gone");
  expect(() => bobGroup.process(deliver(secret))).toThrow(/removed us/);
});

test("a commit of nothing but adds may leave out the update path", () => {
  let alice = client("alice");
  let bob = client("bob");
  let aliceGroup = MLSGroup.create(alice, randomBytes(suite.secretLength), suite);

  let result = aliceGroup.commit([new AddProposal(bob.createKeyPackage().keyPackage)], { path: false });
  expect(deliver(result.commit).publicMessage.content.commit.path).toBe(null);
  aliceGroup.applyOwnCommit(result);
  let bobGroup = MLSGroup.fromWelcome(bob, deliver(result.welcome).welcome);

  agree(aliceGroup, bobGroup);
  // The next commit does re-key, and Bob has to be able to follow that one
  let second = aliceGroup.commit();
  bobGroup.process(deliver(second.commit));
  aliceGroup.applyOwnCommit(second);
  agree(aliceGroup, bobGroup);
});

test("a new client joins by external commit", () => {
  let alice = client("alice");
  let bob = client("bob");
  let dave = client("dave");
  let aliceGroup = MLSGroup.create(alice, randomBytes(suite.secretLength), suite);
  let bobGroup = add(aliceGroup, bob);

  let groupInfo = aliceGroup.groupInfo();
  let joined = MLSGroup.externalCommit(dave, deliver(new MLSMessage(groupInfo)).groupInfo);
  aliceGroup.process(deliver(joined.commit));
  bobGroup.process(deliver(joined.commit));

  agree(aliceGroup, bobGroup, joined.group);
  expect(joined.group.ourLeafIndex).toBe(2);
  expect(aliceGroup.members.length).toBe(3);
  expect(text(bobGroup.process(deliver(joined.group.encrypt(utf8("dave here")))).plaintext)).toBe("dave here");
});

test("handshake messages can be encrypted instead", () => {
  let alice = client("alice");
  let bob = client("bob");
  alice.handshakeWireFormat = WireFormat.PrivateMessage;
  bob.handshakeWireFormat = WireFormat.PrivateMessage;
  bob.paddingBlockSize = 128;
  let aliceGroup = MLSGroup.create(alice, randomBytes(suite.secretLength), suite);
  let bobGroup = add(aliceGroup, bob);

  let result = bobGroup.commit();
  let message = deliver(result.commit);
  expect(message.privateMessage).not.toBe(null);
  aliceGroup.process(message);
  bobGroup.applyOwnCommit(result);
  agree(aliceGroup, bobGroup);
});

test("a group survives being saved and loaded again", () => {
  let alice = client("alice");
  let bob = client("bob");
  let saved = new RecordingStorage();
  alice.storage = saved;
  let aliceGroup = MLSGroup.create(alice, randomBytes(suite.secretLength), suite);
  let bobGroup = add(aliceGroup, bob);
  let sent = aliceGroup.encrypt(utf8("before the restart"));
  expect(saved.groups.size).toBe(1);

  let restored = MLSClient.fromJSON(JSON.parse(JSON.stringify(alice.toJSON())));
  let restoredGroup = MLSGroup.fromJSON(restored, JSON.parse(JSON.stringify(aliceGroup.toJSON())));

  expect(bytes(restoredGroup.epochAuthenticator)).toBe(bytes(aliceGroup.epochAuthenticator));
  expect(restoredGroup.ourLeafIndex).toBe(0);
  expect(restored.group(aliceGroup.groupID)).toBe(restoredGroup);
  expect(text(bobGroup.process(deliver(sent)).plaintext)).toBe("before the restart");
  // The ratchet is where it was, so this does not reuse the key of `sent`
  expect(text(bobGroup.process(deliver(restoredGroup.encrypt(utf8("after")))).plaintext)).toBe("after");
  let result = restoredGroup.commit();
  bobGroup.process(deliver(result.commit));
  restoredGroup.applyOwnCommit(result);
  agree(restoredGroup, bobGroup);
});

test("a message from another group or epoch is refused", () => {
  let alice = client("alice");
  let bob = client("bob");
  let aliceGroup = MLSGroup.create(alice, randomBytes(suite.secretLength), suite);
  let bobGroup = add(aliceGroup, bob);
  let other = MLSGroup.create(client("mallory"), randomBytes(suite.secretLength), suite);

  expect(() => bobGroup.process(deliver(other.encrypt(utf8("wrong group"))))).toThrow(/another group/);
  let result = aliceGroup.commit();
  expect(() => aliceGroup.process(deliver(result.commit))).toThrow(/own Commit/);
  bobGroup.process(deliver(result.commit));
  aliceGroup.applyOwnCommit(result);
  // Bob is an epoch ahead of this stale commit now
  expect(() => bobGroup.process(deliver(result.commit))).toThrow(/epoch/);
});

function client(name: string): MLSClient {
  return MLSClient.create(suite, BasicCredential.fromString(`${name}@example.com`));
}

/** Add one member, through the whole Commit/Welcome round trip, and hand back
 * the new member's group. `others` are the members that also have to follow. */
function add(group: MLSGroup, joiner: MLSClient, ...others: MLSGroup[]): MLSGroup {
  let keyPackage = joiner.createKeyPackage();
  let result = group.commit([new AddProposal(keyPackage.keyPackage)]);
  for (let other of others) {
    other.process(deliver(result.commit));
  }
  group.applyOwnCommit(result);
  return MLSGroup.fromWelcome(joiner, deliver(result.welcome).welcome);
}

/** Everything goes over the wire as bytes, so that a message that only happens
 * to be right as an object does not pass. */
function deliver(message: MLSMessage): MLSMessage {
  return MLSMessage.fromBytes(message.toBytes());
}

/** RFC 9420 § 8.7: the one value that tells members whether they agree. */
function agree(...groups: MLSGroup[]): void {
  for (let group of groups) {
    expect(group.epoch).toBe(groups[0].epoch);
    expect(bytes(group.epochAuthenticator)).toBe(bytes(groups[0].epochAuthenticator));
    expect(bytes(group.groupContext.toBytes())).toBe(bytes(groups[0].groupContext.toBytes()));
    expect(group.members.length).toBe(groups[0].members.length);
  }
}

/** What the application would implement to persist MLS state. */
class RecordingStorage implements MLSStorage {
  readonly groups = new Map<string, any>();
  clients = 0;

  saveClient(client: MLSClient): void {
    this.clients++;
  }

  saveGroup(group: MLSGroup): void {
    this.groups.set(bytes(group.groupID), group.toJSON());
  }

  deleteGroup(group: MLSGroup): void {
    this.groups.delete(bytes(group.groupID));
  }
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function text(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

function bytes(data: Uint8Array): string {
  return [...data].map(b => b.toString(16).padStart(2, "0")).join("");
}
