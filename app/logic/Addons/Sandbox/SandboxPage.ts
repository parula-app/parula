import { build, type BuildOptions } from "esbuild";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/** Builds `addon-sandbox.html`, the page in which addon code runs.
 * Self-contained: the boot script is inline and allowed by its hash in the page's own policy. */
export class SandboxPage {
  readonly dir = fileURLToPath(new URL(".", import.meta.url));

  async build(): Promise<string> {
    let workerClient = await this.bundle({
      stdin: {
        contents: `import { SandboxClient } from "./client"; new SandboxClient().startWorker();`,
        resolveDir: this.dir,
        loader: "ts",
      },
    });
    let boot = await this.bundle({
      entryPoints: [this.dir + "boot.ts"],
      define: { kWorkerClientSource: JSON.stringify(workerClient) },
    });
    if (boot.includes("</script")) {
      throw new Error("The boot script must not contain </script");
    }
    let hash = createHash("sha256").update(boot).digest("base64");
    let policy = [
      "default-src 'none'",
      `script-src 'sha256-${hash}' blob:`,
      "worker-src blob:",
      "frame-src 'none'",
      "style-src 'unsafe-inline' blob:",
      "img-src blob: data:",
      "font-src blob: data:",
      "connect-src https:",
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; ");
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<meta http-equiv="x-dns-prefetch-control" content="off">
<style>html, body { margin: 0; background: transparent; }</style>
<script>${boot}</script>
</head>
<body></body>
</html>
`;
  }

  protected async bundle(options: BuildOptions): Promise<string> {
    let result = await build({
      ...options,
      bundle: true,
      format: "iife",
      platform: "browser",
      target: "es2022",
      minify: true,
      legalComments: "none",
      write: false,
      logLevel: "silent",
    });
    return result.outputFiles[0].text.trim();
  }

  /** Vite plugin: serves the page in the dev server, and adds it to the build */
  vitePlugin(): Plugin {
    let page = this;
    let cached: Promise<string> | null = null;
    return {
      name: "addon-sandbox-page",
      configureServer(server) {
        server.watcher.on("change", file => {
          if (file.startsWith(page.dir)) {
            cached = null;
          }
        });
        server.middlewares.use((request, response, next) => {
          if (request.url?.split("?")[0] != "/addon-sandbox.html") {
            next();
            return;
          }
          cached ??= page.build();
          cached.then(html => {
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.end(html);
          }, ex => {
            cached = null;
            next(ex);
          });
        });
      },
      async generateBundle() {
        this.emitFile({ type: "asset", fileName: "addon-sandbox.html", source: await page.build() });
      },
    };
  }
}
