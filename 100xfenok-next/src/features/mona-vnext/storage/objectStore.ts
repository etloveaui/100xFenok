import path from "node:path";

type KvKeyLike = {
  name: string;
};

type KvNamespaceLike = {
  get: (key: string) => Promise<string | null>;
  put: (
    key: string,
    value: string,
    options?: { metadata?: Record<string, unknown> },
  ) => Promise<unknown>;
  list: (options?: { prefix?: string; limit?: number }) => Promise<{ keys: KvKeyLike[] }>;
};

export type MonaVnextPersistenceReadiness = {
  status: "READY" | "BLOCKED";
  backend: "node-fs" | "cloudflare-kv" | "cloudflare-kv-missing";
  missingBinding: string | null;
  detail: string;
};

type CloudflareBindingProbe = {
  isCloudflare: boolean;
  kv: KvNamespaceLike | null;
};

export type MonaVnextObjectEntry = {
  name: string;
  relPath: string;
  mtimeMs: number;
};

export type MonaVnextObjectStore = {
  backend: "node-fs" | "cloudflare-kv";
  readText: (relPath: string) => Promise<string | null>;
  writeText: (relPath: string, raw: string) => Promise<void>;
  listJson: (relDir: string) => Promise<MonaVnextObjectEntry[]>;
};

const MONA_VNEXT_KV_BINDING = "MONA_VNEXT_KV";

function isKvNamespace(value: unknown): value is KvNamespaceLike {
  return Boolean(value)
    && typeof value === "object"
    && typeof (value as { get?: unknown }).get === "function"
    && typeof (value as { put?: unknown }).put === "function"
    && typeof (value as { list?: unknown }).list === "function";
}

function toKvKey(relPath: string) {
  return relPath.split(path.sep).join("/");
}

async function probeCloudflareBinding(): Promise<CloudflareBindingProbe> {
  try {
    const mod = await import("@opennextjs/cloudflare");
    const { env } = await mod.getCloudflareContext({ async: true });
    const kv = (env as Record<string, unknown>)[MONA_VNEXT_KV_BINDING];
    return {
      isCloudflare: true,
      kv: isKvNamespace(kv) ? kv : null,
    };
  } catch {
    return { isCloudflare: false, kv: null };
  }
}

function createFilesystemStore(): MonaVnextObjectStore {
  return {
    backend: "node-fs",
    async readText(relPath) {
      const { readFile } = await import("node:fs/promises");
      try {
        return await readFile(path.join(/* turbopackIgnore: true */ process.cwd(), relPath), "utf8");
      } catch {
        return null;
      }
    },
    async writeText(relPath, raw) {
      const { mkdir, rename, writeFile } = await import("node:fs/promises");
      const filePath = path.join(/* turbopackIgnore: true */ process.cwd(), relPath);
      await mkdir(path.dirname(filePath), { recursive: true });
      const tmp = `${filePath}.tmp`;
      await writeFile(tmp, raw, "utf8");
      await rename(tmp, filePath);
    },
    async listJson(relDir) {
      const { readdir, stat } = await import("node:fs/promises");
      const dirPath = path.join(/* turbopackIgnore: true */ process.cwd(), relDir);
      const entries = await readdir(dirPath).catch(() => []);
      const result: MonaVnextObjectEntry[] = [];
      for (const name of entries.filter((item) => item.endsWith(".json"))) {
        const relPath = path.join(relDir, name);
        const filePath = path.join(/* turbopackIgnore: true */ process.cwd(), relPath);
        const fileStat = await stat(filePath).catch(() => null);
        if (!fileStat?.isFile()) continue;
        result.push({ name, relPath, mtimeMs: fileStat.mtimeMs });
      }
      return result;
    },
  };
}

function createKvStore(kv: KvNamespaceLike): MonaVnextObjectStore {
  return {
    backend: "cloudflare-kv",
    async readText(relPath) {
      return kv.get(toKvKey(relPath));
    },
    async writeText(relPath, raw) {
      await kv.put(toKvKey(relPath), raw, {
        metadata: { contentType: "application/json; charset=utf-8" },
      });
    },
    async listJson(relDir) {
      const prefix = `${toKvKey(relDir).replace(/\/+$/, "")}/`;
      const listed = await kv.list({ prefix, limit: 1000 });
      return listed.keys
        .filter((item) => item.name.endsWith(".json"))
        .map((item) => ({
          name: item.name.slice(prefix.length),
          relPath: item.name,
          mtimeMs: 0,
        }))
        .filter((item) => item.name && !item.name.includes("/"));
    },
  };
}

export async function getMonaVnextPersistenceReadiness(): Promise<MonaVnextPersistenceReadiness> {
  const cloudflare = await probeCloudflareBinding();
  if (cloudflare.isCloudflare) {
    if (cloudflare.kv) {
      return {
        status: "READY",
        backend: "cloudflare-kv",
        missingBinding: null,
        detail: `${MONA_VNEXT_KV_BINDING} binding ready`,
      };
    }
    return {
      status: "BLOCKED",
      backend: "cloudflare-kv-missing",
      missingBinding: MONA_VNEXT_KV_BINDING,
      detail: `${MONA_VNEXT_KV_BINDING} binding is required on Cloudflare deployments`,
    };
  }

  return {
    status: "READY",
    backend: "node-fs",
    missingBinding: null,
    detail: "local node filesystem persistence",
  };
}

export async function createMonaVnextObjectStore(): Promise<MonaVnextObjectStore> {
  const cloudflare = await probeCloudflareBinding();
  if (cloudflare.isCloudflare) {
    if (!cloudflare.kv) {
      throw new Error(`${MONA_VNEXT_KV_BINDING}_BINDING_MISSING`);
    }
    return createKvStore(cloudflare.kv);
  }
  return createFilesystemStore();
}
