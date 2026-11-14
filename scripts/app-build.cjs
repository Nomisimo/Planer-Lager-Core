// Gemeinsamer Build beider Apps (von Materialplaner/Productionplaner scripts/build.js aufgerufen).
// Ergebnis in <app>/dist-app/: index.html (Single-File, React-Oberfläche), main.cjs, preload.cjs.
// Alias @lager/* → ${LAGER_CORE_DIR:-core}/packages/*/src. React wird immer aus der App aufgelöst (nur eine Kopie).
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/**
 * @param {{root: string, titel: string, akzent?: string, minify?: boolean}} opt
 */
async function baueApp(opt) {
  const root = opt.root;
  const esbuild = require(require.resolve("esbuild", { paths: [root, __dirname] }));
  const coreDir = path.resolve(root, process.env.LAGER_CORE_DIR || "core");
  if (!fs.existsSync(path.join(coreDir, "packages"))) throw new Error(`Core nicht gefunden unter ${coreDir}. Submodule holen (git submodule update --init) oder LAGER_CORE_DIR setzen.`);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const out = path.join(root, "dist-app");
  fs.mkdirSync(out, { recursive: true });

  const lagerAlias = {
    name: "lager-alias",
    setup(b) {
      b.onResolve({ filter: /^@lager\/[\w-]+(\/.*)?$/ }, (a) => {
        const [, name, rest] = /^@lager\/([\w-]+)(\/.*)?$/.exec(a.path);
        const basis = path.join(coreDir, "packages", name, "src");
        let p = rest ? path.join(basis, rest) : path.join(basis, "index.js");
        if (!fs.existsSync(p)) for (const ext of [".js", ".jsx"]) if (fs.existsSync(p + ext)) { p += ext; break; }
        return { path: p };
      });
    },
  };
  const appModul = (m) => path.dirname(require.resolve(m + "/package.json", { paths: [root] }));
  const alias = { react: appModul("react"), "react-dom": appModul("react-dom"), "lucide-react": appModul("lucide-react") };
  const version = pkg.version;
  const define = { "process.env.NODE_ENV": '"production"', __APP_VERSION__: JSON.stringify(version) };

  // 1) Renderer → index.html
  const r = await esbuild.build({
    entryPoints: [path.join(root, "src", "renderer", "index.jsx")], bundle: true, format: "iife", write: false,
    minify: !!opt.minify, loader: { ".jsx": "jsx", ".js": "jsx", ".svg": "text", ".css": "text" }, jsx: "transform",
    define, alias, plugins: [lagerAlias], logLevel: "warning", nodePaths: [path.join(root, "node_modules")],
  });
  const js = r.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  const hash = crypto.createHash("sha256").update(js).digest("hex").slice(0, 12);
  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' data: blob:; img-src 'self' data: blob: http: https:; connect-src 'self' ws: wss: http: https:; frame-src blob: data: http: https:">` +
    `<meta name="lager-build" content="${version}+${hash}">` +
    `<title>${opt.titel}</title></head><body><div id="root"></div><script>\n${js}</script></body></html>`;
  fs.writeFileSync(path.join(out, "index.html"), html);

  // 2) Hauptprozess → main.cjs (Einstieg src/main/main.js der App)
  await esbuild.build({
    entryPoints: [path.join(root, "src", "main", "main.js")], bundle: true, platform: "node", format: "cjs", target: "node20",
    outfile: path.join(out, "main.cjs"), external: ["electron"], define: { __APP_VERSION__: JSON.stringify(version) },
    plugins: [lagerAlias], logLevel: "warning", minify: !!opt.minify,
  });
  // 3) Preload unverändert kopieren
  fs.copyFileSync(path.join(coreDir, "packages", "shell", "src", "preload.cjs"), path.join(out, "preload.cjs"));
  fs.writeFileSync(path.join(out, "build.json"), JSON.stringify({ version, hash, gebaut: new Date().toISOString() }));
  console.log(`Build erfolgreich: dist-app/index.html (${Math.round(html.length / 1024)} KB, ${version}+${hash})`);
  return { version, hash };
}

module.exports = { baueApp };
