import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Minimal fail-closed mirror of feno_llm.resolver.resolve() (Python, mona-distill/chains.py).
// This does not shell out to Python and does not parse full YAML — it regex-extracts a
// `- id: <wire-id>` block whose `aliases: [...]` line contains the requested alias, matching
// the flat model-list shape used by shared-model-provider-registry.yaml. The registry lives in
// a sibling repo (claude-code-hub) that is not part of this app's deploy bundle, so this only
// ever resolves on a dev machine with that sibling repo checked out; any other environment
// (including the deployed Cloudflare Workers build) falls through to the pinned fallback.
const REGISTRY_RELATIVE_PARTS = [
  "claude-code-hub",
  "docs",
  "references",
  "shared-model-provider-registry.yaml",
];

function findRegistryPath(): string | null {
  const override = process.env.FENO_LLM_REGISTRY;
  if (override) {
    if (!existsSync(override)) throw new Error(`FENO_LLM_REGISTRY override not found: ${override}`);
    return override;
  }
  let dir = process.cwd();
  for (let i = 0; i < 12; i += 1) {
    const candidate = path.join(dir, ...REGISTRY_RELATIVE_PARTS);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function extractWireId(registryText: string, alias: string): string {
  const entryPattern = /-\s*id:\s*(\S+)[\s\S]*?\n\s*aliases:\s*\[([^\]]*)\]/g;
  let match: RegExpExecArray | null;
  while ((match = entryPattern.exec(registryText)) !== null) {
    const [, id, aliasList] = match;
    const aliases = aliasList.split(",").map((item) => item.trim());
    if (aliases.includes(alias)) return id;
  }
  throw new Error(`alias "${alias}" not declared on any model in the registry`);
}

/**
 * Resolve a registry alias to its current wire id. Registry-absent (the sibling repo is never
 * in the deploy bundle, so this is the NORMAL state on Cloudflare) → silent fallback; drift is
 * covered by the registry sync test instead. Registry present but unresolvable (alias missing,
 * read/parse error, bad override) → loud warning, then fallback.
 */
export function resolveModelId(alias: string, fallback: string): string {
  try {
    const registryPath = findRegistryPath();
    if (registryPath === null) return fallback;
    const text = readFileSync(registryPath, "utf8");
    return extractWireId(text, alias);
  } catch (error) {
    console.warn(
      `[model-registry-resolver] resolver failed for alias "${alias}"; using fallback "${fallback}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return fallback;
  }
}
