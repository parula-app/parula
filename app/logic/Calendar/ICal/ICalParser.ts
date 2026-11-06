import { gt } from "../../../l10n/l10n";
import { assert } from "../../util/util";

function unescaped(value: string): string {
  return value.replace(/\\n|\\(.)/gi, (_, c) => c || "\n");
}

export class ICalEntry {
  properties: Record<string, string> = Object.create(null);
  name: string;
  value: string;
  values: string[];
  line: string;
  constructor(line: string) {
    this.line = line;
    let pos = line.search(/[;:]/);
    this.name = line.slice(0, pos).replace(/.+\.|-/g, "").toLowerCase();
    line = line.slice(pos);
    while (/^;([-\w]+)=("?)((\\?.)*?)\2(?=[;:])/.test(line)) {
      let value = this.properties[RegExp.$1.toLowerCase()];
      this.properties[RegExp.$1.toLowerCase()] = (value ? value + "," : "") + unescaped(RegExp.$3);
      line = RegExp.rightContext;
    }
    this.value = unescaped(line.slice(1));
    this.values = line.match(/(^:|;)(\\?.)*?(?=;|$)/g)?.map(value => unescaped(value.slice(1))) ?? [];
  }
}

export class ICalContainer {
  entries: Record<string, ICalEntry[]> = Object.create(null);
  containers: Record<string, ICalContainer[]> = Object.create(null);
  parent: ICalContainer | ICalParser;
  constructor(parent: ICalContainer | ICalParser) {
    this.parent = parent;
  }
}

export class ICalParser {
  containers: Record<string, ICalContainer[]> = Object.create(null);
  constructor(textFile: string) {
    let current: ICalContainer | ICalParser = this;
    let lines = textFile.replace(/[\r\n]+/g, "\n").replace(/\n\s|\n$/g, "").split("\n");
    let i = 0;
    for (let line of lines) {
      i++;
      if (/^BEGIN:([-\w]+)$/i.test(line)) {
        let name = RegExp.$1.toLowerCase();
        let container = new ICalContainer(current);
        current.containers[name] = append(current.containers[name], container);
        current = container;
      } else if (/^END:([-\w]+)$/i.test(line)) {
        let name = RegExp.$1.toLowerCase();
        assert(current instanceof ICalContainer && current.parent.containers[name]?.at(-1) == current, gt`END without matching BEGIN` + gt`. Line ${i}: ${line}`);
        current = current.parent;
      } else {
        assert(current instanceof ICalContainer, gt`Item outside container` + gt`. Line ${i}: ${line}`);
        let item = new ICalEntry(line);
        current.entries[item.name] = append(current.entries[item.name], item);
      }
    }
  }
}

function append<T>(values: T[] | undefined, value: T): T[] {
  values ||= [];
  values.push(value);
  return values;
}
