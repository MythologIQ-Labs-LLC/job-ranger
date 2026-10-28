/**
 * Build for the Sojourner web/PWA runtime (output: dist-pwa/).
 *
 * The web runtime runs the *same* shared application core as Electron
 * (electron/src/*.cts: repositories, migrations, domain services, IPC channel
 * table, validators). Runtime-specific infrastructure is substituted at build
 * time by the adapter map below; nothing else is forked.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { buildContentSecurityPolicy, buildSecurityHeaders } from "./src/pwa/security/policy.ts";
import { NODE_BUILTIN_ADAPTERS, SHARED_CORE_ADAPTERS } from "./src/pwa/adapter-map.ts";
import { buildPdfFonts } from "./scripts/pdf-fonts.mjs";
import { createStudioHandoff } from "./scripts/studio-handoff.mjs";
import {
  DEMO_LOCAL_PORTS,
  PWA_FLAVOR_ENV,
  assertDemoPortAllowed,
  parsePwaFlavor,
  pwaBuildId,
  pwaOutDirName,
} from "./scripts/pwa-flavor.mjs";
import { createRuntimeAdapterPlugin, type RuntimeTarget } from "./src/pwa/build/runtime-adapter-plugin.ts";

const root = path.dirname(fileURLToPath(import.meta.url));
// Build flavor (scripts/pwa-flavor.mjs): "standard" (default) or "demo". The
// demo flavor builds into its own directory so it can never overwrite, or be
// deployed as, the standard workspace build.
const flavor = parsePwaFlavor(process.env[PWA_FLAVOR_ENV]);
const outDir = path.join(root, pwaOutDirName(flavor));
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version: string };

function gitCommit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const commit = gitCommit();
const buildId = pwaBuildId({
  version: packageJson.version,
  commit,
  flavor,
  override: process.env.JOB_RANGER_BUILD_ID,
});

// Only a public Web OAuth client ID is embedded; never a token or client secret.
// The demo flavor cannot access Google, even if a maintainer sets the variable.
const suppliedGoogleId = (process.env.VITE_JOB_RANGER_GOOGLE_WEB_CLIENT_ID ?? "").trim();
if (suppliedGoogleId && !/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(suppliedGoogleId)) {
  throw new Error("Invalid Google Web OAuth client ID format");
}
const googleWebClientId = flavor === "demo" ? "" : suppliedGoogleId;
const driveSecurity = { googleOAuthEnabled: googleWebClientId.length > 0 };

function runtimeAdapterPlugin(target: RuntimeTarget): Plugin {
  return createRuntimeAdapterPlugin(target, {
    root,
    pathApi: path,
    exists: existsSync,
    nodeBuiltinAdapters: NODE_BUILTIN_ADAPTERS,
    sharedCoreAdapters: SHARED_CORE_ADAPTERS,
  });
}

const PDF_FONTS_MODULE = "virtual:job-ranger-pdf-fonts";
const PDF_FONTS_DIRECTORY = "fonts";

/**
 * Resume PDF fonts for non-Windows-1252 text (scripts/pdf-fonts.mjs). The
 * manifest is compiled into the runtime worker; the font files are emitted
 * under fonts/ and loaded on demand (never precached), verified by SHA-256.
 */
