import { AddonAPIGenerator } from '../../../../logic/Addons/API/generate';
import type { APIClass, APIEnum, APIHook, APIMember } from '../../../../logic/Addons/API/addon';
import { Actions, Item, Mail, Person } from './fixtures/valid/Valid';
import ts from 'typescript';
import { readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { expect, test, describe, beforeAll } from 'vitest';

const testDir = dirname(fileURLToPath(import.meta.url));
const validDir = join(testDir, "fixtures/valid");
const errorsDir = join(testDir, "fixtures/errors");
const apiDir = join(testDir, "../../../../logic/Addons/API");

/** Type-checks `files` (path -> content) on top of the real files.
 * @returns the errors in `files` */
function compile(files: Record<string, string>): string[] {
  let options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    experimentalDecorators: true,
    strict: true,
    noEmit: true,
    types: [],
  };
  let host = ts.createCompilerHost(options);
  let { fileExists, readFile, getSourceFile } = host;
  host.fileExists = file => file in files || fileExists.call(host, file);
  host.readFile = file => files[file] ?? readFile.call(host, file);
  host.getSourceFile = (file, language, ...rest) => file in files
    ? ts.createSourceFile(file, files[file], language)
    : getSourceFile.call(host, file, language, ...rest);
  let program = ts.createProgram(Object.keys(files), options, host);
  return Object.keys(files)
    .flatMap(file => ts.getPreEmitDiagnostics(program, program.getSourceFile(file)))
    .map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
}

function generateErrors(fixture: string): string {
  try {
    new AddonAPIGenerator([join(errorsDir, fixture)], errorsDir).generate();
  } catch (ex) {
    return ex.message;
  }
  throw new Error("The generator accepted " + fixture);
}

