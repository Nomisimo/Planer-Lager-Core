// Gemeinsamer Build beider Apps (von Materialplaner/Productionplaner scripts/build.js aufgerufen).
// Ergebnis in <app>/dist-app/: index.html (Single-File, React-Oberfläche), main.cjs, preload.cjs.
// Alias @lager/* → ${LAGER_CORE_DIR:-core}/packages/*/src. React wird immer aus der App aufgelöst (nur eine Kopie).
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// NFA-09 / WEB: Browser-Ziele wie station-web (packages/station-web/build.js BROWSER_ZIELE)
const BROWSER_ZIELE = ["chrome109", "edge109", "firefox115", "safari15"];

/** App-Symbol als SVG (PWA-Manifest, Portal): Anfangsbuchstabe auf Akzentfarbe. */
function symbolSvg(titel, akzent) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="${akzent}"/>` +
    `<text x="256" y="336" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="280" font-weight="700" fill="#ffffff">${titel[0]}</text></svg>`;
}

/**
 * @param {{root: string, titel: string, akzent?: string, minify?: boolean, ziel?: "electron"|"web"}} opt
 */
async function baueApp(opt) {
  const root = opt.root;
  const esbuild = require(require.resolve("esbuild", { paths: [root, __dirname] }));
  const coreDir = path.resolve(root, process.env.LAGER_CORE_DIR || "core");
  if (!fs.existsSync(path.join(coreDir, "packages"))) throw new Error(`Core nicht gefunden unter ${coreDir}. Submodule holen (git submodule update --init) oder LAGER_CORE_DIR setzen.`);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const web = opt.ziel === "web";
  const out = path.join(root, web ? "dist-web" : "dist-app");
  if (web) fs.rmSync(out, { recursive: true, force: true });
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
    ...(web ? { target: BROWSER_ZIELE } : {}),
  });
  if (web) return baueWeb({ opt, root, out, coreDir, pkg, js: r.outputFiles[0].contents });
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

/**
 * WEB-14: Browser-Version nach dist-web/: index.html ohne Inline-Script, assets/app.<hash12>.js|css (dauerhaft cachebar),
 * manifest.webmanifest + Symbol (als App installierbar). Ausgeliefert vom Lager-Server unter /<app-id>/ (ARCHITEKTUR §10).
 */
function baueWeb({ opt, root, out, coreDir, pkg, js }) {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, "src", "app.json"), "utf8"));
  const akzent = opt.akzent || cfg.akzent || "#b3483f";
  const css = fs.readFileSync(path.join(coreDir, "packages", "ui", "src", "stil.css"));
  const h = (b) => crypto.createHash("sha256").update(b).digest("hex").slice(0, 12);
  const jsHash = h(js), cssHash = h(css);
  fs.mkdirSync(path.join(out, "assets"), { recursive: true });
  fs.writeFileSync(path.join(out, "assets", `app.${jsHash}.js`), js);
  fs.writeFileSync(path.join(out, "assets", `app.${cssHash}.css`), css);
  const symbol = symbolSvg(opt.titel, akzent);
  const symHash = h(symbol);
  fs.writeFileSync(path.join(out, "assets", `symbol.${symHash}.svg`), symbol);
  fs.writeFileSync(path.join(out, "manifest.webmanifest"), JSON.stringify({
    name: opt.titel, short_name: opt.titel, id: `/${cfg.id}/`, start_url: `/${cfg.id}/`, scope: `/${cfg.id}/`, display: "standalone",
    lang: "de", background_color: "#15191e", theme_color: akzent,
    icons: [{ src: `assets/symbol.${symHash}.svg`, sizes: "any", type: "image/svg+xml", purpose: "any" }],
  }, null, 2));
  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="lager-build" content="${pkg.version}+${jsHash}"><meta name="theme-color" content="${akzent}">` +
    `<link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="assets/symbol.${symHash}.svg" type="image/svg+xml">` +
    `<link rel="stylesheet" id="lp-stil" href="assets/app.${cssHash}.css"><title>${opt.titel}</title></head>` +
    `<body><div id="root"></div><script src="assets/app.${jsHash}.js"></script></body></html>`;
  fs.writeFileSync(path.join(out, "index.html"), html);
  fs.writeFileSync(path.join(out, "build.json"), JSON.stringify({ app: cfg.id, version: pkg.version, hash: jsHash, gebaut: new Date().toISOString() }));
  console.log(`Web-Build erfolgreich: dist-web/ (${Math.round(js.length / 1024)} KB, ${pkg.version}+${jsHash})`);
  return { version: pkg.version, hash: jsHash };
}

module.exports = { baueApp, BROWSER_ZIELE };
