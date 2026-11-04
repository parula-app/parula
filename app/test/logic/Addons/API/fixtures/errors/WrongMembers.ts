import { addon } from "../../../../../../logic/Addons/API/addon";
import type { HTMLString } from "../../../../../../logic/util/util";

class NotExported {
  @addon("mail")
  name: string;
}

@addon("mail", "mail.compose")
export class ClassWithWriteGroup {
}

export class Members {
  @addon("mail", "mail.compose")
  readonly fixed: string = "";
  @addon("mail", "mail.compose")
  get computed(): string {
    return "";
  }
  @addon("mail", "mail.compose")
  run(): void {
  }
  @addon("mail")
  static count: number;
  @addon("mail")
  private secret: string;
  @addon("mail")
  protected internal: string;
  @addon("mail")
  @addon("mail.all")
  twice: string;
  @addon("mail", "mail.compose")
  maybeHTML: HTMLString | null;
}