function pdfFontsPlugin(emit: boolean): Plugin {
  let fonts: Awaited<ReturnType<typeof buildPdfFonts>> | null = null;
  const load = async () => (fonts ??= await buildPdfFonts());
  return {
    name: `job-ranger-pdf-fonts${emit ? "" : ":worker"}`,
    resolveId(source) {
      return source === PDF_FONTS_MODULE ? `\0${PDF_FONTS_MODULE}` : null;
    },
    async load(id) {
      if (id !== `\0${PDF_FONTS_MODULE}`) return null;
      const { manifest } = await load();
      const { schemaVersion, families, fonts: entries } = manifest;
      return `export default ${JSON.stringify({ schemaVersion, families, fonts: entries })};`;
    },
    configureServer(server) {
      server.middlewares.use(`/${PDF_FONTS_DIRECTORY}/`, async (request, response, next) => {
        const { directory, manifest } = await load();
        const name = decodeURIComponent((request.url ?? "").split("?")[0].replace(/^\//, ""));
        const known = manifest.fonts.some((font) => font.file === name) || manifest.licenses.some((license) => license.file === name);
        if (!known) return next();
        response.setHeader("Content-Type", name.endsWith(".ttf") ? "font/ttf" : "text/plain; charset=utf-8");
        response.end(readFileSync(path.join(directory, name)));
      });
    },
    async generateBundle() {
      if (!emit) return;
      const { directory, manifest } = await load();
      for (const file of [...manifest.fonts.map((font) => font.file), ...manifest.licenses.map((license) => license.file)]) {
        this.emitFile({ type: "asset", fileName: `${PDF_FONTS_DIRECTORY}/${file}`, source: readFileSync(path.join(directory, file)) });
      }
    },
  };
}

function listFiles(directory: string, base = directory): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    return statSync(full).isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join("/")];
  });
}

function headersFile(): string {
  const headers = buildSecurityHeaders(driveSecurity);
  const lines = ["/*", ...Object.entries(headers).map(([key, value]) => `  ${key}: ${value}`)];
  lines.push("", "/sw.js", "  Cache-Control: no-cache", "", "/index.html", "  Cache-Control: no-cache", "");
  lines.push("/assets/*", "  Cache-Control: public, max-age=31536000, immutable", "");
  lines.push(`/${PDF_FONTS_DIRECTORY}/*.ttf`, "  Cache-Control: public, max-age=31536000, immutable", "");
  return `${lines.join("\n")}\n`;
}

/** The demo flavor names itself as a demo in the document and the install manifest. */
function demoIndexHtml(html: string): string {
  const title = "<title>Sojourner: Employment Toolkit</title>";
  const description = /<meta name="description" content="[^"]*" \/>/;
  if (!html.includes(title) || !description.test(html)) throw new Error("demo flavor: index.html title/description markers changed");
  return html
    .replace(title, "<title>Sojourner Demo</title>")
    .replace(
      description,
      '<meta name="description" content="Sojourner demo: the real app with fictional sample data. Everything stays in this browser and resets when the browser session ends." />',
    );
}

function writeDemoManifest(): void {
  const manifestPath = path.join(outDir, "manifest.webmanifest");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        ...manifest,
        name: "Sojourner Demo",
        short_name: "Sojourner Demo",
        description:
          "Demonstration of the Sojourner Career Ops workspace with fictional sample data. Everything stays in this browser and resets when the browser session ends.",
      },
      null,
      2,
    )}
