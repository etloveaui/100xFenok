import type { Metadata } from "next";
import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import RouteEmbedFrame from "@/components/RouteEmbedFrame";
import {
  getSingleSearchParam,
  legacyPublicFileExists,
  sanitizeLegacyPath,
} from "@/lib/server/legacy-bridge";

export const metadata: Metadata = {
  title: "Travel Records",
  description: "여행 기록 목록",
};

type TravelPageProps = {
  searchParams?: Promise<{ path?: string | string[] }>;
};

function getTravelFiles(): string[] {
  const dir = path.join(process.cwd(), "public", "admin", "personal", "travel");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".html"))
    .sort();
}

export default async function TravelPage({ searchParams }: TravelPageProps) {
  const files = getTravelFiles();
  const params = searchParams ? await searchParams : {};
  const requestedPath = getSingleSearchParam(params.path);
  const safePath = sanitizeLegacyPath(requestedPath, {
    prefixes: ["admin/personal/travel/"],
  });

  if (files.length === 0) {
    return (
      <main className="container mx-auto px-4 py-5">
        <p className="text-sm text-slate-500">등록된 여행 기록이 없습니다.</p>
      </main>
    );
  }

  const singleFile = files.length === 1 ? files[0] : null;
  const selectedPath =
    safePath && legacyPublicFileExists(safePath)
      ? safePath
      : singleFile
        ? `admin/personal/travel/${singleFile}`
        : null;

  if (selectedPath) {
    const src = `/${selectedPath}`;
    const label = selectedPath
      .split("/")
      .at(-1)
      ?.replace(/\.html$/, "")
      .replaceAll("-", " ") ?? "travel";
    return <RouteEmbedFrame src={src} title={label} loading="eager" />;
  }

  return (
    <main className="container mx-auto px-4 py-5">
      <h1 className="text-2xl font-black text-slate-900">Travel Records</h1>
      <ul className="mt-4 space-y-2">
        {files.map((f) => {
          const slug = f.replace(/\.html$/, "");
          const label = slug.replaceAll("-", " ");
          return (
            <li key={slug}>
              <Link
                href={`/admin/personal/travel?path=${encodeURIComponent(
                  `admin/personal/travel/${f}`,
                )}`}
                className="block rounded-xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-800 transition hover:border-purple-400 hover:shadow-sm"
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
