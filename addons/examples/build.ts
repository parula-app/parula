/* Builds an addon into its `dist/`, with the esbuild and Svelte of the app:
 * the logic (`main` in the manifest) as classic script for the worker,
 * the UI modules (`entry`, `popup`, `setup`) as ES modules. `dist/<name>.js` comes from `src/<name>.ts`.
 * Usage, in app/: npx tsx ../addons/examples/build.ts <addon directory> */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export class AddonBuilder {
  /** The addon package, with `package.json` */
  readonly dir: string;
  protected appDir = fileURLToPath(new URL("../../app/", import.meta.url));
  protected appRequire = createRequire(this.appDir + "package.json");

  constructor(dir: string) {
    this.dir = path.resolve(dir);
  }

  /** @returns path in the package -> contents
   * @param write Also write the files into the package */
  async build(write = true): Promise<Map<string, Uint8Array>> {
    let manifest = JSON.parse(await readFile(path.join(this.dir, "package.json"), "utf-8")).mustang;
    let files = new Map<string, Uint8Array>();
    if (manifest.main) {
      files.set(manifest.main, await this.bundle(manifest.main, "iife"));
    }
    for (let entry of this.uiModules(manifest)) {
      files.set(entry, await this.bundle(entry, "esm"));
    }
    if (write) {
      for (let [file, contents] of files) {
        let filePath = path.join(this.dir, file);
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, contents);
      }
    }
    return files;
  }

  protected uiModules(manifest: any): Set<string> {
    let modules = new Set<string>();
    for (let contributions of Object.values(manifest.ui ?? {}) as any[]) {
      for (let contribution of contributions) {
        for (let file of [contribution.entry, contribution.popup]) {
          if (file) {
            modules.add(file);
          }
        }
      }
    }
    for (let item of [...manifest.protocols ?? [], ...manifest.apps ?? []]) {
      for (let file of [item.setup, item.entry]) {
        if (file) {
          modules.add(file);
        }
      }
    }
    return modules;
  }

  protected async bundle(output: string, format: "iife" | "esm"): Promise<Uint8Array> {
    let esbuild = this.appRequire("esbuild");
    let { compile } = this.appRequire("svelte/compiler");
    let source = path.join(this.dir, output.replace(/^dist\//, "src/").replace(/\.js$/, ".ts"));
    let result = await esbuild.build({
      entryPoints: [source],
      bundle: true,
      format,
      platform: "browser",
      target: "es2022",
      minify: true,
      legalComments: "none",
      write: false,
      logLevel: "warning",
      nodePaths: [this.appDir + "node_modules"],
      conditions: ["browser", "svelte"],
      plugins: [{
        name: "svelte",
        setup(build) {
          build.onLoad({ filter: /\.svelte$/ }, async args => ({
            contents: compile(await readFile(args.path, "utf-8"), { filename: args.path, css: "injected", generate: "client" }).js.code,
            loader: "js",
            resolveDir: path.dirname(args.path),
          }));
        },
      }],
    });
    return result.outputFiles[0].contents;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) == fileURLToPath(import.meta.url)) {
  await new AddonBuilder(process.argv[2]).build();
}
