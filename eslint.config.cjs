// ESLint (flat config). Nur Fehlerklassen, keine Stilregeln.
const js = (() => { try { return require("@eslint/js"); } catch { return null; } })();
const g = (names, v = "readonly") => Object.fromEntries(names.map((n) => [n, v]));
const NODE = g(["process", "console", "Buffer", "URL", "URLSearchParams", "setTimeout", "clearTimeout", "setInterval",
  "clearInterval", "setImmediate", "fetch", "AbortController", "TextEncoder", "TextDecoder", "structuredClone",
  "require", "module", "__dirname", "__filename", "queueMicrotask", "performance", "crypto", "Response", "Request", "Headers", "WebSocket", "FormData", "Blob"]);
const BROWSER = g(["window", "document", "localStorage", "sessionStorage", "navigator", "location", "indexedDB",
  "HTMLElement", "KeyboardEvent", "Event", "CustomEvent", "requestAnimationFrame", "getComputedStyle", "alert", "Audio", "AudioContext", "matchMedia", "history", "IDBKeyRange", "File", "FileReader"]);
module.exports = [
  { ignores: ["**/node_modules/**", "**/dist/**", "**/dist-app/**", "e2e/artefakte/**", "deploy/**"] },
  ...(js ? [js.configs.recommended] : []),
  {
    files: ["**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"],
    languageOptions: {
      ecmaVersion: 2024, sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...NODE, ...BROWSER },
    },
    rules: { "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_|^React$", caughtErrors: "none" }] },
  },
  { files: ["scripts/**/*.js", "**/*.cjs"], languageOptions: { sourceType: "commonjs" } },
];
