/**
 * Build for the Job Ranger web/PWA runtime (output: dist-pwa/).
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
import { createRuntimeAdapterPlugin, type RuntimeTarget } from "./src/pwa/build/runtime-adapter-plugin.ts";

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(root, "dist-pwa");
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
const buildId = process.env.JOB_RANGER_BUILD_ID?.trim() || `${packageJson.version}+${commit.slice(0, 12)}`;

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
  const headers = buildSecurityHeaders();
  const lines = ["/*", ...Object.entries(headers).map(([key, value]) => `  ${key}: ${value}`)];
  lines.push("", "/sw.js", "  Cache-Control: no-cache", "", "/index.html", "  Cache-Control: no-cache", "", "/build-info.json", "  Cache-Control: no-cache", "", "/manifest.webmanifest", "  Cache-Control: no-cache", "  Content-Type: application/manifest+json", "");
  lines.push("/assets/*", "  Cache-Control: public, max-age=31536000, immutable", "");
  lines.push(`/${PDF_FONTS_DIRECTORY}/*.ttf`, "  Cache-Control: public, max-age=31536000, immutable", "");
  return `${lines.join("\n")}\n`;
}

function shellManifestPlugin(): Plugin {
  return {
    name: "job-ranger-shell-manifest",
    apply: "build",
    transformIndexHtml(html) {
      return html
        .replace("%JOB_RANGER_CSP%", buildContentSecurityPolicy().replace(/; frame-ancestors 'none'/, ""))
        .replace("%JOB_RANGER_BUILD_ID%", buildId);
    },
    closeBundle() {
      const files = listFiles(outDir).filter(
        (file) =>
          !file.endsWith(".map") &&
          !file.startsWith(`${PDF_FONTS_DIRECTORY}/`) &&
          !["sw.js", "_headers", "build-info.json"].includes(file),
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
            commit,
            sourceRepository: process.env.GITHUB_REPOSITORY ?? "MythologIQ-Labs-LLC/job-ranger",
            workflowRun: process.env.GITHUB_RUN_ID ?? null,
            contentSecurityPolicy: buildContentSecurityPolicy(),
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
    },
  };
}

export default defineConfig({
  root: path.join(root, "web"),
  publicDir: path.join(root, "public"),
  base: "./",
  plugins: [runtimeAdapterPlugin("page"), pdfFontsPlugin(true), react(), tailwindcss(), shellManifestPlugin()],
  resolve: {
    alias: { "@": path.resolve(root, "src") },
  },
  define: {
    __JOB_RANGER_VERSION__: JSON.stringify(packageJson.version),
    __JOB_RANGER_BUILD_ID__: JSON.stringify(buildId),
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
    headers: {
      ...buildSecurityHeaders(),
      // Vite's dev client needs inline/eval support; the production CSP is
      // enforced by the built index.html meta tag and the _headers file.
      "Content-Security-Policy": "",
    },
  },
  preview: {
    host: "localhost",
    port: 4174,
    strictPort: true,
    headers: buildSecurityHeaders(),
  },
});
