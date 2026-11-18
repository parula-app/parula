// @vitest-environment happy-dom
import "../../../frontend/Util/happyDOMForDOMPurify"; // The reply is HTML
import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { JMAPAutoResponder } from "../../../../logic/Mail/JMAP/JMAPAutoResponder";
import { StalwartAutoResponder } from "../../../../logic/Mail/JMAP/StalwartAutoResponder";
import type { TJMAPMethodResponse, TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import type { TJMAPSieveScript, TJMAPVacationResponse } from "../../../../logic/Mail/JMAP/TJMAPMail";
import { expect, test } from "vitest";

appGlobal.remoteApp ??= { kyCreate: () => null } as any;

const kFilters = `require "fileinto";\r\nif header :contains "subject" "invoice" {\r\n  fileinto "Invoices";\r\n  stop;\r\n}\r\n`;

/** Answers like Stalwart: It runs only the active Sieve script,
 * and `VacationResponse` is the script "vacation", which `isEnabled` activates. */
class Server {
  account = new JMAPAccount();
  vacation: TJMAPVacationResponse = { id: "singleton", isEnabled: false, fromDate: null, toDate: null, subject: null, textBody: null, htmlBody: null };
  /** Incl. "vacation" */
  scripts: (TJMAPSieveScript & { content: string })[] = [];
  methods: string[] = [];
  protected uploaded: string;
  protected lastID = 0;

  constructor(isStalwart: boolean, filters?: string) {
    if (filters) {
      this.scripts.push({ id: "s0", name: "filters", isActive: true, content: filters });
    }
    this.account.accountID = "e";
    this.account.session = {
      capabilities: {
        "urn:ietf:params:jmap:vacationresponse": {},
        "urn:ietf:params:jmap:sieve": isStalwart ? { implementation: "Stalwart v1.0.0" } : undefined,
      },
      accounts: { e: { accountCapabilities: { "urn:ietf:params:jmap:vacationresponse": {} } } },
      primaryAccounts: {},
    } as any as TJMAPSession;
    this.account.makeCalls = async (calls: [string, Record<string, any>, string?][]) =>
      calls.map(([method, args, callID]) => [method, this.call(method, args), callID] as TJMAPMethodResponse);
  }

  get activeScript() {
    return this.scripts.find(script => script.isActive);
  }

  call(method: string, args: Record<string, any>): Record<string, any> {
    this.methods.push(method);
    if (method == "VacationResponse/get") {
      return { list: [{ ...this.vacation }] };
    } else if (method == "VacationResponse/set") {
      let { isEnabled, ...content } = args.update.singleton;
      Object.assign(this.vacation, content);
      let script = this.scripts.find(script => script.name == "vacation");
      if (!script) {
        script = { id: "s" + ++this.lastID, name: "vacation", isActive: false, content: "vacation" };
        this.scripts.push(script);
      }
      if (isEnabled) {
        this.activate(script);
      } else if (script.isActive) {
        this.activate(null);
      }
      this.vacation.isEnabled = script.isActive;
      return { updated: { singleton: null } };
    } else if (method == "SieveScript/get") {
      return { list: this.scripts.map(({ id, name, isActive }) => ({ id, name, isActive })) };
    } else if (method == "Blob/upload") {
      this.uploaded = args.create.script.data[0]["data:asText"];
      return { created: { script: { id: "blob1" } } };
    } else if (method == "SieveScript/set") {
      let created: TJMAPSieveScript & { content: string };
      if (args.create) {
        created = { id: "s" + ++this.lastID, name: args.create.ours.name, isActive: false, content: this.uploaded };
        this.scripts.push(created);
      }
      let notDestroyed: Record<string, any>;
      for (let id of args.destroy ?? []) {
        if (this.scripts.find(script => script.id == id).isActive) {
          notDestroyed = { [id]: { type: "scriptIsActive" } };
        } else {
          this.scripts = this.scripts.filter(script => script.id != id);
        }
      }
      if (args.onSuccessActivateScript) {
        this.activate(args.onSuccessActivateScript == "#ours" ? created : this.scripts.find(script => script.id == args.onSuccessActivateScript));
      } else if (args.onSuccessDeactivateScript) {
        this.activate(null);
      }
      return { created: created ? { ours: { id: created.id } } : undefined, notDestroyed };
    }
    throw new Error("Unknown method " + method);
  }

  protected activate(script: TJMAPSieveScript | null) {
    for (let each of this.scripts) {
      each.isActive = each == script;
    }
  }
}

test("The class follows the server, which the login tells", () => {
  let account = new JMAPAccount();
  expect(account.autoResponder).toBeInstanceOf(JMAPAutoResponder);
  expect(account.autoResponder.supported).toBe(false);

  let stalwart = new Server(true);
  expect(stalwart.account.autoResponder).toBeInstanceOf(StalwartAutoResponder);
  expect(stalwart.account.autoResponder.supported).toBe(true);
  expect(stalwart.account.newAutoResponder()).toBeInstanceOf(StalwartAutoResponder); // Lookout's dialog edits its own

  let other = new Server(false);
  expect(other.account.autoResponder).not.toBeInstanceOf(StalwartAutoResponder);
  expect(other.account.autoResponder.supported).toBe(true);
});

test("Writes the reply and the time range", async () => {
  let server = new Server(false);
  let autoResponder = server.account.autoResponder;
  autoResponder.isOn = true;
  autoResponder.scheduled = true;
  autoResponder.startTime = new Date("2026-12-21T08:00:00Z");
  autoResponder.endTime = new Date("2027-01-04T17:00:00Z");
  autoResponder.internalHTML = "<p>Back on <b>January 4</b></p>";
  await autoResponder.save();

  expect(server.vacation.isEnabled).toBe(true);
  expect(new Date(server.vacation.fromDate).getTime()).toBe(autoResponder.startTime.getTime());
  expect(new Date(server.vacation.toDate).getTime()).toBe(autoResponder.endTime.getTime());
  expect(server.vacation.htmlBody).toContain("January 4");
  expect(server.vacation.textBody).toContain("Back on January 4");
  expect(server.methods).toEqual(["VacationResponse/set"]);

  autoResponder.scheduled = false;
  await autoResponder.save();
  expect(server.vacation.isEnabled).toBe(true);
  expect(server.vacation.fromDate).toBeNull();
  expect(server.vacation.toDate).toBeNull();

  autoResponder.isOn = false;
  await autoResponder.save();
  expect(server.vacation.isEnabled).toBe(false);
});

test("Reads the reply and the time range", async () => {
  let server = new Server(false);
  server.vacation = { ...server.vacation, isEnabled: true, fromDate: "2026-12-21T08:00:00Z", toDate: "2027-01-04T17:00:00Z", textBody: "Back on January 4" };
  let autoResponder = server.account.autoResponder;
  await autoResponder.load();

  expect(autoResponder.isOn).toBe(true);
  expect(autoResponder.scheduled).toBe(true);
  expect(autoResponder.startTime.getTime()).toBe(new Date("2026-12-21T08:00:00Z").getTime());
  expect(autoResponder.endTime.getTime()).toBe(new Date("2027-01-04T17:00:00Z").getTime());
  expect(autoResponder.internalHTML).toContain("Back on January 4"); // Text from another app

  server.vacation = { ...server.vacation, isEnabled: false, fromDate: null, toDate: null, htmlBody: "<p>Gone fishing</p>" };
  await autoResponder.load();
  expect(autoResponder.isOn).toBe(false);
  expect(autoResponder.scheduled).toBe(false);
  expect(autoResponder.internalHTML).toContain("Gone fishing");
});

test("Stalwart: The filters keep working while the automatic replies are on, and afterwards", async () => {
  let server = new Server(true, kFilters);
  let autoResponder = server.account.autoResponder;
  autoResponder.isOn = true;
  autoResponder.internalHTML = "<p>Gone fishing</p>";
  await autoResponder.save();

  expect(server.vacation.htmlBody).toContain("Gone fishing");
  let active = server.activeScript.content;
  expect(active).toContain(`include :personal "vacation"`);
  expect(active).toContain(`"filters"`);
  expect(active.indexOf(`"vacation"`)).toBeLessThan(active.indexOf(`"filters"`)); // The filters may `stop`

  let otherDevice = new Server(true);
  otherDevice.vacation = server.vacation;
  otherDevice.scripts = server.scripts;
  await otherDevice.account.autoResponder.load();
  expect(otherDevice.account.autoResponder.isOn).toBe(true);

  autoResponder.isOn = false;
  await autoResponder.save();
  expect(server.activeScript.content).toBe(kFilters);
  expect(server.scripts.map(script => script.name).sort()).toEqual(["filters", "vacation"]);

  await otherDevice.account.autoResponder.load();
  expect(otherDevice.account.autoResponder.isOn).toBe(false);
});

test("Stalwart: Changing the reply while it's on keeps our script", async () => {
  let server = new Server(true, kFilters);
  let autoResponder = server.account.autoResponder;
  autoResponder.isOn = true;
  await autoResponder.save();
  let ourScript = server.activeScript;

  autoResponder.internalHTML = "<p>Back next week</p>";
  await autoResponder.save();
  expect(server.activeScript).toBe(ourScript);
  expect(server.vacation.htmlBody).toContain("Back next week");
  expect(server.scripts.length).toBe(3);
});

test("Stalwart: Without filters, the reply is on like in other apps", async () => {
  let server = new Server(true);
  let autoResponder = server.account.autoResponder;
  autoResponder.isOn = true;
  await autoResponder.save();
  expect(server.vacation.isEnabled).toBe(true);
  expect(server.activeScript.name).toBe("vacation");

  autoResponder.isOn = false;
  await autoResponder.save();
  expect(server.vacation.isEnabled).toBe(false);
  expect(server.activeScript).toBeUndefined();
});

test("Stalwart: The filters were deleted while the replies were on", async () => {
  let server = new Server(true, kFilters);
  let autoResponder = server.account.autoResponder;
  autoResponder.isOn = true;
  await autoResponder.save();
  server.scripts = server.scripts.filter(script => script.name != "filters");

  autoResponder.isOn = false;
  await autoResponder.save();
  expect(server.activeScript).toBeUndefined();
  expect(server.scripts.map(script => script.name)).toEqual(["vacation"]);
});

test("Stalwart: A too long reply fails before it changes anything", async () => {
  let server = new Server(true, kFilters);
  let autoResponder = server.account.autoResponder;
  autoResponder.isOn = true;
  autoResponder.internalHTML = "<p>" + "Gone fishing. ".repeat(200) + "</p>";

  await expect(autoResponder.save()).rejects.toThrow();
  expect(server.methods).toEqual([]);
  expect(server.activeScript.name).toBe("filters");
});
