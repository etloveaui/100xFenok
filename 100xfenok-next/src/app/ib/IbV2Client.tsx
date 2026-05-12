"use client";

import IbHelperV2 from "@/components/ib/v2/IbHelperV2";

/**
 * V2 IB Helper — native React light theme port (B candidate: dual ticker
 * + Cash inset alert + profile bottom sheet). Mock data; live wiring to
 * the existing IB Helper hook deferred to BACKLOG.
 */
export default function IbV2Client() {
  return <IbHelperV2 />;
}
