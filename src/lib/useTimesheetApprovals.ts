// Count of holiday/vacation requests awaiting MY approval — across every board I manage
// (admin/owner), excluding my own requests. Drives the Timesheet nav badge (like chat/ITSM).
import { useEffect, useState } from "react";
import { loadBoards, canManage } from "./board";
import { holidayRequests } from "./timesheet";

export function useTimesheetApprovals(address: string | null): { total: number } {
  const [total, setTotal] = useState(0);
  useEffect(() => {
    if (!address) { setTotal(0); return; }
    const compute = () => {
      let n = 0;
      for (const b of loadBoards(address)) {
        if (!canManage(b.role)) continue;
        n += holidayRequests(b.id).filter((e) => e.author !== address && e.status === "submitted").length;
      }
      setTotal(n);
    };
    compute();
    const id = setInterval(compute, 20000);
    const onSync = () => compute();
    window.addEventListener("gtv-state-synced", onSync);
    return () => { clearInterval(id); window.removeEventListener("gtv-state-synced", onSync); };
  }, [address]);
  return { total };
}
