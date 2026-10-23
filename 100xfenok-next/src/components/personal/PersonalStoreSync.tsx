"use client";

import { useEffect } from "react";
import { onAuthUserChange } from "@/lib/auth/clientAuth";
import { syncAccountStores } from "@/lib/personal/personalStore";

/** Hydrate the account cache on load and login without any sync dialog. */
export default function PersonalStoreSync() {
  useEffect(() => {
    const unsubscribe = onAuthUserChange(user => {
      if (user) void syncAccountStores();
    });
    void syncAccountStores();
    return unsubscribe;
  }, []);
  return null;
}
