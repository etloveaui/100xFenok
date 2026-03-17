"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ComponentProps, startTransition, useCallback } from "react";

interface ViewTransition {
  finished: Promise<void>;
  ready: Promise<void>;
  skipTransition: () => void;
}

type TransitionLinkProps = ComponentProps<typeof Link>;

function hrefToString(href: TransitionLinkProps["href"]): string {
  if (typeof href === "string") return href;
  const { pathname = "/", search, hash } = href;
  return `${pathname}${search ?? ""}${hash ?? ""}`;
}

export default function TransitionLink({
  href,
  onClick,
  ...props
}: TransitionLinkProps) {
  const router = useRouter();

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (onClick) onClick(e);
      if (e.defaultPrevented) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;

      const supportsVT =
        typeof document !== "undefined" && "startViewTransition" in document;
      if (!supportsVT) return;

      const url = hrefToString(href);

      // Only intercept internal paths
      if (url.startsWith("http")) return;

      e.preventDefault();

      try {
        const transition = (
          document as Document & {
            startViewTransition: (
              cb: () => Promise<void>,
            ) => ViewTransition;
          }
        ).startViewTransition(() => {
          return new Promise<void>((resolve) => {
            startTransition(() => {
              router.push(url);
              resolve();
            });
          });
        });

        transition.finished.catch(() => {
          // View transition failed — navigation already pushed, no action needed
        });
      } catch {
        // startViewTransition threw — fall back to normal navigation
        router.push(url);
      }
    },
    [href, onClick, router],
  );

  return <Link href={href} onClick={handleClick} {...props} />;
}
