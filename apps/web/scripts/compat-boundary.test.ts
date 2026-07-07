import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = resolve(fileURLToPath(new URL("../src", import.meta.url)));
const allowedCompatAdapters = new Set(["api/client.ts"]);
const compatPattern = /VITE_COMPAT_API_BASE|\/compat|\bcompatRequest\b/i;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = resolve(directory, entry);
    if (statSync(fullPath).isDirectory()) return sourceFiles(fullPath);
    return /\.(ts|tsx)$/.test(entry) ? [fullPath] : [];
  });
}

const violations = sourceFiles(sourceRoot).filter((file) => {
  const relativePath = relative(sourceRoot, file).split(sep).join("/");
  if (allowedCompatAdapters.has(relativePath)) return false;
  return compatPattern.test(readFileSync(file, "utf8"));
});

if (violations.length) {
  throw new Error(`Compat API usage is only allowed in apps/web/src/api/client.ts:\n${violations.join("\n")}`);
}
