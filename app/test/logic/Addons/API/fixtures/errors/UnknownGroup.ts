import { addon } from "../../../../../../logic/Addons/API/addon";

@addon("mail.everything")
export class UnknownClassGroup {
}

export class UnknownMemberGroup {
  @addon("mail", "mail.write")
  name: string;
  @addon(["mail", "secrets"])
  other: string;
}

/** @addon("enums") */
export enum UnknownEnumGroup {
  A = "a",
}