`,
  );
}

/** Demo flavor: never serve on the standard web app's local addresses (even with --port). */
function demoPortGuardPlugin(): Plugin {
  return {
    name: "job-ranger-demo-port-guard",
    configResolved(config) {
      if (config.command !== "serve") return;
      assertDemoPortAllowed(config.server.port);
      assertDemoPortAllowed(config.preview.port);
    },
  };
}

function shellManifestPlugin(): Plugin {
  return {
    name: "job-ranger-shell-manifest",
    apply: "build",
    transformIndexHtml(html) {
      const shell = html
        .replace("%JOB_RANGER_CSP%", buildContentSecurityPolicy(driveSecurity).replace(/; frame-ancestors 'none'/, ""))
        .replace("%JOB_RANGER_BUILD_ID%", buildId);
      return flavor === "demo" ? demoIndexHtml(shell) : shell;
    },
    closeBundle() {
      if (flavor === "demo") writeDemoManifest();
      const files = listFiles(outDir).filter(
        (file) =>
          !file.endsWith(".map") &&
          !file.startsWith(`${PDF_FONTS_DIRECTORY}/`) &&
          !["sw.js", "_headers", "build-info.json", "studio-handoff.json"].includes(file),
      );
      const fontFiles = listFiles(path.join(outDir, PDF_FONTS_DIRECTORY))
        .filter((file) => file.endsWith(".ttf"))
        .sort()
        .map((file) => ({
          path: `${PDF_FONTS_DIRECTORY}/${file}`,
          sha256: createHash("sha256").update(readFileSync(path.join(outDir, PDF_FONTS_DIRECTORY, file))).digest("hex"),
        }));
      const assets = files.sort().map((file) => ({
        path: file,
        sha256: createHash("sha256").update(readFileSync(path.join(outDir, file))).digest("hex"),
      }));
      const template = readFileSync(path.join(root, "src", "pwa", "service-worker.template.js"), "utf8");
      writeFileSync(
        path.join(outDir, "sw.js"),
        template
          .replace("__JOB_RANGER_BUILD_ID__", buildId)
          .replace("__JOB_RANGER_PRECACHE__", JSON.stringify(assets, null, 2))
          .replace("__JOB_RANGER_ON_DEMAND__", JSON.stringify(fontFiles)),
      );
      writeFileSync(path.join(outDir, "_headers"), headersFile());
      writeFileSync(
        path.join(outDir, "build-info.json"),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            product: "job-ranger-web",
            version: packageJson.version,
            buildId,
            flavor,
            commit,
            sourceRepository: process.env.GITHUB_REPOSITORY ?? "MythologIQ-Labs-LLC/job-ranger",
            workflowRun: process.env.GITHUB_RUN_ID ?? null,
            contentSecurityPolicy: buildContentSecurityPolicy(driveSecurity),
            // Exact deployed service-worker bytes are pinned independently of the
            // immutable precache list; the worker itself is intentionally not precached.
            serviceWorkerSha256: createHash("sha256")
              .update(readFileSync(path.join(outDir, "sw.js")))
              .digest("hex"),
            assets,
            onDemandAssets: {
              purpose: "resume PDF fonts for text outside Windows-1252, loaded only when a resume needs them",
              count: fontFiles.length,
              files: fontFiles,
            },
          },
          null,
          2,
        )}\n`,
      );
      // A build-derived, non-authorizing contract for the Studio external link.
      // Excluded from the service-worker shell manifest to avoid a digest cycle.
      const buildInfo = JSON.parse(readFileSync(path.join(outDir, "build-info.json"), "utf8"));
      writeFileSync(
        path.join(outDir, "studio-handoff.json"),
        `${JSON.stringify(createStudioHandoff(buildInfo), null, 2)}\n`,
      );
    },
  };
}

export default defineConfig({
  root: path.join(root, "web"),
  publicDir: path.join(root, "public"),
  base: "./",
  plugins: [
    runtimeAdapterPlugin("page"),
    pdfFontsPlugin(true),
    react(),
    tailwindcss(),
    shellManifestPlugin(),
    ...(flavor === "demo" ? [demoPortGuardPlugin()] : []),
  ],
  resolve: {
    alias: { "@": path.resolve(root, "src") },
  },
  define: {
    __JOB_RANGER_VERSION__: JSON.stringify(packageJson.version),
    __JOB_RANGER_BUILD_ID__: JSON.stringify(buildId),
    __JOB_RANGER_PWA_FLAVOR__: JSON.stringify(flavor),
    __JOB_RANGER_GOOGLE_WEB_CLIENT_ID__: JSON.stringify(googleWebClientId),
  },
  worker: {
    format: "es",
    plugins: () => [runtimeAdapterPlugin("worker"), pdfFontsPlugin(false)],
  },
  optimizeDeps: {
    exclude: ["@sqlite.org/sqlite-wasm"],
  },
  build: {
    outDir,
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 4096,
  },
  server: {
    fs: { allow: [root] },
    port: 5174,
    strictPort: true,
    // The demo flavor replaces its origin's storage every session, so locally it never
    // shares an address (origin) with the standard web app's workspace.
    ...(flavor === "demo" ? { port: DEMO_LOCAL_PORTS.dev } : {}),
    headers: {
      ...buildSecurityHeaders(driveSecurity),
      // Vite's dev client needs inline/eval support; the production CSP is
      // enforced by the built index.html meta tag and the _headers file.
      "Content-Security-Policy": "",
    },
  },
  preview: {
    host: "localhost",
    port: 4174,
    strictPort: true,
    headers: buildSecurityHeaders(driveSecurity),
    ...(flavor === "demo" ? { port: DEMO_LOCAL_PORTS.preview } : {}),
  },
});