describe("Generator on fixtures", () => {
  let generated: { apiTypes: string, addonAPI: string };
  let apiClasses: APIClass[];
  let apiEnums: APIEnum[];
  let apiHooks: APIHook[];

  beforeAll(async () => {
    generated = new AddonAPIGenerator([validDir], validDir, join(validDir, "MustangAPI.ts")).generate();
    // The generated imports are relative to `validDir`
    let file = join(validDir, "apiTypes.generated.ts");
    writeFileSync(file, generated.apiTypes);
    try {
      ({ apiClasses, apiEnums, apiHooks } = await import("./fixtures/valid/apiTypes.generated"));
    } finally {
      rmSync(file);
    }
  }, 60000);

  function apiClass(name: string): APIClass {
    let found = apiClasses.find(c => c.name == name);
    expect(found, name).toBeDefined();
    return found;
  }

  function member(className: string, memberName: string): APIMember {
    return apiClass(className).members.find(m => m.name == memberName);
  }

  test("Classes with their groups and superclass", () => {
    expect(apiClasses.map(c => c.name).sort()).toEqual(["Item", "Mail", "Person"]);
    expect(apiClass("Mail").class).toBe(Mail);
    expect(apiClass("Mail").groups).toEqual(["mail"]);
    expect(apiClass("Mail").extends).toBe("Item");
    expect(apiClass("Person").class).toBe(Person);
    expect(apiClass("Person").groups).toEqual(["message"]);
    expect(apiClass("Item").class).toBe(Item);
    expect(apiClass("Item").groups ?? []).toEqual([]);
    expect(apiClass("Item").extends).toBeUndefined();
  });

  test("Unannotated members, classes and enums are absent", () => {
    expect(member("Item", "secret")).toBeUndefined();
    expect(member("Item", "hidden")).toBeUndefined();
    expect(member("Mail", "notAnnotated")).toBeUndefined();
    expect(member("Mail", "_body")).toBeUndefined();
    expect(apiClasses.some(c => c.name == "Unexposed" || c.name == "Actions")).toBe(false);
    expect(apiEnums.some(e => e.name == "NotForAddons")).toBe(false);
    expect(generated.addonAPI).not.toMatch(/secret|hidden|notAnnotated|Unexposed|NotForAddons/);
  });

  test("Read and write groups", () => {
    expect(member("Item", "title")).toMatchObject({ kind: "field", read: ["message"], write: ["mail.compose"] });
    expect(new Set(member("Item", "owner").read)).toEqual(new Set(["mail.all", "chat.all"]));
    expect(member("Item", "owner")).not.toHaveProperty("write");
    expect(member("Mail", "to")).toMatchObject({ kind: "field", read: ["mail"] });
    expect(member("Mail", "to")).not.toHaveProperty("write");
  });

  test("Getters", () => {
    expect(member("Mail", "size")).toMatchObject({ kind: "getter", read: ["mail"], type: ["number"] });
    expect(member("Mail", "size")).not.toHaveProperty("write");
    expect(member("Mail", "body")).toMatchObject({ kind: "getter", read: ["message"], write: ["mail.compose"], type: ["string"] });
  });

  test("Methods with parameters and return types", () => {
    let save = member("Mail", "save");
    expect(save).toMatchObject({ kind: "method", read: ["mail"], returns: ["boolean"] });
    expect(save.kind == "method" && save.params).toEqual([
      { name: "force", type: ["boolean"] },
      { name: "count", type: ["number"], optional: true },
    ]);
    let find = member("Mail", "find");
    expect(find.kind == "method" && new Set(find.returns)).toEqual(new Set([Person, "null"]));
  });

  test("HTMLString is HTML, which the bridge sanitizes", () => {
    expect(member("Mail", "signature")).toMatchObject({ kind: "field", type: ["HTML"] });
    expect(member("Mail", "preview")).toMatchObject({ kind: "getter", type: ["HTML"] });
    let insert = member("Mail", "insert");
    expect(insert.kind == "method" && insert.params).toEqual([
      { name: "html", type: ["HTML"] },
      { name: "at", type: ["number"], optional: true },
    ]);
  });

  test("Field types", () => {
    let types = (name: string) => {
      let found = member("Mail", name);
      return new Set(found.kind != "method" && found.type);
    };
    expect(types("from")).toEqual(new Set([Person]));
    expect(types("sent")).toEqual(new Set(["Date"]));
    expect(types("data")).toEqual(new Set(["Uint8Array", "null"]));
    expect(types("color")).toEqual(new Set([{ enum: "Color" }]));
    expect(types("level")).toEqual(new Set([{ enum: "Level" }, "undefined"]));
  });

  test("Collections, without unannotated items", () => {
    let types = (name: string) => {
      let found = member("Mail", name);
      return found.kind != "method" && found.type;
    };
    expect(types("to")).toEqual([{ collection: [Person] }]);
    expect(types("people")).toEqual([{ collection: [Person] }]);
    expect(new Set(types("tags"))).toEqual(new Set([{ collection: [Person] }, "null"]));
    expect(types("thread")).toEqual([{ collection: [Mail] }]);
  });

  test("Enums with their values", () => {
    expect(apiEnums.find(e => e.name == "Color")).toEqual({ name: "Color", groups: ["mail.all"], values: ["red", "blue"] });
    expect(apiEnums.find(e => e.name == "Level")).toEqual({ name: "Level", groups: ["mail"], values: [1, 5] });
  });

  test("Hook points", () => {
    expect(apiHooks.map(hook => hook.point).sort()).toEqual(["test.save", "test.send"]);
    let send = apiHooks.find(hook => hook.point == "test.send");
    expect(send).toMatchObject({ group: "mail.compose", result: ["void"] });
    // The class itself, not its name: production builds minify class names
    expect(send.class).toBe(Actions);
    expect(send.method).toBe("send");
    expect(send.args).toEqual([{ name: "mail", type: [Mail], member: "mail" }]);
    let save = apiHooks.find(hook => hook.point == "test.save");
    expect(save).toMatchObject({ class: Actions, method: "save", group: "mail", result: ["boolean"] });
    expect(save.args.map(arg => [arg.name, arg.type, arg.member])).toEqual([["mail", [Mail], undefined], ["count", ["number"], undefined]]);
    expect(typeof Actions.prototype.send).toBe("function");
  });

  test("Typings for addon authors", () => {
    let dts = join(validDir, "addon-api.d.ts");
    let usage = join(validDir, "usage.ts");
    let errors = compile({
      [dts]: generated.addonAPI,
      [usage]: `
        import type { Color, Level, Mail, Person } from "./addon-api";
        async function use(mail: Mail) {
          let title: string = mail.title;
          mail.title = "changed";
          mail.body = "<p>changed</p>";
          mail.signature = "<p>Fred</p>";
          let signature: string = mail.signature;
          await mail.insert("<b>x</b>");
          let body: string = await mail.body;
          let size: number = await mail.size;
          let saved: boolean = await mail.save(true);
          await mail.save(false, 3);
          let found: Person | null = await mail.find("Fred");
          let first: Person = mail.to.first;
          let color: Color = "blue";
          let level: Level | undefined = mail.level;
          let sent: Date = mail.sent;
          mail.release();
          mustang.mail.thread.first.release();
          mustang.marked.first.from.release();
          mustang.before("test.send", ({ mail }) => mail.release());
          mustang.before("test.save", ({ mail, count }) => count + 1);
          // @ts-expect-error
          mail.owner = "Fred";
          // @ts-expect-error
          mail.to = mail.to;
          // @ts-expect-error
          let syncSize: number = mail.size;
          // @ts-expect-error
          let syncSaved: boolean = mail.save(true);
          // @ts-expect-error
          let wrongColor: Color = "green";
          // @ts-expect-error
          mail.secret;
          // @ts-expect-error
          mustang.before("test.unknown", () => {});
        }
      `,
    });
    expect(errors).toEqual([]);
  });
});

