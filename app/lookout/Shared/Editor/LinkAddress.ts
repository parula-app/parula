export enum LinkTarget {
  Web = "web",
  Email = "email",
}

export class LinkAddress {
  readonly target: LinkTarget;
  readonly address: string;
  readonly subject: string;

  constructor(target: LinkTarget, address: string, subject = "") {
    this.target = target;
    this.address = address;
    this.subject = subject;
  }

  static parse(href: string): LinkAddress {
    if (!/^mailto:/i.test(href)) {
      return new LinkAddress(LinkTarget.Web, href);
    }
    let rest = href.replace(/^mailto:/i, "");
    let queryPos = rest.indexOf("?");
    let address = decodeURIComponent(queryPos < 0 ? rest : rest.substring(0, queryPos));
    let query = new URLSearchParams(queryPos < 0 ? "" : rest.substring(queryPos + 1));
    return new LinkAddress(LinkTarget.Email, address, query.get("subject") ?? "");
  }

  static mailto(address: string, subject: string): string {
    address = address.trim();
    if (!address) {
      return "";
    }
    let url = "mailto:" + address;
    if (subject?.trim()) {
      url += "?subject=" + encodeURIComponent(subject.trim());
    }
    return url;
  }
}
