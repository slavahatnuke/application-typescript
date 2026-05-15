import { html, render } from "htm/preact/standalone";
import { HelloApp } from "./hello.app";

const root = document.getElementById("app");
if (root) {
  render(html`<${HelloApp} />`, root);
}
