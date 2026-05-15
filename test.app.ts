import shuffle from "lodash/shuffle";

export function ok(): number[] {
  const result = shuffle([1, 2, 3]);
  console.log("ok", result);
  return result;
}
