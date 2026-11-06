import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { sentryVitePlugin } from "@sentry/vite-plugin";
import replace from '@rollup/plugin-replace';
import conditionalCompile from "vite-plugin-conditional-compile";
import { production, webMail, includeProprietary } from '../app/logic/build';
import { defaultClientConditions } from 'vite';
import { resolve } from 'node:path';

const conditionalCompilePlugin: any = conditionalCompile({ // its types say that it returns an array, but it returns one plugin
  // <https://github.com/LZS911/vite-plugin-conditional-compile/blob/master/README.md>
  env: {
    // For conditional `// #if [FOO]` statements in the code
    WEBMAIL: webMail && includeProprietary ? webMail : undefined,
    PROPRIETARY: includeProprietary ? true : undefined,
    PRODUCTION: production ? true : undefined,
    DEV: !production ? true : undefined,
  },
});

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({ exclude: ["@radically-straightforward/sqlite"] }),
      replace({
        __dirname: 'import.meta.dirname',
      }),
    ],
  },
  preload: {
    plugins: [
      externalizeDepsPlugin(),
    ],
  },
  renderer: {
    /* The same HTML shell as the browser and mobile builds. `electron-vite` would
     * otherwise default to `src/renderer/index.html`, and that copy drifted. */
    root: resolve(import.meta.dirname, '../app'),
    build: {
      sourcemap: production,
      rollupOptions: {
        input: resolve(import.meta.dirname, '../app/index.html'),
      },
    },
    plugins: [
      {
        ...conditionalCompilePlugin,
        transform: { filter: { code: "#if" }, handler: conditionalCompilePlugin.transform }, // the plugin parses every file with Babel, which is slow, so give it only the files that use `#if`
      },
      nodePolyfills({include: ['buffer'], globals: {global: true, process: false}}),
      svelte(),
      sentryVitePlugin({
        url: "https://errorlog.parula.app/",
        org: "bugsink-has-no-orgs",
        project: "parula",
        authToken: process.env.SENTRY_AUTH_TOKEN,
        disable: !production,
      }),
    ],
    resolve: {
      // Explicitly set the resolve conditions for Vite 7+
      conditions: [...defaultClientConditions],
    },
  }
})
