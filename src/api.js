// src/api.js
import { supabase } from "./supabaseClient.js";

// Ensure user exists or create them
export async function ensureUser(name) {
  if (!name) return null;

  // Check existing
  const { data: existing, error: fetchError } = await supabase
    .from("users")
    .select("id")
    .eq("name", name)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (existing) return existing.id;

  // Create new user
  const { data, error: insertError } = await supabase
    .from("users")
    .insert([{ name }])
    .select("id")
    .single();

  if (insertError) throw insertError;
  return data.id;
}

// Add logs
export async function postLogs(logs) {
  const { error } = await supabase.from("logs").insert(logs);
  if (error) throw error;
  return { ok: true };
}

// Fetch latest logs
export async function fetchRecentLogs() {
  const { data, error } = await supabase
    .from("logs")
    .select("id, timestamp, action, station, car, users ( name )")
    .order("timestamp", { ascending: false })
    .limit(20);

  if (error) throw error;
  return data.map((r) => ({
    id: r.id,
    timestamp: r.timestamp,
    action: r.action,
    station: r.station,
    car: r.car,
    user: r.users?.name,
  }));
}
