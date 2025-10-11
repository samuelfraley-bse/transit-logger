// src/api.js
import { supabase } from "./supabaseClient.js";

/**
 * Upload unsynced logs to Supabase and maintain journeys table
 */
export async function postLogs(logs) {
  try {
    for (const log of logs) {
      console.group("🛰️ Uploading Log Entry");
      console.log("Payload being sent:", log);

      // 1️⃣ Insert the individual log entry into `logs` table
      const { data: logData, error: logError } = await supabase
        .from("logs")
        .insert({
          timestamp: new Date(log.timestamp).toISOString(),
          device_id: log.deviceId,
          user_id: log.user_id,
          email: log.email || null, // harmless even if column exists
          action: log.action,
          station: log.station,
          lat: log.lat,
          lon: log.lon,
          boarded_line: log.boarded_line || null,
          exited_line: log.exited_line || null,
          journey_id: log.journey_id || null,
          car: log.car || null
        })
        .select();

      if (logError) throw logError;
      console.log("✅ Log inserted:", logData);

      // 2️⃣ Maintain `journeys` table to reflect trip state
      if (log.action === "on") {
        // Create a new journey entry
        const { error: journeyInsertError } = await supabase
          .from("journeys")
          .insert([
            {
              id: log.journey_id,
              user_id: log.user_id,
              start_station: log.station,
              start_time: log.timestamp,
              lines_used: [log.boarded_line || "pending"], // <-- matches your table
              complete: false,
            },
          ]);

        if (journeyInsertError)
          console.error("⚠️ Journey insert failed:", journeyInsertError);
        else console.log("🆕 Journey started:", log.journey_id);
      }

      if (log.action === "off" && log.journey_id) {
        // Update the journey to mark it complete
        const { error: journeyUpdateError } = await supabase
          .from("journeys")
          .update({
            end_station: log.station,
            end_time: log.timestamp,
            complete: true,
          })
          .eq("id", log.journey_id);

        if (journeyUpdateError)
          console.error("⚠️ Journey update failed:", journeyUpdateError);
        else console.log("🏁 Journey completed:", log.journey_id);
      }

      console.groupEnd();
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
