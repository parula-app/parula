import { addon, addonHook } from "../../../../../../logic/Addons/API/addon";

@addon("mail")
export class Mail {
}

export class Hooks {
  @addonHook("test.sync", "mail")
  sync(mail: Mail): void {
  }
  @addonHook("test.callback", "mail")
  async callback(mail: Mail, done: () => void): Promise<void> {
  }
  @addonHook("test.twice", "mail")
  async first(mail: Mail): Promise<void> {
  }
  @addonHook("test.twice", "mail")
  async second(mail: Mail): Promise<void> {
  }
  @addonHook("test.group", "everything")
  async group(mail: Mail): Promise<void> {
  }
  @addonHook("test.computed", "mail", (hooks: Hooks) => ({ mail: hooks.mailOf(1) }))
  async computed(): Promise<void> {
  }
  @addonHook("test.objectResult", "mail")
  async objectResult(mail: Mail): Promise<Mail> {
    return mail;
  }
  mailOf(i: number): Mail {
    return new Mail();
  }
}

class Hidden {
  @addonHook("test.hidden", "mail")
  async send(mail: Mail): Promise<void> {
  }
}
