#!/usr/bin/env node
// Baut station-web (Arbeitsplatz-Web, Ladezonen-Anzeige) nach dist/: index.html + app.<hash>.js (UI-8 Versionskennung).
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HIER = path.dirname(fileURLToPath(import.meta.url));
const PKGS = path.join(HIER, "..");
const OUT = path.join(HIER, "dist");
// NFA-09: aktuelle Safari, Chrome, Firefox, Edge. esbuild bricht ab, wenn Code für diese Versionen nicht übersetzbar ist.
export const BROWSER_ZIELE = ["chrome109", "edge109", "firefox115", "safari15"];

export async function baueStationWeb({ minify = true } = {}) {
  const lagerAlias = { name: "lager-alias", setup(b) {
    b.onResolve({ filter: /^@lager\/[\w-]+(\/.*)?$/ }, (a) => {
      const [, name, rest] = /^@lager\/([\w-]+)(\/.*)?$/.exec(a.path);
      let p = path.join(PKGS, name, "src", rest || "index.js");
      if (!fs.existsSync(p)) for (const e of [".js", ".jsx"]) if (fs.existsSync(p + e)) { p += e; break; }
      return { path: p };
    });
  } };
  const r = await esbuild.build({ entryPoints: [path.join(HIER, "src", "index.jsx")], bundle: true, format: "iife", write: false, minify, target: BROWSER_ZIELE,
    loader: { ".js": "jsx", ".jsx": "jsx", ".css": "text" }, jsx: "transform", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [lagerAlias], logLevel: "warning" });
  const js = r.outputFiles[0].contents;
  const hash = crypto.createHash("sha256").update(js).digest("hex").slice(0, 12);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const datei = `app.${hash}.js`;
  fs.writeFileSync(path.join(OUT, datei), js);
  fs.writeFileSync(path.join(OUT, "index.html"), `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Lager-Arbeitsplatz</title></head><body><div id="root"></div><script src="/assets/${datei}"></script></body></html>`);
  return { datei, hash };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) baueStationWeb({ minify: !process.argv.includes("--dev") }).then((e) => console.log("station-web:", e.datei));
