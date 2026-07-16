import { expect, test } from "bun:test";
import { resolveToolFilePath } from "./tools";

test("file tools preserve absolute paths instead of doubling the home prefix", () => {
  expect(resolveToolFilePath("/Users/cass", "/Users/cass/.switchbay/example.txt")).toBe("/Users/cass/.switchbay/example.txt");
  expect(resolveToolFilePath("/tmp/work", "src/index.ts")).toBe("/tmp/work/src/index.ts");
});
