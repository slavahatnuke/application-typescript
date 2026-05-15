# `application-typescript`

Run TypeScript in the browser without a bundler — add one `<script>` tag and serve static files.

---

## Quick Start

**`index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Hello</title>
  </head>
  <body>

    <!-- app container --> 
    <div id="app"></div>


    <!-- preact + htm application -->
    <script type="application/typescript" src="./hello.ts"></script>
    

    <!-- esm.sh application-typescript runner -->
    <script type="module" src="https://esm.sh/application-typescript@1.0.0"></script>
  
  </body>
</html>
```

**`hello.ts`**

```typescript
import { html, render } from "htm/preact/standalone";
import { HelloApp } from "./hello.app";

const root = document.getElementById("app");
if (root) render(html`<${HelloApp} />`, root);
```

**`hello.app.ts`**

```typescript
import { html } from "htm/preact/standalone";

export function HelloApp() {
  return html`<h1>Hello World</h1>`;
}
```

Serve over HTTP (not `file://`), then open the page:

```bash
npx -y serve . -l 5123 --no-port-switching   # → http://localhost:5123/
```

That's it. No build step, no config file.

---

## When to use

Good fit:
- Small UI prototypes with 10–15 components
- Static pages where you want real TypeScript without wiring a bundler
- Exploring an idea quickly before committing to Vite / esbuild

Not a good fit:
- Production apps (CDN dependency, no tree-shaking, no SSR)
- Large codebases (compile-on-demand cost adds up)
- Environments that block CDN traffic (esm.sh required for the compiler)

When you outgrow this, move the same `.ts` sources into Vite or esbuild — the module structure carries over.

---

## Multi-file projects

Use relative imports between `.ts` files. The runner transpiles each file and rewrites `./` / `../` specifiers to blob URLs, so the full module graph loads correctly.

**`hello.ts`** (entry)

```typescript
import { html, render } from "htm/preact/standalone";
import { HelloApp } from "./hello.app";

const root = document.getElementById("app");
if (root) render(html`<${HelloApp} />`, root);
```

**`hello.app.ts`** (component)

```typescript
import { html } from "htm/preact/standalone";

export function HelloApp() {
  return html`<h1>Hello World</h1>`;
}
```

Keep imports acyclic.

---

## Setup reference

### Entry marker

```html
<script type="application/typescript" src="./src/app.ts"></script>
```

- `src` is required. Scripts without `src` are ignored.
- `src` is resolved with `new URL(src, location.href)`. Use `./src/app.ts` under a subpath, `/src/app.ts` at the origin root.
- Multiple markers are processed in document order, one after another.

### Runner

```html
<!-- esm.sh -->
<script type="module" src="https://esm.sh/application-typescript@1.0.0"></script>

<!-- or unpkg -->
<script type="module" src="https://unpkg.com/application-typescript"></script>
```

Must come **after** all `application/typescript` markers so the DOM query sees them.

### Import map (optional)

You can skip the import map entirely — bare specifiers like `"htm/preact/standalone"` fall back to `https://esm.sh/<specifier>` automatically.

Add an import map when you need to pin versions or use non-esm.sh URLs:

```html
<script type="importmap">
{
  "imports": {
    "preact": "https://esm.sh/preact@10.24.3",
    "htm/preact/standalone": "https://esm.sh/htm@3.1.1/preact/standalone"
  }
}
</script>
```

The runner merges all import maps on the page (later maps override keys). `scopes` are ignored.

### Serving

Use a static HTTP server. `file://` breaks `import`, `fetch`, and CORS.

```bash
npx -y serve . -l 5123 --no-port-switching
```

### Smoke test (bare imports)

This repo includes `test.html`, `test.ts`, and `test.app.ts`. `test.app.ts` imports `lodash/shuffle` so you can confirm bare specifiers resolve through esm.sh in the browser.

```bash
npm test
```

That runs `npx -y serve .` (default port, usually 3000, with automatic fallback). Open `/test.html` and check the page text and console.

---

## How it works

For each `<script type="application/typescript" src="…">`, the runner:

1. Resolves `src` against `location.href`
2. Fetches the source (`cache: "no-cache"`)
3. Transpiles with `typescript.transpileModule` (target ES2022, module ESNext, no type-checking)
4. Rewrites relative imports (`./`, `../`) to blob URLs of the transpiled dependency files (recursive, cached)
5. Rewrites bare imports to absolute URLs: import map match first, otherwise `https://esm.sh/<specifier>`
6. Creates a `Blob`, calls `URL.createObjectURL`, and `import()`s the result as a real ES module

Each source URL is cached to one blob URL. Parallel loads of the same module share one in-flight promise.

The TypeScript compiler itself is loaded from `https://esm.sh/typescript@6.0.3` on first run.

---

## Limitations

- **Type-checking** — none at runtime; use `tsc --noEmit` / your IDE
- **Inline `<script>` bodies** — not supported; `src` attribute is required
- **Dynamic `import()` with non-literal specifier** — not rewritten
- **Import map `scopes`** — ignored
- **Compiler version** — pinned to `typescript@6.0.3` in the runner source
- **CDN dependency** — requires network access to esm.sh on first load

---

## Security

Treat every fetched `.ts` URL as executable code. Only point `src` at same-origin files or hosts you fully trust. The runner does not sandbox transpiled output.

---

## Contributing

When changing the runner (selectors, transpiler options, CDN URLs, logging), update this README in the same commit.

### Release

```bash
npm version patch   # or minor / major
npm publish --access public
```

The unversioned `https://esm.sh/application-typescript@1.0.0` URL always resolves to the latest published release.
