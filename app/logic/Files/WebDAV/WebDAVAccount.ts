import { FileSharingAccount } from "../FileSharingAccount";
import { WebDAVDirectory } from "./WebDAVDirectory";
import { AuthMethod } from "../../Abstract/Account";
import { appGlobal } from "../../app";
import { notifyChangedProperty } from "../../util/Observable";
import { RunOnce } from "../../util/flow/RunOnce";
import { NotReached, UserError, assert } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import { ArrayColl } from "svelte-collections";
import type { AuthType, OAuthToken, WebDAVClient } from "webdav";

export class WebDAVAccount extends FileSharingAccount {
  readonly protocol: string = "webdav";
  declare readonly rootDirs: ArrayColl<WebDAVDirectory>;
  @notifyChangedProperty
  client: WebDAVClient;
  protected readonly loginRunOnce = new RunOnce<void>();

  newDirectory(name: string, dir = new WebDAVDirectory()): WebDAVDirectory {
    return super.newDirectory(name, dir) as WebDAVDirectory;
  }

  async login(interactive: boolean) {
    if (this.isLoggedIn) {
      return;
    }
    await this.loginRunOnce.runOnce(async () => {
      if (this.isLoggedIn) {
        return;
      }
      let useOAuth2 = this.authMethod == AuthMethod.OAuth2;
      let usePassword = this.authMethod == AuthMethod.Password;
      let options: { authType?: AuthType, username?: string, password?: string, token?: OAuthToken };
      if (useOAuth2) {
        assert(this.oAuth2, gt`Need OAuth2 configuration`);
        if (!this.oAuth2.isLoggedIn) {
          await this.oAuth2.login(interactive);
        }
        options = {
          authType: "token" as AuthType,
          token: {
            access_token: this.oAuth2.accessToken,
            token_type: "Bearer",
          },
        };
      } else if (usePassword) {
        options = {
          username: this.username,
          password: this.password,
        };
      } else {
        throw new NotReached(gt`Unknown authentication method`);
      }
      if (!URL.canParse(this.url)) {
        throw new UserError(gt`Please enter the server URL, e.g. https://dav.example.com/`);
      }
      this.client = await appGlobal.remoteApp.createWebDAVClient(this.url, options);
    });
  }

  get isLoggedIn(): boolean {
    return !!this.client;
  }

  async sync() {
    await super.sync();
    if (!this.client) {
      await this.login(false);
    }
    if (this.rootDirs.isEmpty) {
      let root = this.newDirectory(gt`Files`);
      root.path = "/";
      this.rootDirs.add(root);
      await root.saveLocally();
    }
    await this.rootDirs.first.listContents();
  }

  /** For setup. Verify that the URL is a WebDAV endpoint and the credentials work. */
  async verifyLogin() {
    await this.login(true);
    let compliance = await this.client.getDAVCompliance("/");
    assert(compliance.compliance?.length > 0,
      gt`This URL does not appear to be a WebDAV endpoint. For Nextcloud, the URL has the form https://<host>/remote.php/dav/files/<username>/`);
    // PROPFIND: verifies that auth works on the collection itself.
    await this.client.getDirectoryContents("/");
  }
}
