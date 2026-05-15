import { ok } from "./test.app";

const result = ok();
const root = document.getElementById("app");
if (root) {
  root.textContent = `Bare import OK — shuffle([1,2,3]) = [${result.join(", ")}] (see console too)`;
}
