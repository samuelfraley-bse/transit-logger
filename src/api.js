import { supabase } from "./supabaseClient.js";

export async function postLogs(logs) {
  try {
    for (const log of logs) {
      // Step 1: Ensure user exists
      const { data: existing, error: existingErr } = await supabase
        .from("users")
        .select("id")
        .eq("name", log.user)
        .maybeSingle();

      if (existingErr) throw existingErr;

      let userId = existing?.id;
      if (!userId) {
        const { data: inserted, error: insertErr } = await supabase
          .from("users")
          .insert({ name: log.user })
          .select()
          .single();
        if (insertErr) throw insertErr;
        userId = inserted.id;
      }

      // Step 2: Insert log row
      const { error: logErr } = await supabase.from("logs").insert({
        timestamp: new Date(log.timestamp).toISOString(),
        device_id: log.deviceId,
        user_id: userId,
        car: log.car,
        action: log.action,
        station: log.station,
        lat: log.lat,
        lon: log.lon,
      });

      if (logErr) throw logErr;
    }

    return { ok: true };
  } catch (err) {
    console.error("❌ postLogs failed", err);
    return { ok: false, error: err };
  }
}

export async function fetchRecentLogs() {
  const { data, error } = await supabase
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
      users ( name )
    `
    )
    .order("timestamp", { ascending: false })
    .limit(10);

  if (error) {
    console.error("Fetch logs failed:", error);
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    user: row.users?.name || "-",
    car: row.car,
    action: row.action,
    station: row.station,
  }));
}
