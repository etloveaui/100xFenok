"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { getDesignVersionFromQuery } from "@/lib/design/version";

/**
 * Mounts as a side-effect-only client component. Reads the `?v2=1` query
 * param (or NEXT_PUBLIC_DESIGN_V2 env override) and toggles
 * `body.design-v2`. The body class drives CSS rules that hide V1 chrome
 * wrappers on routes that still support the legacy v2-v4 backdoors.
 */
export default function DesignVersionToggle() {
  const searchParams = useSearchParams();
  const version = getDesignVersionFromQuery(searchParams);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const body = document.body;
    body.classList.remove("design-v2", "design-v3", "design-v4");
    if (version === "v2") body.classList.add("design-v2");
    if (version === "v3") body.classList.add("design-v3");
    if (version === "v4") body.classList.add("design-v4");
  }, [version]);

  return null;
}
