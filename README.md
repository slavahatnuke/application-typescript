# `application-typescript`

Small **ES module** loader that runs **TypeScript in the browser** without a bundler: it finds every **`<script type="application/typescript" src="…">`** (a **`src`** attribute is **required**; scripts without `src` are skipped), loads each URL, transpiles with the **`typescript`** package from **esm.sh**, rewrites module specifiers, then executes the result with **`import()`** on a **`blob:`** URL so the code runs as a **real ECMAScript module** (top-level `await` / `import` are valid). It does **not** perform type-checking; that stays a **dev-time** concern in your project (for example **`yarn typecheck`** / **`tsc --noEmit`**).

---

## When to use it

- You want **one or more `.ts` entry files** served as static assets next to your HTML pages (e.g. `index.html`).
- You are fine loading the **TypeScript compiler** from a CDN on first run (network + parse cost).
- You accept **CDN and same-origin trust** boundaries (see [Security](#security)).
- You are building a **small UI prototype** (on the order of **~10–15 components**): one HTML entry, many **`.ts` modules** wired with **relative imports**, optional **import map** pins when bare specifiers multiply, and **`yarn typecheck`** as the app grows (see [Small multi-component prototypes](#small-multi-component-prototypes)).

---

## Small multi-component prototypes

This setup is a good fit for **browser-only prototypes** where you want **real ES modules** and **TypeScript** without wiring a bundler first:

- **One** `application/typescript` **entry** (e.g. `src/main.ts`) and **many** supporting files (e.g. `src/components/Widget.ts`, `src/views/Settings.ts`). Use **relative** `import` / `export` between them; the runner transpiles each file and rewrites **`./`** / **`../`** specifiers to **blob URLs** so the graph loads like a normal module tree.
- **Preact + htm** scales the same way as in a bundled app: each “component” can be a **function** in its own module and composed from the entry (same pattern as **`hello.app.ts`** + **`hello.ts`**).
- Add or expand an **import map** when you depend on more **bare** packages (or pin versions); until then, **esm.sh** fallbacks often suffice for early exploration.
- Keep **`tsc --noEmit`** (and **`tsconfig.json` `include`**) aligned with the folders you add so the editor and CI stay honest.
- When you outgrow this (large bundle size, SSR, complex env, heavy CI), move the same sources into **Vite**, **esbuild**, or another bundler—the module structure you used here stays familiar.

---

## Hello World (Preact + htm)

Smallest setup: **`#app`**, a **`<script type="application/typescript" src="…">`** entry (root-relative **`/`** when the static site is served from the host root), then load the runner from **esm.sh** (see below). No **import map** is required: bare **`htm/preact/standalone`** is rewritten to **`https://esm.sh/htm/preact/standalone`**. Serve over HTTP (not `file://`).

**`index.html`** (demo files in this package repo):

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Hello — application-typescript</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="application/typescript" src="./hello.ts"></script>
    <script type="module" src="https://esm.sh/application-typescript@1.0.0"></script>
  </body>
</html>
```

Use **`./hello.ts`** when the HTML lives next to the entry file; use a **root-relative** path like **`/hello.ts`** only when the site is served from the **origin root**.

**`hello.ts`** (entry) + **`hello.app.ts`** (tiny component):

```typescript
// hello.ts
import { html, render } from "htm/preact/standalone";
import { HelloApp } from "./hello.app";

const root = document.getElementById("app");
if (root) {
  render(html`<${HelloApp} />`, root);
}
```

```typescript
// hello.app.ts
import { html } from "htm/preact/standalone";

export function HelloApp() {
  return html`<h1>Hello World</h1>`;
}
```

From this package checkout: **`npm install`**, **`npm run serve`** (runs **`npx -y serve . -l 5123 --no-port-switching`**), then open the server root (e.g. **`http://localhost:5123/`** for the demo **`index.html`**). Avoid **`file://`**.

---

## HTML setup

### 1. Import map (optional)

You can omit an import map: the runner rewrites **bare** specifiers in **your** transpiled blobs to **`https://esm.sh/<specifier>`** when there is no matching key in the page’s merged **`imports`**.

Add a **`<script type="importmap">`** in **`<head>`** when you want to **pin** URLs (e.g. specific **unpkg** or **npm CDN** builds) instead of whatever **esm.sh** resolves today. The runner merges every import map’s top-level **`"imports"`** (later maps override keys). **`scopes`** are not read.

Dependencies **inside** a loaded third-party module still use the **browser’s** normal resolution (import map applies to those URLs). If something breaks without a map, add pins for those bare specifiers too.

### 2. TypeScript entry marker

Use a non-executed script type the browser will **fetch as data** only when you also need discovery—here the runner **re-fetches** by URL, so the tag is mainly a **marker** and consistent ordering hook:

```html
<script type="application/typescript" src="/src/app.ts"></script>
```

`src` is resolved with **`new URL(src, location.href)`**, so **root-relative** paths like **`/src/app.ts`** work when the site is served from the **origin root**; use **`./src/app.ts`** under a **subpath**.

Only tags with a **`src`** attribute are processed (`script[type="application/typescript"][src]`). Scripts **without** `src` are ignored by the runner.

### 3. Runner (must be last among your app scripts)

```html
<script type="module" src="https://esm.sh/application-typescript@1.0.0"></script>
```

**Order:** every `application/typescript` **with `src`** should appear **before** the runner module so the DOM query sees them. If you use an import map, declare it before any module that needs it.

**Publish:** this package must exist on **npm** (or another registry **esm.sh** can resolve) before the URL above works. Until then, serve `application-typescript.js` from your own static host or install the package locally and point `src` at that file.

### 4. Serve over HTTP(S)

Use a static server (e.g. **`npm run serve`** → **`npx -y serve . -l 5123 --no-port-switching`**). **`file://`** will break `import`, fetch, and often CORS expectations.

---

## Execution model

`querySelectorAll` preserves **document order**. If there are **several** `application/typescript` markers (each with `src`), they run **one after another** in that order (each `import()` completes before the next starts).

For each matching script:

1. Resolve `src` against `location.href`.
2. **`fetch`** the text (no cache by default: `cache: "no-cache"`).
3. **`transpileModule`** (TypeScript) with roughly:
   - `target`: ES2022  
   - `module`: ESNext  
   - `lib`: ES2022, DOM, DOM.Iterable  
   - `skipLibCheck`, `isolatedModules`: true  
4. Rewrite **relative** imports (`./`, `../`) in the emitted JS to **blob URLs** of other transpiled `.ts` files (recursive load + cache).
5. Rewrite **bare** imports (`"lodash"`, `"@scope/pkg"`, …) to **absolute HTTPS URLs**: first exact match in merged import map `imports`, else `https://esm.sh/<specifier>`.
6. Wrap output in a **`Blob`**, `URL.createObjectURL`, **`import(blobUrl)`**.

Each source URL is cached to a single blob URL; parallel loads of the same module share one **in-flight** promise.

---

## Relative `.ts` imports

Emitted `from "./foo"` / `from "./foo.js"` is resolved to a **`.ts` URL** next to the importing file (directory of the current module URL + path + `.ts` when no extension). Those files go through the same pipeline. **Circular** relative graphs can **deadlock**; keep local imports acyclic.

---

## Bare imports

Browsers often **do not apply import maps** to modules whose URL is a **`blob:`**, so the runner **string-rewrites** bare specifiers in **your** transpiled output to real URLs: **exact match** in the merged page import map’s **`imports`**, else **`https://esm.sh/<specifier>`** (so an import map is **optional** for app-level bare imports). Add a map when you need **pinned** or **non–esm.sh** URLs, or when **nested** dependencies inside a loaded package need bare-specifier mapping.

---

## Errors and logging

Failures are reported with **`console.error`** using an **`[application-typescript]`** prefix. There is no UI error panel in the runner itself.

---

## Limitations (by design)

| Topic | Behavior |
|--------|----------|
| **Type-checking** | None at runtime; use `tsc` / IDE locally. |
| **Inline TS** | Not supported; only scripts with **`src="…"`** (see `SELECTOR` in the source). |
| **`import()`** with a **non-literal** specifier | Not rewritten. |
| **Import map `scopes`** | Ignored. |
| **Compiler version** | Pinned in the runner: `https://esm.sh/typescript@6.0.3` (change in source to upgrade). |
| **Privacy / supply chain** | Loads third-party JS from **esm.sh** (compiler) and from URLs you map or from **esm.sh** fallbacks. |

---

## Security

Treat every **fetched `.ts` URL** like executable code: **same-origin** or hosts you trust. The runner does not sandbox transpiled output. Do not point `src` at untrusted origins.

---

## Updating this document

When you change the runner (selectors, transpiler options, CDN URLs, logging), update **this README** in the same commit so behavior and docs stay aligned.

## npm / release

```bash
cd /path/to/application-typescript
npm version patch   # or minor/major
npm publish --access public
```

Bump the version segment in consumer `<script src="https://esm.sh/application-typescript@…">` tags when you publish a new release (match **`package.json`**).