describe("Generator errors", () => {
  test("Unknown groups", () => {
    let message = generateErrors("UnknownGroup.ts");
    for (let label of ["UnknownClassGroup", "UnknownMemberGroup.name", "UnknownMemberGroup.other", "UnknownEnumGroup"]) {
      expect(message).toContain(label + ":");
    }
    for (let group of ["mail.everything", "mail.write", "secrets", "enums"]) {
      expect(message).toContain(group);
    }
  });

  test("Disallowed types", () => {
    let message = generateErrors("DisallowedTypes.ts");
    for (let name of ["list", "anything", "callback", "map", "unannotatedClass", "unannotatedEnum", "partialEnum", "literal", "unannotatedItems", "take", "rest", "give", "plain"]) {
      expect(message).toContain("Disallowed." + name);
    }
  });

  test("Wrong members", () => {
    let message = generateErrors("WrongMembers.ts");
    for (let label of ["NotExported", "ClassWithWriteGroup", "Members.fixed", "Members.computed", "Members.run", "Members.count", "Members.secret", "Members.internal", "Members.twice", "Members.maybeHTML"]) {
      expect(message).toContain(label + ":");
    }
  });

  test("Wrong hooks", () => {
    let message = generateErrors("WrongHooks.ts");
    for (let label of ["Hooks.sync", "Hooks.callback", "Hooks.second", "Hooks.group", "Hooks.computed", "Hooks.objectResult", "Hidden.send"]) {
      expect(message).toContain(label);
    }
    expect(message).not.toContain("Hooks.first");
  });
});

/** Shows the classes that it read */
class InspectableGenerator extends AddonAPIGenerator {
  get classInfos(): any[] {
    return this.classes;
  }
}

describe("App API", () => {
  let generator: InspectableGenerator;
  let generated: { apiTypes: string, addonAPI: string };

  beforeAll(() => {
    generator = new InspectableGenerator();
    generated = generator.generate();
  }, 120000);

  test("Message HTML that addons write is sanitized", () => {
    let html = generator.classInfos.find(c => c.name == "Message").members.find(m => m.name == "html");
    expect(html.write).toContain("mail.compose");
    expect(html.type).toEqual(["HTML"]);
  });

  test("Committed files are up to date. Run `npm run addons:generate`", () => {
    expect(generated.apiTypes).toBe(readFileSync(join(apiDir, "apiTypes.ts"), "utf-8"));
    expect(generated.addonAPI).toBe(readFileSync(join(apiDir, "addon-api.d.ts"), "utf-8"));
  });

  test("Typings compile for an addon", () => {
    let dts = join(apiDir, "addon-api.d.ts");
    let usage = join(apiDir, "usage.ts");
    let errors = compile({
      [dts]: generated.addonAPI,
      [usage]: `
        import type { EMail, Folder, SpecialFolder } from "./addon-api";
        mustang.ui.onCommand("count", async ({ messages }) => {
          for (let message of messages ?? []) {
            let text: string = await message.text;
            let subject: string = message.subject;
            let sender: string = message.from.emailAddress;
            await message.loadBody();
          }
        });
        let folder: Folder = mustang.mail.accounts.first.rootFolders.first;
        let special: SpecialFolder = folder.specialFolder;
        let email: EMail = folder.messages.first;
        email.subject = "Re: " + email.subject;
        let name: string = mustang.chat.accounts.first.name;
        mustang.storage.set("count", { words: 3 });
        // @ts-expect-error
        folder.name = "Renamed";
      `,
    });
    expect(errors).toEqual([]);
  });
});
