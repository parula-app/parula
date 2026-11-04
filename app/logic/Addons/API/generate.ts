import { addonGroups, type AddonGroup } from "./addon";
import ts from "typescript";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const apiDir = dirname(fileURLToPath(import.meta.url));

/** Reads the `@addon` and `@addonHook` annotations and writes `apiTypes.ts` (the allowlist for the bridge)
 * and `addon-api.d.ts` (the typings for addon authors). Run it with `npm run addons:generate`. */
export class AddonAPIGenerator {
  protected checker: ts.TypeChecker;
  protected program: ts.Program;
  protected classes: ClassInfo[] = [];
  protected enums: EnumInfo[] = [];
  protected hooks: HookInfo[] = [];
  protected errors: string[] = [];

  constructor(
    readonly sources = [join(apiDir, "../..")],
    readonly outputDir = apiDir,
    readonly mustangAPIFile = join(apiDir, "../Sandbox/MustangAPI.ts")) {
  }

  generate(): { apiTypes: string, addonAPI: string } {
    let files = this.sources.flatMap(source => ts.sys.directoryExists(source)
      ? ts.sys.readDirectory(source, [".ts"]).filter(file => !file.endsWith(".d.ts"))
      : [resolve(source)]);
    files = files.filter(file => ts.sys.readFile(file).includes("@addon")).sort();
    this.program = ts.createProgram(files, {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      experimentalDecorators: true,
      useDefineForClassFields: false,
      strictNullChecks: true,
      skipLibCheck: true,
      noEmit: true,
      types: [],
    });
    this.checker = this.program.getTypeChecker();
    for (let file of files) {
      for (let statement of this.program.getSourceFile(file).statements) {
        if (ts.isClassDeclaration(statement)) {
          this.readClass(statement);
        } else if (ts.isEnumDeclaration(statement)) {
          this.readEnum(statement);
        }
      }
    }
    for (let classInfo of this.classes) {
      this.resolveClass(classInfo);
    }
    for (let hook of this.hooks) {
      this.resolveHook(hook);
    }
    let mustangAPI = this.readMustangAPI();
    for (let declaration of [...this.classes, ...this.enums]) {
      if ([...this.classes, ...this.enums].filter(d => d.name == declaration.name).length > 1) {
        this.error(declaration.node, declaration.name, "The name of an annotated class or enum must be unique");
      }
    }
    if (this.errors.length) {
      throw new Error("Addon API annotations are wrong:\n" + this.errors.join("\n"));
    }
    this.classes.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (let classInfo of this.classes) {
      classInfo.members.sort((a, b) => a.name.localeCompare(b.name, "en"));
    }
    this.enums.sort((a, b) => a.name.localeCompare(b.name, "en"));
    this.hooks.sort((a, b) => a.point.localeCompare(b.point, "en"));
    return {
      apiTypes: this.apiTypesFile(),
      addonAPI: this.addonAPIFile(mustangAPI),
    };
  }

  write() {
    let { apiTypes, addonAPI } = this.generate();
    ts.sys.writeFile(join(this.outputDir, "apiTypes.ts"), apiTypes);
    ts.sys.writeFile(join(this.outputDir, "addon-api.d.ts"), addonAPI);
  }

  protected readClass(node: ts.ClassDeclaration) {
    let name = node.name?.text ?? "default";
    let members: MemberInfo[] = [];
    for (let member of node.members) {
      let call = this.annotation(member, "addon", name + "." + member.name?.getText());
      if (call) {
        let memberInfo = this.readMember(node, member, call, name);
        if (memberInfo) {
          members.push(memberInfo);
        }
      }
      let hookCall = this.annotation(member, "addonHook", name + "." + member.name?.getText());
      if (hookCall) {
        this.readHook(node, member, hookCall, name);
      }
    }
    let call = this.annotation(node, "addon", name);
    if (!call && !members.length) {
      return;
    }
    if (!node.name || !this.isExported(node)) {
      this.error(node, name, "Annotated classes must be exported by name");
      return;
    }
    if (call && call.arguments.length != 1) {
      this.error(node, name, "A class annotation takes exactly one argument, the groups");
    }
    this.classes.push({
      name,
      node,
      symbol: this.checker.getSymbolAtLocation(node.name),
      groups: call ? this.groups(call.arguments[0], node, name) : undefined,
      members,
    });
  }

