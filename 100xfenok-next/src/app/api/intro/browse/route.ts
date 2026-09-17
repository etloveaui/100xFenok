import { NextResponse } from "next/server";
import {
  createBrowseCookieHeader,
  isValidNextPath,
} from "@/lib/server/closed-site";
import { ROUTES } from "@/lib/routes";

export const dynamic = "force-dynamic";
export const revalidate = false;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const nextParam = url.searchParams.get("next");
  const targetPath =
    nextParam && isValidNextPath(nextParam) ? nextParam : ROUTES.home;

  const targetUrl = new URL(targetPath, url.origin);
  const response = NextResponse.redirect(targetUrl, 302);
  response.headers.set("Set-Cookie", createBrowseCookieHeader());
  response.headers.set("Cache-Control", "no-store");
  return response;
}
