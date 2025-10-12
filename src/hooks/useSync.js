// src/hooks/useSync.js
import { useRef } from "react";
import { db, K } from "../db.js";
import { postLogs } from "../api.js";
import toast from "react-hot-toast";

export function useSync() {
  const isSyncingRef = useRef(false);

  /**
   * Sync pending logs from outbox to Supabase
   * @param {boolean} silent - If true, don't show toast notifications
   */
  async function syncNow(silent = false) {
    // Prevent concurrent syncs
    if (isSyncingRef.current) {
      console.log("⏸️ Sync already in progress, skipping...");
      return { success: false, reason: "already_syncing" };
    }

    // Check if there's anything to sync
    const pending = (await db.getItem(K.outbox)) || [];
    if (pending.length === 0) {
      if (!silent) {
        console.log("✅ Nothing to sync");
      }
      return { success: true, reason: "nothing_to_sync" };
    }

    // Start sync
    isSyncingRef.current = true;
    if (!silent) {
      toast("🔄 Syncing...");
    }

    try {
      const res = await postLogs(pending);
      
      if (res.ok) {
        // Clear outbox on success
        await db.setItem(K.outbox, []);
        
        if (!silent) {
          toast.success(`✅ Synced ${pending.length} log(s)!`);
        }
        
        console.log(`✅ Successfully synced ${pending.length} logs`);
        return { success: true, count: pending.length };
      } else {
        // Sync failed
        if (!silent) {
          toast.error("❌ Sync failed");
        }
        console.error("❌ Sync failed:", res.error);
        return { success: false, reason: "server_error", error: res.error };
      }
    } catch (err) {
      // Network or other error
      console.error("❌ Sync error:", err);
      if (!silent) {
        toast.error("⚠️ Sync failed - offline?");
      }
      return { success: false, reason: "network_error", error: err };
    } finally {
      // Always unlock, even if error
      isSyncingRef.current = false;
    }
  }

  /**
   * Check if currently syncing
   */
  function isSyncing() {
    return isSyncingRef.current;
  }

  return {
    syncNow,
    isSyncing,
  };
}