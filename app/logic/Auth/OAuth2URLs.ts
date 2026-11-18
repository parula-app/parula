/**
 * Contains the hardcoded URLs for a handful of important providers,
 * including the client ID and secret.
 *
 * This is for legacy reasons. Going forward, we should use mAuth and
 * the client ID should be hardcoded ("messaging").
 *
 * This is essentially a JSON file, but allowing comments and trailing commas :).
 * It contains only data, no code.
 */

export const OAuth2URLs = [
  {
    provider: Provider.Office365,
    domains: ["outlook.com", "outlook.office365.com", "outlook.cloud.microsoft"],
    hostnames: ["outlook.office365.com", "outlook.cloud.microsoft", "outlook.office.com"],
    authURL: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    authDoneURL: "https://login.microsoftonline.com/common/oauth2/nativeclient",
    tokenURL: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    // tokenURLPasswordAuth: "https://login.microsoftonline.com/organizations/oauth2/v2.0/token", works only for some business accounts
    logoutURL: "https://login.microsoftonline.com/common/oauth2/logout",
    scope: "offline_access EWS.AccessAsUser.All EAS.AccessAsUser.All https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/POP.AccessAsUser.All https://outlook.office.com/SMTP.Send",
    clientID: "1d01f7d4-334b-475a-9176-a0d504c6a38a",
    clientSecret: null,
    doPKCE: false,
  },
  {
    provider: Provider.Office365,
    domains: ["graph.microsoft.com"],
    hostnames: ["graph.microsoft.com"],
    authURL: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    authDoneURL: "https://login.microsoftonline.com/common/oauth2/nativeclient",
    tokenURL: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    logoutURL: "https://login.microsoftonline.com/common/oauth2/logout",
    scope: "Mail.ReadWrite Mail.ReadWrite.Shared Mail.Send Mail.Send.Shared MailboxSettings.ReadWrite Calendars.ReadWrite Calendars.ReadWrite.Shared Contacts.ReadWrite Contacts.ReadWrite.Shared Chat.ReadWrite OnlineMeetings.ReadWrite Files.ReadWrite.All User.Read openid profile offline_access",
    clientID: "1d01f7d4-334b-475a-9176-a0d504c6a38a",
    clientSecret: null,
    doPKCE: false,
  },
  {
    provider: Provider.Google,
    domains: ["google.com", "gmail.com", "googlemail.com" ],
    hostnames: ["imap.gmail.com", "smtp.gmail.com", "pop.gmail.com"],
    authURL: "https://accounts.google.com/o/oauth2/auth",
    tokenURL: "https://accounts.google.com/o/oauth2/token",
    logoutURL: "https://www.google.com/accounts/Logout?continue=https://appengine.google.com/_ah/logout?continue=http://localhost",
    scope: "https://mail.google.com/ https://www.googleapis.com/auth/carddav https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive",
    clientID: "655112261748-hfrf4boautgaqm4lt0u4thqplgftst3r.apps.googleusercontent.com",
    clientSecret: "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",
    doPKCE: true,
  },
  {
    provider: null,
    domains: ["yahoo.com"],
    hostnames: ["imap.mail.yahoo.com", "pop.mail.yahoo.com", "smtp.mail.yahoo.com" ],
    authURL: "https://api.login.yahoo.com/oauth2/request_auth",
    tokenURL: "https://api.login.yahoo.com/oauth2/get_token",
    authDoneURL: "https://www.mustang.im/loggedin",
    logoutURL: "https://login.yahoo.com/account/logout?logout_all=1&src=app&.done=https%3A%2F%2Fwww.yahoo.com%2F",
    scope: "mail-w",
    clientID: "dj0yJmk9d25qSWNOMzJVeDhlJmQ9WVdrOVV6VTJiMjQzTTFZbWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PTE3",
    clientSecret: null,
    doPKCE: true,
  },
  {
    provider: null,
    domains: ["aol.com"],
    hostnames: ["imap.aol.com", "pop.aol.com", "smtp.aol.com"],
    authURL: "https://api.login.aol.com/oauth2/request_auth",
    tokenURL: "https://api.login.aol.com/oauth2/get_token",
    authDoneURL: "https://www.mustang.im/loggedin",
    logoutURL: "https://login.aol.com/account/logout?logout_all=1&src=app&.done=https%3A%2F%2Fwww.aol.com%2F",
    scope: "mail-w",
    clientID: "dj0yJmk9Mm03clNTM3kyZ05WJmQ9WVdrOVNFeE9VelJ4UTFjbWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PTBh",
    clientSecret: null,
    doPKCE: true,
  },
  {
    provider: null,
    domains: ["mustang.im"],
    hostnames: ["controller.mustang.im"],
    // Configured in KeyCloak <https://accounts.mustang.im/auth/admin/master/console/#/mustang/clients/>
    authURL: "https://accounts.mustang.im/auth/realms/mustang/protocol/openid-connect/auth",
    authDoneURL: "https://mustang.im/loggedin",
    tokenURL: "https://accounts.mustang.im/auth/realms/mustang/protocol/openid-connect/token",
    tokenURLPasswordAuth: "https://accounts.mustang.im/auth/realms/mustang/protocol/openid-connect/token",
    logoutURL: "https://accounts.mustang.im/auth/realms/mustang/protocol/openid-connect/logout",
    scope: "openid phone profile email",
    clientID: "mustang",
    clientSecret: null,
    doPKCE: false,
  },
  {
    provider: null,
    domains: ["fastmail.com", "fastmail.fm"],
    hostnames: ["api.fastmail.com", "fastmail.com", "imap.fastmail.com"],
    authURL: "https://api.fastmail.com/oauth/authorize",
    authDoneURL: null,
    tokenURL: "https://api.fastmail.com/oauth/refresh",
    scope: "https://www.fastmail.com/dev/protocol-imap https://www.fastmail.com/dev/protocol-pop https://www.fastmail.com/dev/protocol-smtp https://www.fastmail.com/dev/protocol-carddav https://www.fastmail.com/dev/protocol-caldav https://www.fastmail.com/dev/protocol-webdav urn:ietf:params:jmap:core urn:ietf:params:jmap:mail urn:ietf:params:jmap:submission urn:ietf:params:jmap:vacationresponse",
    clientID: "352641ae", // Parula
    clientSecret: null,
    doPKCE: true,
  },
];

/**
 * The company that runs the server for an account.
 * Only for the few providers that are so widespread that
 * apps and services are made specifically for them.
 */
export enum Provider {
  Office365 = "office365",
  Google = "google",
}
