/** The JSON shapes the Wire backend sends and accepts.
 * Field names are the server's own, i.e. snake_case, so that they can be compared
 * against `Protocol/*.md` without a translation table. The only camelCase types
 * are the ones we synthesize, e.g. the federation buckets and the paging results.
 * See `Protocol/01-Overview.md` §4 for the ID model. */

/** Federation makes an ID meaningful only together with a backend domain.
 * <https://…/01-Overview.md> §4.2 */
export type TWireQualifiedID = {
  id: string,
  domain: string,
};

export type TWireQualifiedHandle = {
  handle: string,
  domain: string,
};

/** A federated list call answers with 3 buckets instead of failing.
 * `notFound` = gone, delete locally. `failed` = that backend was unreachable,
 * keep the local state and retry later. */
export type TWireFound<T> = {
  found: T[],
  notFound: TWireQualifiedID[],
  failed: TWireQualifiedID[],
};

export type TWireProtocol = "proteus" | "mls";

///////////////////////////////////////////////////////////
// Users

/** Another user's public profile. `Protocol/04` §2.2 */
export type TWireUser = {
  qualified_id: TWireQualifiedID,
  name: string,
  handle: string | null,
  email: string | null,
  text_status: string | null,
  accent_id: number,
  assets: TWireUserAsset[],
  type: "regular" | "app" | "bot",
  /** `"enabled"` means this user's messages are recorded. Must be shown in the UI. */
  legalhold_status: "enabled" | "pending" | "disabled" | "no_consent",
  supported_protocols: TWireProtocol[],
  service: TWireServiceRef | null,
  team: string | null,
  expires_at: string | null,
  deleted: boolean,
  searchable: boolean,
};

/** Our own profile: `TWireUser` plus the fields only we may see. `Protocol/04` §1.1 */
export type TWireSelf = TWireUser & {
  locale: string | null,
  status: "active" | "suspended" | "deleted" | "ephemeral" | null,
  managed_by: "wire" | "scim",
  email_unvalidated: string | null,
  sso_id: TWireSSOID | null,
};

/** SAML `{tenant, subject}` or SCIM `{scim_external_id}`. `Protocol/04` §1.4 */
export type TWireSSOID = {
  tenant?: string,
  subject?: string,
  scim_external_id?: string,
};

/** A bot / service, not a person */
export type TWireServiceRef = {
  id: string,
  provider: string,
};

/** Profile picture. `preview` = avatar, `complete` = full size. `Protocol/04` §8.1 */
export type TWireUserAsset = {
  key: string,
  domain: string | null,
  size: "preview" | "complete",
  type: "image",
};

/** `PUT /self`. Fields left out are not cleared. */
export type TWireSelfUpdate = {
  name?: string,
  accent_id?: number,
  assets?: TWireUserAsset[],
  text_status?: string,
  /** Send `[]` to clear the pre-2016 avatar, so old clients stop showing a stale one */
  picture?: [],
};

/** Another user's device. Only these 2 fields exist; `mls_public_keys` is
 * on our own clients only. `Protocol/04` §3.2 */
export type TWireClient = {
  id: string,
  class: "desktop" | "phone" | "tablet" | "legalhold" | null,
};

/** domain -> user ID -> that user's devices */
export type TWireUserClients = Record<string, Record<string, TWireClient[]>>;

/** `GET /search/contacts`. `found` is the total hit count, not a bucket. */
export type TWireSearchResult = {
  found: number,
  returned: number,
  took: number,
  search_policy: "no_search" | "exact_handle_search" | "full_search" | null,
  documents: TWireContact[],
};

/** A search hit. A strict subset of `TWireUser`, without `assets`. */
export type TWireContact = {
  qualified_id: TWireQualifiedID,
  name: string,
  handle: string | null,
  accent_id: number | null,
  team: string | null,
  type: "regular" | "app" | "bot",
};

///////////////////////////////////////////////////////////
// Connections

export type TWireConnectionStatus = "sent" | "pending" | "accepted" | "blocked" |
  "ignored" | "cancelled" | "missing-legalhold-consent";

