// src/api.js
import { supabase } from "./supabaseClient.js";

/**
 * Upload unsynced logs to Supabase
 */
export async function postLogs(logs) {
  try {
    for (const log of logs) {
      console.group("🛰️ Uploading Log Entry");
      console.log("Payload being sent:", log);

      const { data, error, status, statusText } = await supabase
        .from("logs")
        .insert({
          timestamp: new Date(log.timestamp).toISOString(),
          device_id: log.deviceId,
          user_id: log.user_id,
          email: log.email,
          car: log.car,
          action: log.action,
          station: log.station,
          lat: log.lat,
          lon: log.lon,
          boarded_line: log.boarded_line || null,
          exited_line: log.exited_line || null,
          journey_id: log.journey_id || null,
        })
        .select();

      console.log("Supabase response:", JSON.stringify({ status, statusText, data, error }, null, 2));

      console.groupEnd();

      if (error) throw error;
    }

    return { ok: true };
  } catch (err) {
    console.error("❌ postLogs failed", err);
    return { ok: false, error: err };
  }
}

/**
 * Fetch recent logs from Supabase (for Summary tab)
 */
export async function fetchRecentLogs() {
  try {
    const { data, error, status, statusText } = await supabase
      .from("logs")
      .select(
        `
        id,
        timestamp,
        car,
        action,
        station,
        lat,
        lon,
        boarded_line,
        exited_line,
        journey_id,
        user_id,
        email
      `
      )
      .order("timestamp", { ascending: false })
      .limit(50);

    console.log("📥 Fetch logs response:", {
      status,
      statusText,
      error,
      count: data?.length,
    });

    if (error) throw error;

    return data || [];
  } catch (err) {
    console.error("❌ Fetch logs failed:", err);
    return [];
  }
}
