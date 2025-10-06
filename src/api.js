import { supabase } from "./supabaseClient.js";

// 🚀 Save logs to Supabase
export async function postLogs(logs) {
  try {
    for (const log of logs) {
      const entry = {
        timestamp: new Date(log.timestamp).toISOString(),
        device_id: log.deviceId,
        user_id: log.user_id, // ✅ must be Supabase Auth UUID
        email: log.email || null,
        car: log.car || null,
        action: log.action,
        station: log.station,
        lat: log.lat,
        lon: log.lon,
        line: log.line || null,
      };

      const { error } = await supabase.from("logs").insert(entry);

     if (error) {
  console.error("❌ postLogs failed", JSON.stringify(error, null, 2));
  throw error;
}
    }

    return { ok: true };
  } catch (err) {
    console.error("❌ postLogs failed", err);
    return { ok: false, error: err };
  }
}

// 🧾 Fetch recent logs for user
export async function fetchRecentLogs() {
  try {
    const { data, error } = await supabase
      .from("logs")
      .select("*")
      .order("timestamp", { ascending: false })
      .limit(20);

    if (error) throw error;

    return data;
  } catch (err) {
    console.error("❌ Fetch logs failed:", err);
    return [];
  }
}