/** A directed contact-request row. The backend keeps one per direction.
 * `Protocol/04` §4.2 */
export type TWireConnection = {
  /** Unqualified: always us, on our own backend */
  from: string,
  qualified_to: TWireQualifiedID,
  status: TWireConnectionStatus,
  last_update: string,
  /** The Proteus 1:1 conversation with that peer. The MLS 1:1 is a different one. */
  qualified_conversation: TWireQualifiedID | null,
};

///////////////////////////////////////////////////////////
// Teams

export type TWireTeam = {
  id: string,
  creator: string,
  name: string,
  icon: string | null,
  icon_key: string | null,
  splash_screen: string | null,
};

export type TWireTeamMember = {
  user: string,
  created_at: string | null,
  created_by: string | null,
  legalhold_status: "enabled" | "pending" | "disabled" | "no_consent" | null,
  /** Omitted entirely unless we hold `GetMemberPermissions` */
  permissions: TWireTeamPermissions | null,
};

/** `self` = what this member may do, `copy` = what they may grant others.
 * Bitmasks, see `Protocol/04` §5.4. */
export type TWireTeamPermissions = {
  self: number,
  copy: number,
};

/** Every feature has this envelope; only some have a `config`. `Protocol/04` §5.5 */
export type TWireFeature = {
  status: "enabled" | "disabled",
  lockStatus: "locked" | "unlocked" | null,
  ttl: string | number | null,
  /** Genuinely open-ended: the shape differs per feature, and unknown
   * features must be tolerated. Cast to the matching `TWire*Config`. */
  config: any,
};

/** Keyed by camelCase feature name, e.g. `mls`, `mlsMigration`, `fileSharing` */
export type TWireFeatureConfigs = Record<string, TWireFeature>;

/** `feature-configs.mls.config` */
export type TWireMLSConfig = {
  protocolToggleUsers: string[],
  defaultProtocol: TWireProtocol,
  allowedCipherSuites: number[],
  defaultCipherSuite: number,
  supportedProtocols: TWireProtocol[],
};

///////////////////////////////////////////////////////////
// Conversations

/** 0 = group/channel, 1 = self notes, 2 = accepted 1:1, 3 = pending connect.
 * `4` exists in the reference client, but never on the wire. */
export type TWireConversationType = 0 | 1 | 2 | 3;

/** `Protocol/05` §2.1. `last_event`/`last_event_time` are dead server
 * constants and are not modelled. */
export type TWireConversation = {
  qualified_id: TWireQualifiedID,
  type: TWireConversationType,
  creator: string | null,
  name: string | null,
  team: string | null,
  /** How one gets in: `private` | `invite` | `link` | `code` */
  access: string[],
  /** Who may get in: `team_member` | `non_team_member` | `guest` | `service` */
  access_role: string[],
  /** Self-deleting-message timer, in milliseconds */
  message_timer: number | null,
  /** 0 = read receipts off, 1 = on. The backend does not interpret it. */
  receipt_mode: number | null,
  members: TWireConversationMembers,
  protocol: "proteus" | "mls" | "mixed",
  /** MLS/mixed only. Opaque base64, store and echo it. */
  group_id: string | null,
  /** MLS/mixed only, 0 until the first commit */
  epoch: number | null,
  /** MLS only, and only once `epoch > 0` */
  epoch_timestamp: string | null,
  /** MLS only, and only once `epoch > 0` */
  cipher_suite: number | null,
  group_conv_type: "group_conversation" | "channel" | "meeting" | null,
  add_permission: "admins" | "everyone" | null,
  cells_state: "disabled" | "pending" | "ready" | null,
};

export type TWireConversationMembers = {
  /** Absent when we are not a member */
  self: TWireSelfMember | null,
  others: TWireOtherMember[],
};

/** Our own membership. `Protocol/05` §3.1 */
export type TWireSelfMember = {
  qualified_id: TWireQualifiedID,
  conversation_role: string,
  otr_archived: boolean,
  otr_archived_ref: string | null,
  /** 0 = all notifications, 1 = only mentions, 3 = muted. `Protocol/05` §3.3 */
  otr_muted_status: number | null,
  otr_muted_ref: string | null,
  hidden: boolean,
  hidden_ref: string | null,
  service: TWireServiceRef | null,
};

