/**
 * In-browser TypeScript runner: finds every
 *   <script type="application/typescript" src="./path.ts"></script>
 * (`src` is required — inline body without `src` is ignored). Fetches each URL,
 * transpiles with the `typescript` package from esm.sh, then `import()` a blob URL
 * so the result is a real ES module (top-level `import` works; no eval).
 *
 * Relative imports like `import { x } from "./foo"` work: each file is transpiled
 * separately and specifiers are rewritten to blob URLs (import base is otherwise
 * the blob, so `./foo` would not resolve). Circular relative imports can deadlock.
 *
 * Bare specifiers (`import from "lodash"`) are rewritten to absolute URLs: first
 * match against merged top-level `imports` from every `<script type="importmap">`,
 * otherwise `https://esm.sh/<specifier>`. (Blob modules often ignore import maps;
 * rewriting makes bare imports reliable.) Scoped packages and subpaths work on
 * esm.sh, e.g. `lodash/debounce`.
 */
import ts from "https://esm.sh/typescript@6.0.3";

(async function () {
    const SELECTOR = 'script[type="application/typescript"][src]';

    /** @type {Record<string, string> | null} */
    let cachedImportsMap = null;

    /** @type {Map<string, string>} */
    const blobUrlByTsUrl = new Map();
    /** @type {Map<string, Promise<string>>} */
    const inflightBlobUrl = new Map();

    function showError(msg, cause) {
        if (cause !== undefined) {
            console.error("[application-typescript]", msg, cause);
        } else {
            console.error("[application-typescript]", msg);
        }
    }

    function getTs() {
        return ts?.default ?? ts;
    }

    async function transpileModuleSource(fileName, sourceText) {
        const t = getTs();
        const { outputText } = t.transpileModule(sourceText, {
            compilerOptions: {
                target: t.ScriptTarget.ES2022,
                module: t.ModuleKind.ESNext,
                lib: ["ES2022", "DOM", "DOM.Iterable"],
                skipLibCheck: true,
                isolatedModules: true,
            },
            fileName,
        });
        return outputText;
    }

    /**
     * Resolve a relative module specifier to an absolute .ts URL (same-origin fetch).
     * @param {string} containingTsUrl absolute URL of the current module
     * @param {string} specifier e.g. ./ok ./ok.js ../lib/x
     */
    function resolveTsDependencyUrl(containingTsUrl, specifier) {
        const baseDir = new URL(".", containingTsUrl);
        let spec = specifier;
        if (spec.endsWith(".js")) spec = spec.slice(0, -3);
        if (spec.endsWith(".jsx")) spec = spec.slice(0, -4);
        const u = new URL(spec, baseDir);
        if (!/(?:\.[cm]?ts|\.tsx)$/.test(u.pathname)) {
            u.pathname = u.pathname.endsWith("/") ? `${u.pathname}index.ts` : `${u.pathname}.ts`;
        }
        return u.href;
    }

    /**
     * Collect relative specifiers as they appear in emitted JS (./ ../ only).
     * @param {string} js
     */
    function collectRelativeSpecifiersInJs(js) {
        const specs = new Set();
        const fromRe = /\bfrom\s*["'](\.\.?\/[^"']+)["']/g;
        const dynRe = /\bimport\s*\(\s*["'](\.\.?\/[^"']+)["']\s*\)/g;
        for (const re of [fromRe, dynRe]) {
            for (const m of js.matchAll(re)) {
                specs.add(m[1]);
            }
        }
        return [...specs];
    }

    /**
     * Merge `imports` from all import map scripts (later maps override keys).
     * Only top-level `imports` is used (not `scopes`).
     */
    function mergeDocumentImportMaps() {
        /** @type {Record<string, string>} */
        const out = {};
        for (const el of document.querySelectorAll('script[type="importmap"]')) {
            try {
                const j = JSON.parse(el.textContent || "{}");
                if (j.imports && typeof j.imports === "object") {
                    Object.assign(out, j.imports);
                }
            } catch (e) {
                console.warn("[application-typescript] skipped invalid importmap", e);
            }
        }
        return out;
    }

    function getImportsMap() {
        if (!cachedImportsMap) cachedImportsMap = mergeDocumentImportMaps();
        return cachedImportsMap;
    }

    /**
     * @param {string} spec
     */
    function isBareModuleSpecifier(spec) {
        if (!spec || typeof spec !== "string") return false;
        if (spec.startsWith(".") || spec.startsWith("/")) return false;
        if (/^(https?:|data:|blob:)/i.test(spec)) return false;
        return true;
    }

    /**
     * Collect bare specifiers in emitted JS (not ./ ../ not URLs).
     * @param {string} js
     */
    function collectBareSpecifiersInJs(js) {
        const specs = new Set();
        const fromRe = /\bfrom\s*["']([^"']+)["']/g;
        const dynRe = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
        for (const m of js.matchAll(fromRe)) {
            if (isBareModuleSpecifier(m[1])) specs.add(m[1]);
        }
        for (const m of js.matchAll(dynRe)) {
            if (isBareModuleSpecifier(m[1])) specs.add(m[1]);
        }
        return [...specs];
    }

    /**
     * @param {string} spec bare specifier, e.g. lodash or @scope/pkg
     * @param {Record<string, string>} importsMap
     */
    function resolveBareModuleSpecifier(spec, importsMap) {
        const mapped = importsMap[spec];
        if (mapped) {
            try {
                return new URL(mapped, location.href).href;
            } catch {
                return mapped;
            }
        }
        return `https://esm.sh/${spec}`;
    }

    /**
     * @param {string} js
     * @param {string} fromSpec specifier as in source/emitted string
     * @param {string} toBlobUrl
     */
    function rewriteSpecifier(js, fromSpec, toBlobUrl) {
        const esc = fromSpec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const to = JSON.stringify(toBlobUrl);
        let out = js.replace(
            new RegExp(`(\\bfrom\\s*)["']${esc}["']`, "g"),
            `$1${to}`,
        );
        out = out.replace(
            new RegExp(`(\\bimport\\s*\\(\\s*)["']${esc}["']`, "g"),
            `$1${to}`,
        );
        return out;
    }

    /**
     * Transpile a TypeScript module and its relative dependency tree; return a blob URL.
     * @param {string} resolvedTsUrl
     */
    async function getBlobUrlForTsModule(resolvedTsUrl) {
        const cached = blobUrlByTsUrl.get(resolvedTsUrl);
        if (cached) return cached;

        const pending = inflightBlobUrl.get(resolvedTsUrl);
        if (pending) return pending;

        const p = (async () => {
            const res = await fetch(resolvedTsUrl, { cache: "no-cache" });
            if (!res.ok) {
                throw new Error(`${resolvedTsUrl}: HTTP ${res.status}`);
            }
            const source = await res.text();
            let js = await transpileModuleSource(resolvedTsUrl, source);

            const relSpecs = collectRelativeSpecifiersInJs(js).sort(
                (a, b) => b.length - a.length,
            );

            for (const spec of relSpecs) {
                const depTsUrl = resolveTsDependencyUrl(resolvedTsUrl, spec);
                const depBlob = await getBlobUrlForTsModule(depTsUrl);
                js = rewriteSpecifier(js, spec, depBlob);
            }

            const importsMap = getImportsMap();
            const bareSpecs = collectBareSpecifiersInJs(js).sort(
                (a, b) => b.length - a.length,
            );
            for (const spec of bareSpecs) {
                const url = resolveBareModuleSpecifier(spec, importsMap);
                js = rewriteSpecifier(js, spec, url);
            }

            const label = resolvedTsUrl.replace(/\n/g, " ");
            const blob = new Blob([`${js}\n//# sourceURL=${label}\n`], {
                type: "text/javascript",
            });
            const blobUrl = URL.createObjectURL(blob);
            blobUrlByTsUrl.set(resolvedTsUrl, blobUrl);
            return blobUrl;
        })();

        inflightBlobUrl.set(resolvedTsUrl, p);
        try {
            return await p;
        } finally {
            inflightBlobUrl.delete(resolvedTsUrl);
        }
    }

    async function runOneScript(el) {
        const src = el.getAttribute("src");
        if (!src) return;
        const resolved = new URL(src, location.href).href;
        const entryBlobUrl = await getBlobUrlForTsModule(resolved);
        await import(entryBlobUrl);
    }

    const scripts = [...document.querySelectorAll(SELECTOR)];
    if (scripts.length === 0) {
        showError(
            `No matching scripts. Add e.g. <script type="application/typescript" src="/src/app.ts"></script> before the <script type="module"> that loads this runner (from esm.sh or your host).`,
        );
    } else {
        for (const el of scripts) {
            try {
                await runOneScript(el);
            } catch (e) {
                showError(
                    `TypeScript runner: ${e instanceof Error ? e.message : String(e)}`,
                    e,
                );
                break;
            }
        }
    }
})().catch(console.error);
