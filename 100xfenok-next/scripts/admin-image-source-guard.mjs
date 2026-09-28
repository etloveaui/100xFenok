// OpenNext handles /_next/image before Next middleware and may read local
// sources directly from ASSETS. Keep protected admin sources out of that path.

function normalizedLocalSourcePath(source, origin) {
  let sourceUrl;
  try {
    sourceUrl = new URL(source, origin);
  } catch {
    return null;
  }
  // OpenNext selects ASSETS from the raw leading slash, before URL parsing.
  // A slash/backslash host alias can parse to another origin while still
  // reading this binding's local asset namespace.
  if (!source.startsWith("/") && sourceUrl.origin !== origin) return null;

  let pathname;
  try {
    // URLSearchParams has already decoded the query once. ASSETS resolves a
    // local path after one further percent decode, including encoded slashes.
    pathname = decodeURIComponent(sourceUrl.pathname).replaceAll("\\", "/");
  } catch {
    return null;
  }

  const segments = [];
  for (const segment of pathname.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

export function isProtectedAdminImageRequest(requestUrl) {
  if (requestUrl.pathname !== "/_next/image" && requestUrl.pathname !== "/_next/image/") {
    return false;
  }
  return requestUrl.searchParams.getAll("url").some((source) => {
    const pathname = normalizedLocalSourcePath(source, requestUrl.origin);
    return pathname === "/admin" || pathname?.startsWith("/admin/");
  });
}