export type TWireOtherMember = {
  qualified_id: TWireQualifiedID,
  conversation_role: string,
  service: TWireServiceRef | null,
};

/** `POST /conversations` also reports the members it could not reach */
export type TWireCreatedConversation = TWireConversation & {
  failed_to_add: TWireQualifiedID[],
};

/** `POST /conversations` request. `Protocol/05` §4.1 */
export type TWireNewConversation = {
  name?: string,
  /** Excluding ourselves. Must be empty for MLS. */
  qualified_users?: TWireQualifiedID[],
  access?: string[],
  access_role?: string[],
  team?: TWireTeamInfo,
  message_timer?: number | null,
  receipt_mode?: number | null,
  /** Role given to everybody in `qualified_users`. Defaults to `wire_admin`. */
  conversation_role?: string,
  protocol?: "proteus" | "mls",
  group_conv_type?: "group_conversation" | "channel" | "meeting",
  add_permission?: "admins" | "everyone",
};

/** `managed` must be sent, and must always be `false` */
export type TWireTeamInfo = {
  teamid: string,
  managed: boolean,
};

/** `PUT /conversations/:d/:id/self`. At least one field must be set. */
export type TWireSelfMemberUpdate = {
  otr_muted_status?: number,
  otr_muted_ref?: string,
  otr_archived?: boolean,
  otr_archived_ref?: string,
  hidden?: boolean,
  hidden_ref?: string,
};

export type TWireConversationRole = {
  conversation_role: string,
  actions: string[],
};

/** A guest link. `Protocol/05` §6.10 */
export type TWireConversationCode = {
  key: string,
  code: string,
  uri: string | null,
  has_password: boolean,
};

/** What `GET /conversations/join` shows before joining */
export type TWireConversationPreview = {
  id: string,
  name: string | null,
  has_password: boolean,
};

///////////////////////////////////////////////////////////
// MLS

/** The backend's own signature keys, by signature scheme. Entry 0 of the
 * group's `external_senders` must be the removal key. `Protocol/07` §5 */
export type TWireMLSPublicKeys = {
  removal: Record<string, string>,
};

/** One claimed key package per device of the target user. `Protocol/07` §4.4.
 * Note the qualified user is flattened into `user` + `domain` here. */
export type TWireClaimedKeyPackage = {
  user: string,
  domain: string,
  client: string,
  /** base64 of the TLS-serialised KeyPackage */
  key_package: string,
  /** base64 of the 32-byte KeyPackageRef */
  key_package_ref: string,
};

/** The answer to `/mls/messages` and `/mls/commit-bundles`. `Protocol/07` §7.3 */
export type TWireMLSMessageSendingStatus = {
  /** The conversation events this commit caused */
  events: TWireEvent[],
  time: string,
  /** Federated deployments only: a remote backend was unreachable, retry the whole bundle */
  failed_to_send: TWireQualifiedID[],
  failed: TWireQualifiedID[],
};

/** `GET /one2one-conversations/:domain/:user`. The `public_keys` belong to the
 * backend that owns the 1:1, which need not be ours. `Protocol/07` §11.1 */
export type TWireMLSOneToOne = {
  conversation: TWireConversation,
  /** Absent on API v5 */
  public_keys: TWireMLSPublicKeys | null,
};

/** MLS conference subgroup. Wire uses exactly one ID: `"conference"`. */
export type TWireSubconversation = {
  parent_qualified_id: TWireQualifiedID,
  subconv_id: string,
  group_id: string,
  epoch: number,
  epoch_timestamp: string | null,
  cipher_suite: number | null,
  members: TWireSubconversationMember[],
};

export type TWireSubconversationMember = {
  user_id: string,
  domain: string,
  client_id: string,
};

///////////////////////////////////////////////////////////
// Proteus

/** A Proteus prekey. `key` is base64 of the CBOR `PreKeyBundle`.
 * `id` 65535 (0xFFFF) is the last-resort key, which is never consumed. */
