// src/api.js
import { supabase } from "./supabaseClient.js";

/**
 * Upload unsynced logs to Supabase with automatic deprecation of old versions
 */
export async function postLogs(logs) {
  try {
    for (const log of logs) {
      console.group("🛰️ Processing Log Entry");
      console.log("Payload:", log);

      // ✅ If this log has a new_id, it's a new version
      if (log.new_id) {
        // 1️⃣ First, deprecate any existing logs with same journey_id and action
        if (log.journey_id && log.action) {
          const { error: deprecateError } = await supabase
            .from("logs")
            .update({
              deprecated: true,
              replaced_by: log.new_id,
            })
            .eq("journey_id", log.journey_id)
            .eq("action", log.action)
            .or("deprecated.is.null,deprecated.eq.false");

          if (deprecateError) {
            console.error("⚠️ Failed to deprecate old logs:", deprecateError);
          } else {
            console.log(`🔄 Deprecated old ${log.action} logs for journey ${log.journey_id}`);
          }
        }

        // 2️⃣ Insert the NEW log entry
        const { data: newLogData, error: insertError } = await supabase
          .from("logs")
         // In postLogs function, when inserting logs, replace this section:
.insert({
  id: log.new_id,
  timestamp: new Date(log.timestamp).toISOString(),
  device_id: log.device_id,
  user_id: log.user_id,
  email: log.email || null,
  action: log.action,
  station: log.station,
  lat: log.lat,
  lon: log.lon,
  line: log.line || log.boarded_line || log.exited_line || null, // ✅ Use single line field
  car: log.car || null,
  journey_id: log.journey_id || null,
  deprecated: false,
  manual: log.manual || false,
})
          .select();

        if (insertError) {
          console.error("❌ Failed to insert new log:", insertError);
          throw insertError;
        }
        console.log("✅ New log inserted:", newLogData);
      } else {
        // Regular log insert (no editing involved)
        const { data: logData, error: logError } = await supabase
          .from("logs")
       .insert({
  timestamp: new Date(log.timestamp).toISOString(),
  device_id: log.device_id || log.deviceId,
  user_id: log.user_id,
  email: log.email || null,
  action: log.action,
  station: log.station,
  lat: log.lat,
  lon: log.lon,
  line: log.line || log.boarded_line || log.exited_line || null, // ✅ Use single line field
  car: log.car || null,
  journey_id: log.journey_id || null,
  deprecated: log.deprecated || false,
  deleted_at: log.deleted_at || null,
  manual: log.manual || false,
})
          .select();

        if (logError) throw logError;
        console.log("✅ Log inserted:", logData);
      }

      // 3️⃣ Update journeys table
      if (log.action === "on" && log.journey_id) {
        const { error: journeyInsertError } = await supabase
          .from("journeys")
          .upsert(
            {
              id: log.journey_id,
              user_id: log.user_id,
              start_station: log.station,
              start_time: log.timestamp,
              lines_used: [log.boarded_line || "pending"],
              complete: false,
            },
            { onConflict: "id" }
          );

        if (journeyInsertError) {
          console.error("⚠️ Journey upsert failed:", journeyInsertError);
        } else {
          console.log("🆕 Journey started/updated:", log.journey_id);
        }
      }

      if (log.action === "off" && log.journey_id) {
        const { error: journeyUpdateError } = await supabase
          .from("journeys")
          .update({
            end_station: log.station,
            end_time: log.timestamp,
            complete: true,
          })
          .eq("id", log.journey_id);

        if (journeyUpdateError) {
          console.error("⚠️ Journey update failed:", journeyUpdateError);
        } else {
          console.log("🏁 Journey completed:", log.journey_id);
        }
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
 * Only returns non-deprecated logs by default
 */
export async function fetchRecentLogs(includeDeprecated = false) {
  try {
    let query = supabase
      .from("logs")
      .select(
        `
        id,
        new_id,
        timestamp,
        action,
        station,
        lat,
        lon,
        boarded_line,
        exited_line,
        car,
        journey_id,
        user_id,
        email,
        deprecated,
        manual,
        replaced_by,
        deleted_at
      `
      )
      .order("timestamp", { ascending: false });

    // Filter out deprecated logs unless explicitly requested
    if (!includeDeprecated) {
      query = query.or("deprecated.is.null,deprecated.eq.false");
    }

    const { data, error, status, statusText } = await query.limit(50);

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

/**
 * Fetch full trip history from Supabase
 */
export async function fetchAllTrips(userId, includeDeprecated = false) {
  try {
    let query = supabase
      .from("logs")
      .select("*")
      .eq("user_id", userId)
      .order("timestamp", { ascending: false });

    if (!includeDeprecated) {
      query = query.or("deprecated.is.null,deprecated.eq.false");
    }

    const { data, error } = await query;

    if (error) {
      console.error("❌ Error fetching full history:", error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error("❌ fetchAllTrips failed:", err);
    return [];
  }
}