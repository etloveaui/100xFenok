"use client";

import { useEffect } from "react";

/**
 * Marks the V1 chrome (Navbar/Footer, rendered outside the page's `.theme-c`
 * wrapper) for Theme C restyling by toggling a body class. CSS lives in
 * theme-c.css under `.theme-c-chrome`. V1 pages without this component keep
 * the original chrome untouched.
 */
export default function ThemeCChrome() {
  useEffect(() => {
    document.body.classList.add("theme-c-chrome");
    return () => {
      document.body.classList.remove("theme-c-chrome");
    };
  }, []);

  return null;
}