export type TWirePrekey = {
  id: number,
  key: string,
};

/** One device's prekey, as claimed from a peer */
export type TWireClientPrekey = {
  client: string,
  prekey: TWirePrekey,
};

/** `GET /users/:domain/:id/prekeys` - one prekey per device of that user */
export type TWirePrekeyBundle = {
  user: string,
  clients: TWireClientPrekey[],
};

/** domain -> user -> client IDs. The request shape of `/users/list-prekeys`,
 * and every bucket of `TWireMessageSendingStatus`. Bare client IDs, unlike
 * `TWireUserClients`, which carries the device class. */
export type TWireQualifiedUserClients = Record<string, Record<string, string[]>>;

/** domain -> user -> client -> prekey. A `null` prekey means that device no
 * longer exists: drop it from the recipients instead of encrypting for it. */
export type TWireClientPrekeyMap = Record<string, Record<string, Record<string, TWirePrekey | null>>>;

export type TWireClaimedPrekeys = {
  qualified_user_client_prekeys: TWireClientPrekeyMap,
  /** Users whose backend was unreachable. Not "they do not exist". */
  failed_to_list: TWireQualifiedID[],
};

/** What a Proteus send answers, on both the 201 and the 412. `Protocol/09` §5.4 */
export type TWireMessageSendingStatus = {
  /** `false` means the backend refused the whole message (HTTP 412) because the
   * recipient list did not match: nothing was delivered. Fix the payload from
   * `deleted` and `missing`, and send again. */
  sent: boolean,
  time: string,
  /** Devices we should have encrypted for and did not. Claim their prekeys. */
  missing: TWireQualifiedUserClients,
  /** Devices we encrypted for although we should not have. Harmless, ignore. */
  redundant: TWireQualifiedUserClients,
  /** Devices that no longer exist. Remove them from the payload. */
  deleted: TWireQualifiedUserClients,
  /** Partial federation failure, and it comes with a *201*: the message reached
   * everybody else. Not a mismatch - do not rebuild the payload for it. */
  failed_to_send: TWireQualifiedUserClients,
  failed_to_confirm_clients: TWireQualifiedUserClients,
};

///////////////////////////////////////////////////////////
// Assets

/** `eternal` = profile pictures, `eternal-infrequent_access` / `expiring` =
 * message attachments, `persistent` is deprecated. `Protocol/10` §1.5 */
export type TWireAssetRetention = "eternal" | "eternal-infrequent_access" |
  "expiring" | "persistent" | "volatile";

export type TWireAssetUploadOptions = {
  /** `true` mints no token, i.e. any authenticated user may fetch it.
   * Message attachments rely on their AES key instead, and are public. */
  public: boolean,
  retention: TWireAssetRetention,
  domain?: string,
  /** Mandatory when the team has `assetAuditLog` enabled */
  audit?: TWireAssetAudit,
};

export type TWireAssetAudit = {
  convID: TWireQualifiedID,
  filename: string,
  filetype: string,
};

/** `POST /assets` answer. `Protocol/10` §2 */
export type TWireAsset = {
  key: string,
  domain: string,
  /** Only when uploaded with `public: false` */
  token: string | null,
  /** Only for `volatile` / `expiring` */
  expires: string | null,
};

///////////////////////////////////////////////////////////
// Notifications

/** One entry of the notification stream. `Protocol/06` §4.1 */
export type TWireNotification = {
  id: string,
  payload: TWireEvent[],
};

export type TWireNotifications = {
  notifications: TWireNotification[],
  has_more: boolean,
  /** Server time, for clock-drift correction */
  time: string | null,
  /** The stream no longer reaches back to our `since`. Everything in
   * `notifications` may have gaps: refetch conversations and users. */
  lost: boolean,
};

/** An event, as it arrives in a notification payload or over the WebSocket.
 * The fields beyond `type` depend on `type`, so this is the one shape that
 * `WireAPI` does not sanitize - whoever reads a field must sanitize it. */
export type TWireEvent = {
  type: string,
  [field: string]: any,
};
