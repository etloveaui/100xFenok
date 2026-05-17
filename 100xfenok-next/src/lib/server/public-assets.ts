import fs from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const PUBLIC_ROOT = path.join(process.cwd(), "public");

function normalizePublicPath(value: string): string | null {
  const pathname = value.split(/[?#]/, 1)[0]?.trim().replace(/^\/+/, "");
  if (!pathname || pathname.includes("\\")) return null;

  const absolutePath = path.resolve(PUBLIC_ROOT, pathname);
  if (
    absolutePath !== PUBLIC_ROOT &&
    !absolutePath.startsWith(`${PUBLIC_ROOT}${path.sep}`)
  ) {
    return null;
  }

  const relativePath = path.relative(PUBLIC_ROOT, absolutePath);
  if (!relativePath || relativePath.startsWith("..")) return null;
  return `/${relativePath.split(path.sep).join("/")}`;
}

async function fetchCloudflareAsset(
  publicPath: string,
  init?: RequestInit,
): Promise<Response | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    const assets = env.ASSETS;
    if (!assets) return null;
    return await assets.fetch(new URL(publicPath, "https://assets.local"), init);
  } catch {
    return null;
  }
}

export async function readPublicAssetText(value: string): Promise<string> {
  const publicPath = normalizePublicPath(value);
  if (!publicPath) {
    throw new Error(`INVALID_PUBLIC_ASSET_PATH:${value}`);
  }

  const absolutePath = path.join(PUBLIC_ROOT, publicPath.slice(1));
  try {
    return await readFile(absolutePath, "utf8");
  } catch (fsError) {
    const response = await fetchCloudflareAsset(publicPath);
    if (response?.ok) return await response.text();
    throw fsError;
  }
}

export async function publicAssetExists(value: string): Promise<boolean> {
  const publicPath = normalizePublicPath(value);
  if (!publicPath) return false;

  const absolutePath = path.join(PUBLIC_ROOT, publicPath.slice(1));
  try {
    if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
      return true;
    }
  } catch {
    // Fall through to ASSETS for runtimes without a public filesystem.
  }

  const head = await fetchCloudflareAsset(publicPath, { method: "HEAD" });
  if (head?.ok) return true;
  if (head && head.status !== 405 && head.status !== 501) return false;

  const response = await fetchCloudflareAsset(publicPath);
  if (!response?.ok) return false;
  await response.body?.cancel();
  return true;
}