  protected readMember(classNode: ts.ClassDeclaration, node: ts.ClassElement, call: ts.CallExpression, className: string): MemberInfo | null {
    let label = className + "." + node.name?.getText();
    if (!node.name || !ts.isIdentifier(node.name)) {
      this.error(node, label, "Annotated members must have a plain name");
      return null;
    }
    if (ts.getCombinedModifierFlags(node as ts.Declaration) & (ts.ModifierFlags.Static | ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) {
      this.error(node, label, "Annotated members must be public and not static");
      return null;
    }
    if (call.arguments.length < 1 || call.arguments.length > 2) {
      this.error(node, label, "@addon() takes the read groups and optionally the write groups");
      return null;
    }
    let name = node.name.text;
    let read = this.groups(call.arguments[0], node, label);
    let write = call.arguments[1] ? this.groups(call.arguments[1], node, label) : undefined;
    if (ts.isPropertyDeclaration(node)) {
      if (write && ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Readonly) {
        this.error(node, label, "A readonly field can't have write groups");
      }
      return { name, node, kind: "field", read, write, isHTML: this.isHTML([node.type], node, label) };
    }
    if (ts.isGetAccessor(node) || ts.isSetAccessor(node)) {
      let accessors = classNode.members.filter(member => member.name?.getText() == name);
      if (!accessors.some(ts.isGetAccessor)) {
        this.error(node, label, "Write-only accessors can't be annotated");
        return null;
      }
      if (write && !accessors.some(ts.isSetAccessor)) {
        this.error(node, label, "A getter without setter can't have write groups");
      }
      let typeNodes = accessors.map(accessor => ts.isGetAccessor(accessor) ? accessor.type : (accessor as ts.SetAccessorDeclaration).parameters[0]?.type);
      return { name, node, kind: "getter", read, write, isHTML: this.isHTML(typeNodes, node, label) };
    }
    if (ts.isMethodDeclaration(node)) {
      if (write) {
        this.error(node, label, "A method can't have write groups");
      }
      return { name, node, kind: "method", read };
    }
    this.error(node, label, "Only classes, fields, accessors and methods can be annotated");
    return null;
  }

  protected readHook(classNode: ts.ClassDeclaration, node: ts.ClassElement, call: ts.CallExpression, className: string) {
    let on = className + "." + node.name?.getText();
    let [pointArg, groupArg, argsArg] = call.arguments;
    if (!ts.isMethodDeclaration(node) || !ts.isIdentifier(node.name)) {
      this.error(node, on, "@addonHook() is only for methods with a plain name");
      return;
    }
    if (!classNode.name || !this.isExported(classNode)) {
      this.error(node, on, "Classes with hooks must be exported by name");
      return;
    }
    if (!pointArg || !ts.isStringLiteral(pointArg) || !pointArg.text) {
      this.error(node, on, "The hook point must be a string literal");
      return;
    }
    if (!groupArg || !ts.isStringLiteral(groupArg)) {
      this.error(node, on, "The hook group must be a string literal");
      return;
    }
    let argsFunction = argsArg && ts.isArrowFunction(argsArg) ? argsArg : undefined;
    if (argsArg && !argsFunction) {
      this.error(node, on, "The hook arguments must be given by an arrow function");
      return;
    }
    let members = argsFunction ? this.hookArgMembers(argsFunction) : undefined;
    if (argsFunction && !members) {
      this.error(node, on, "The hook arguments function must look like (self: Class) => ({ name: self.member })");
      return;
    }
    let point = pointArg.text;
    if (this.hooks.some(hook => hook.point == point)) {
      this.error(node, on, `Hook point "${point}" exists twice`);
      return;
    }
    this.hooks.push({ point, on, classNode, method: node.name.text, node, group: this.groups(groupArg, node, on)[0], argsFunction, members });
  }

  /** `(actions) => ({ email: actions.email })` -> argument name `email` -> member `email`
   * @returns null, if the function has another form */
  protected hookArgMembers(argsFunction: ts.ArrowFunction): Map<string, string> | null {
    let self = argsFunction.parameters.length == 1 ? argsFunction.parameters[0].name : undefined;
    let body = argsFunction.body;
    while (ts.isParenthesizedExpression(body)) {
      body = body.expression;
    }
    if (!self || !ts.isIdentifier(self) || !ts.isObjectLiteralExpression(body)) {
      return null;
    }
    let members = new Map<string, string>();
    for (let property of body.properties) {
      let value = ts.isPropertyAssignment(property) ? property.initializer : undefined;
      if (!value || !ts.isIdentifier(property.name) || !ts.isPropertyAccessExpression(value) ||
          !ts.isIdentifier(value.expression) || value.expression.text != self.text || !ts.isIdentifier(value.name)) {
        return null;
      }
      members.set(property.name.text, value.name.text);
    }
    return members;
  }

  protected readEnum(node: ts.EnumDeclaration) {
    let name = node.name.text;
    let tag = ts.getJSDocTags(node).find(tag => tag.tagName.text == "addon");
    if (!tag) {
      return;
    }
    if (!this.isExported(node)) {
      this.error(node, name, "Annotated enums must be exported");
      return;
    }
    let text = ts.getTextOfJSDocComment(tag.comment)?.trim() ?? "";
    let groupNames: unknown[] = [];
    if (text.startsWith("(") && text.endsWith(")")) {
      try {
        groupNames = JSON.parse("[" + text.slice(1, -1) + "]");
      } catch (ex) {
        groupNames = [];
      }
    }
    if (groupNames.length != 1) {
      this.error(node, name, 'An enum annotation is a doc tag like /** @addon("mail.all") */');
      return;
    }
    let values = node.members.map(member => this.checker.getConstantValue(member));
    if (values.some(value => value === undefined)) {
      this.error(node, name, "Annotated enums must have constant values");
      return;
    }
    this.enums.push({ name, node, groups: this.validGroups([groupNames[0]].flat(), node, name), values });
  }

  protected resolveClass(classInfo: ClassInfo) {
    for (let base = this.baseClass(classInfo.symbol); base; base = this.baseClass(base)) {
      classInfo.superclass = this.classes.find(c => c.symbol == base);
      if (classInfo.superclass) {
        break;
      }
    }
    for (let member of classInfo.members) {
      let label = classInfo.name + "." + member.name;
      if (member.kind == "method") {
        let signature = this.checker.getSignatureFromDeclaration(member.node as ts.MethodDeclaration);
        member.params = this.params(signature.parameters, label);
        member.returns = this.returnTypes(signature.getReturnType(), member.node, label);
      } else {
        let symbol = this.checker.getSymbolAtLocation(member.node.name);
        member.type = member.isHTML ? ["HTML"] : this.types(this.checker.getTypeOfSymbol(symbol), member.node, label, "value");
      }
    }
  }

  protected resolveHook(hook: HookInfo) {
    let signature = this.checker.getSignatureFromDeclaration(hook.node);
    let returnType = signature.getReturnType();
    if (!this.isLibType(returnType.getSymbol(), "Promise")) {
      this.error(hook.node, hook.on, "Hookable methods must be async");
      return;
    }
    hook.result = this.returnTypes(returnType, hook.node, hook.on);
    if (hook.result.some(type => typeof type == "object" && !("values" in type))) {
      this.error(hook.node, hook.on, "Hook results must be plain data, not app objects");
    }
    if (!hook.argsFunction) {
      hook.args = this.params(signature.parameters, hook.on);
      return;
    }
    let argsType = this.checker.getSignatureFromDeclaration(hook.argsFunction).getReturnType();
    hook.args = this.checker.getPropertiesOfType(argsType).map(property => ({
      name: property.name,
      type: this.types(this.checker.getTypeOfSymbol(property), hook.argsFunction, hook.on + " hook argument " + property.name, "value"),
      optional: false,
      member: hook.members.get(property.name),
    }));
  }

  protected params(parameters: readonly ts.Symbol[], label: string): ParamInfo[] {
    let params: ParamInfo[] = [];
    for (let parameter of parameters) {
      let node = parameter.valueDeclaration as ts.ParameterDeclaration;
      let paramLabel = label + " parameter " + parameter.name;
      if (node.dotDotDotToken) {
        this.error(node, paramLabel, "Rest parameters are not allowed");
        continue;
      }
      let optional = !!node.questionToken || !!node.initializer;
      let type: TypeInfo[] = this.isHTML([node.type], node, paramLabel)
        ? ["HTML"]
        : this.types(this.checker.getTypeOfSymbol(parameter), node, paramLabel, "value");
      if (optional) {
        type = type.filter(t => t != "undefined");
      }
      params.push({ name: parameter.name, type, optional });
    }
    return params;
  }

  protected returnTypes(type: ts.Type, node: ts.Node, label: string): TypeInfo[] {
    if (this.isLibType(type.getSymbol(), "Promise")) {
      type = this.checker.getAwaitedType(type);
    }
    return this.types(type, node, label + " return value", "return");
  }

  protected types(type: ts.Type, node: ts.Node, label: string, position: "value" | "return" | "item"): TypeInfo[] {
    let result: TypeInfo[] = [];
    let enumLiterals = new Map<EnumInfo, number>();
    for (let alternative of type.isUnion() ? type.types : [type]) {
      let typeInfo = this.type(alternative, node, label, position);
      if (typeInfo && typeof typeInfo == "object" && "values" in typeInfo) {
        enumLiterals.set(typeInfo, (enumLiterals.get(typeInfo) ?? 0) + 1);
      }
      if (typeInfo && !result.includes(typeInfo)) {
        result.push(typeInfo);
      }
    }
    for (let [enumInfo, count] of enumLiterals) {
      if (count < enumInfo.values.length) {
        this.error(node, label, `Only part of the enum ${enumInfo.name} is not allowed`);
      }
    }
    if (!result.length && position == "item") {
      this.error(node, label, `The collection items ${this.checker.typeToString(type)} are not annotated classes`);
    }
    return result.sort((a, b) => this.sortKey(a).localeCompare(this.sortKey(b), "en"));
  }

  /** `HTMLString` (logic/util/util.ts) becomes "HTML", which the bridge sanitizes when it comes from an addon */
  protected isHTML(typeNodes: (ts.TypeNode | undefined)[], node: ts.Node, label: string): boolean {
    let found = typeNodes.filter(typeNode => typeNode && /\bHTMLString\b/.test(typeNode.getText()));
    if (found.some(typeNode => !ts.isTypeReferenceNode(typeNode) || typeNode.typeName.getText() != "HTMLString")) {
      this.error(node, label, "HTMLString can only be the whole type");
    }
    return found.length > 0;
  }

  protected sortKey(type: TypeInfo): string {
    let order = ["string", "HTML", "number", "boolean", "Date", "Uint8Array", "objects", "void", "null", "undefined"];
    if (typeof type == "string") {
      return String(order.indexOf(type));
    }
    return order.indexOf("objects") + ("collection" in type ? "" : type.name);
  }

  protected type(type: ts.Type, node: ts.Node, label: string, position: "value" | "return" | "item"): TypeInfo | null {
    let flags = type.flags;
    let symbol = type.getSymbol();
    if (flags & ts.TypeFlags.EnumLiteral) {
      let enumInfo = this.enums.find(e => e.node == symbol?.valueDeclaration?.parent);
      if (enumInfo) {
        return enumInfo;
      }
      this.error(node, label, `The enum of ${this.checker.typeToString(type)} is not annotated`);
      return null;
    }
    if (flags & ts.TypeFlags.String) {
      return "string";
    }
    if (flags & ts.TypeFlags.Number) {
      return "number";
    }
    if (flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) {
      return "boolean";
    }
    if (flags & ts.TypeFlags.Null) {
      return "null";
    }
    if (flags & ts.TypeFlags.Undefined) {
      return "undefined";
    }
    if (flags & ts.TypeFlags.Void && position == "return") {
      return "void";
    }
    if (flags & ts.TypeFlags.Object && symbol) {
      if (this.isLibType(symbol, "Date")) {
        return "Date";
      }
      if (this.isLibType(symbol, "Uint8Array")) {
        return "Uint8Array";
      }
      if (this.isCollection(symbol) && position != "item") {
        let itemType = this.checker.getTypeOfSymbol(this.checker.getPropertyOfType(type, "first"));
        return { collection: this.types(itemType, node, label, "item") };
      }
      let classInfo = this.classes.find(c => c.symbol == symbol);
      if (classInfo) {
        return classInfo;
      }
      if (position == "item" && symbol.flags & ts.SymbolFlags.Class) {
        return null;
      }
    }
    this.error(node, label, `The type ${this.checker.typeToString(type)} is not allowed`);
    return null;
  }

  protected isCollection(symbol: ts.Symbol): boolean {
    for (let current = symbol; current; current = this.baseClass(current)) {
      if (current.name == "Collection" &&
          current.declarations?.some(d => d.getSourceFile().fileName.includes("/svelte-collections/"))) {
        return true;
      }
    }
    return false;
  }

  protected baseClass(symbol: ts.Symbol): ts.Symbol | undefined {
    if (!(symbol.flags & ts.SymbolFlags.Class)) {
      return undefined;
    }
    let type = this.checker.getDeclaredTypeOfSymbol(symbol) as ts.InterfaceType;
    return this.checker.getBaseTypes(type)[0]?.getSymbol();
  }

  protected isLibType(symbol: ts.Symbol | undefined, name: string): boolean {
    return symbol?.name == name &&
      !!symbol.declarations?.some(d => this.program.isSourceFileDefaultLibrary(d.getSourceFile()));
  }

  protected isExported(node: ts.Declaration): boolean {
    return !!(ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export);
  }

  protected annotation(node: ts.Node, name: "addon" | "addonHook", label: string): ts.CallExpression | undefined {
    let decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
    let calls: ts.CallExpression[] = [];
    for (let decorator of decorators) {
      let expression = decorator.expression;
      let callee = ts.isCallExpression(expression) ? expression.expression : expression;
      if (!ts.isIdentifier(callee) || callee.text != name) {
        continue;
      }
      if (!ts.isCallExpression(expression)) {
        this.error(node, label, `@${name} needs arguments`);
        continue;
      }
      calls.push(expression);
    }
    if (calls.length > 1) {
      this.error(node, label, `@${name}() is there twice`);
    }
    return calls[0];
  }

  protected groups(argument: ts.Expression, node: ts.Node, label: string): AddonGroup[] {
    let literals = ts.isArrayLiteralExpression(argument) ? [...argument.elements] : [argument];
    if (!literals.every(ts.isStringLiteral)) {
      this.error(node, label, "Groups must be string literals");
      return [];
    }
    return this.validGroups(literals.map(literal => literal.text), node, label);
  }

  protected validGroups(names: unknown[], node: ts.Node, label: string): AddonGroup[] {
    if (!names.length) {
      this.error(node, label, "No group given");
    }
    for (let name of names) {
      if (!addonGroups.includes(name as AddonGroup)) {
        this.error(node, label, `Unknown group ${JSON.stringify(name)}. Known groups: ${addonGroups.join(", ")}`);
      }
    }
    return names.filter(name => addonGroups.includes(name as AddonGroup)) as AddonGroup[];
  }

  protected readMustangAPI(): MustangAPIInfo {
    let text = ts.sys.readFile(this.mustangAPIFile) ?? "";
    let sourceFile = ts.createSourceFile(this.mustangAPIFile, text, ts.ScriptTarget.ESNext, true);
    let imports = sourceFile.statements.filter(ts.isImportDeclaration);
    let collectionTypes: string[] = [];
    for (let declaration of imports) {
      let from = (declaration.moduleSpecifier as ts.StringLiteral).text;
      let bindings = declaration.importClause?.namedBindings;
      if (from == "svelte-collections" && bindings && ts.isNamedImports(bindings)) {
        collectionTypes.push(...bindings.elements.map(element => element.name.text));
      } else if (!from.endsWith("/addon-api")) {
        this.error(declaration, "MustangAPI.ts", "May import only from svelte-collections and addon-api");
      }
    }
    return { collectionTypes, body: text.slice(imports.at(-1)?.end ?? 0).trim() };
  }

  protected error(node: ts.Node, label: string, message: string) {
    let sourceFile = node.getSourceFile();
    let line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    this.errors.push(`${relative(process.cwd(), sourceFile.fileName)}:${line} ${label}: ${message}`);
  }

  protected apiTypesFile(): string {
    let imports = new Map<string, Set<string>>();
    for (let node of [...this.classes.map(classInfo => classInfo.node), ...this.hooks.map(hook => hook.classNode)]) {
      let path = this.importPath(node.getSourceFile().fileName);
      imports.set(path, (imports.get(path) ?? new Set<string>()).add(node.name.text));
    }
    let importLines = [...imports.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([path, names]) => `import { ${[...names].sort().join(", ")} } from "${path}";`);
    return [
      "// Generated by `npm run addons:generate` from the @addon annotations. Do not edit.",
      `import type { APIClass, APIEnum, APIHook } from "${this.importPath(join(apiDir, "addon.ts"))}";`,
      ...importLines,
      "",
      ...this.listOrEmpty("export const apiClasses: APIClass[] = [", this.classes.map(classInfo => [
        "  {",
        `    name: "${classInfo.name}",`,
        `    class: ${classInfo.name},`,
        ...classInfo.groups ? [`    groups: ${this.groupsLiteral(classInfo.groups)},`] : [],
        ...classInfo.superclass ? [`    extends: "${classInfo.superclass.name}",`] : [],
        ...this.listOrEmpty("    members: [", classInfo.members.map(member => `      ${this.memberLiteral(member)},`), "    ],"),
        "  },",
      ]).flat(), "];"),
      "",
      ...this.listOrEmpty("export const apiEnums: APIEnum[] = [", this.enums.map(enumInfo =>
        `  { name: "${enumInfo.name}", groups: ${this.groupsLiteral(enumInfo.groups)}, values: [${enumInfo.values.map(value => JSON.stringify(value)).join(", ")}] },`), "];"),
      "",
      ...this.listOrEmpty("export const apiHooks: APIHook[] = [", this.hooks.map(hook => [
        "  {",
        `    point: "${hook.point}",`,
        `    class: ${hook.classNode.name.text},`,
        `    method: "${hook.method}",`,
        `    group: "${hook.group}",`,
        `    args: [${hook.args.map(param => this.paramLiteral(param)).join(", ")}],`,
        `    result: ${this.typesLiteral(hook.result)},`,
        "  },",
      ]).flat(), "];"),
      "",
    ].join("\n");
  }

  protected listOrEmpty(start: string, lines: string[], end: string): string[] {
    return lines.length ? [start, ...lines, end] : [start + end.trim()];
  }

  protected memberLiteral(member: MemberInfo): string {
    let write = member.write ? `, write: ${this.groupsLiteral(member.write)}` : "";
    let start = `{ name: "${member.name}", kind: "${member.kind}", read: ${this.groupsLiteral(member.read)}${write}`;
    if (member.kind == "method") {
      return `${start}, params: [${member.params.map(param => this.paramLiteral(param)).join(", ")}], returns: ${this.typesLiteral(member.returns)} }`;
    }
    return `${start}, type: ${this.typesLiteral(member.type)} }`;
  }

  protected paramLiteral(param: ParamInfo): string {
    return `{ name: "${param.name}", type: ${this.typesLiteral(param.type)}${param.optional ? ", optional: true" : ""}${param.member ? `, member: "${param.member}"` : ""} }`;
  }

  protected typesLiteral(types: TypeInfo[]): string {
    return "[" + types.map(type => {
      if (typeof type == "string") {
        return JSON.stringify(type);
      }
      if ("collection" in type) {
        return `{ collection: ${this.typesLiteral(type.collection)} }`;
      }
      if ("values" in type) {
        return `{ enum: "${type.name}" }`;
      }
      return type.name;
    }).join(", ") + "]";
  }

  protected groupsLiteral(groups: AddonGroup[]): string {
    return "[" + groups.map(group => JSON.stringify(group)).join(", ") + "]";
  }

  protected importPath(file: string): string {
    let path = relative(this.outputDir, file).replaceAll("\\", "/").replace(/\.ts$/, "");
    return path.startsWith(".") ? path : "./" + path;
  }

  protected addonAPIFile(mustangAPI: MustangAPIInfo): string {
    let collectionTypes = [...new Set(["Collection", ...mustangAPI.collectionTypes])].sort();
    return [
      "// Generated by `npm run addons:generate` from the @addon annotations and Sandbox/MustangAPI.ts. Do not edit.",
      `import type { ${collectionTypes.join(", ")} } from "svelte-collections";`,
      "",
      ...this.classes.map(classInfo => [
        ...classInfo.groups ? [`/** ${this.annotationText(classInfo.groups)} */`] : [],
        ...this.listOrEmpty(`export interface ${classInfo.name} extends ${classInfo.superclass?.name ?? "AddonObject"} {`,
          classInfo.members.map(member => [
            `  /** ${this.annotationText(member.read, member.write)} */`,
            ...this.memberDeclaration(member).map(line => "  " + line),
          ]).flat(), "}"),
        "",
      ]).flat(),
      ...this.enums.map(enumInfo => [
        `/** ${this.annotationText(enumInfo.groups)} */`,
        `export type ${enumInfo.name} = ${enumInfo.values.map(value => JSON.stringify(value)).join(" | ")};`,
        "",
      ]).flat(),
      ...this.listOrEmpty("export interface HookPoints {", this.hooks.map(hook =>
        `  "${hook.point}": { args: { ${hook.args.map(arg => `${arg.name}: ${this.typesTS(arg.type)}; `).join("")}}, result: ${this.typesTS(hook.result)} };`), "}"),
      "",
      mustangAPI.body,
      "",
      "declare global {",
      "  const mustang: MustangAPI;",
      "}",
      "",
    ].join("\n");
  }

  protected memberDeclaration(member: MemberInfo): string[] {
    if (member.kind == "method") {
      let params = member.params.map(param => `${param.name}${param.optional ? "?" : ""}: ${this.typesTS(param.type)}`);
      return [`${member.name}(${params.join(", ")}): Promise<${this.typesTS(member.returns)}>;`];
    }
    if (member.kind == "getter") {
      return [
        `get ${member.name}(): Promise<${this.typesTS(member.type)}>;`,
        ...member.write ? [`set ${member.name}(value: ${this.typesTS(member.type)});`] : [],
      ];
    }
    return [`${member.write ? "" : "readonly "}${member.name}: ${this.typesTS(member.type)};`];
  }

  protected typesTS(types: TypeInfo[]): string {
    return types.map(type => {
      if (type == "HTML") {
        return "string";
      }
      if (typeof type == "string") {
        return type;
      }
      if ("collection" in type) {
        return `Collection<${this.typesTS(type.collection)}>`;
      }
      return type.name;
    }).join(" | ");
  }

  protected annotationText(read: AddonGroup[], write?: AddonGroup[]): string {
    return `@addon(${this.groupsArgument(read)}${write ? ", " + this.groupsArgument(write) : ""})`;
  }

  protected groupsArgument(groups: AddonGroup[]): string {
    return groups.length == 1 ? JSON.stringify(groups[0]) : this.groupsLiteral(groups);
  }
}

interface ClassInfo {
  name: string;
  node: ts.ClassDeclaration;
  symbol: ts.Symbol;
  groups?: AddonGroup[];
  superclass?: ClassInfo;
  members: MemberInfo[];
}

interface MemberInfo {
  name: string;
  node: ts.ClassElement;
  kind: "field" | "getter" | "method";
  read: AddonGroup[];
  write?: AddonGroup[];
  isHTML?: boolean;
  type?: TypeInfo[];
  params?: ParamInfo[];
  returns?: TypeInfo[];
}

interface ParamInfo {
  name: string;
  type: TypeInfo[];
  optional: boolean;
  member?: string;
}

interface EnumInfo {
  name: string;
  node: ts.EnumDeclaration;
  groups: AddonGroup[];
  values: (string | number)[];
}

interface HookInfo {
  point: string;
  on: string;
  classNode: ts.ClassDeclaration;
  method: string;
  node: ts.MethodDeclaration;
  group: AddonGroup;
  argsFunction?: ts.ArrowFunction;
  members?: Map<string, string>;
  args?: ParamInfo[];
  result?: TypeInfo[];
}

interface MustangAPIInfo {
  collectionTypes: string[];
  body: string;
}

type TypeInfo = "string" | "HTML" | "number" | "boolean" | "Date" | "Uint8Array" | "null" | "undefined" | "void" |
  ClassInfo | EnumInfo | { collection: TypeInfo[] };

if (process.argv[1] && import.meta.url == pathToFileURL(resolve(process.argv[1])).href) {
  new AddonAPIGenerator().write();
}
