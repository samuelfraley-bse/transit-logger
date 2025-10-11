import { supabase } from "../supabaseClient.js";
import toast from "react-hot-toast";

// --- Record change history ---
export async function recordTripHistory(tripId, userId, action, oldData, newData) {
  try {
    const { error } = await supabase.from("trip_history").insert({
      trip_id: tripId,
      user_id: userId,
      action,
      old_data: oldData || null,
      new_data: newData || null,
    });

    if (error) console.error("❌ recordTripHistory error:", error);
  } catch (err) {
    console.error("💥 recordTripHistory failed:", err);
  }
}

// --- Normalize a trip record ---
function normalizeTrip(trip, userId) {
  return {
    timestamp: trip.timestamp || new Date().toISOString(),
    device_id: trip.device_id || trip.deviceId || null,
    user_id: userId,
    car: trip.car || null,
    action: trip.action || "manual",
    station: trip.station || trip.station_from || null,
    lat: trip.lat || null,
    lon: trip.lon || null,
    line: trip.line || trip.boarded_line || trip.exited_line || null,
    email: trip.email || null,
    boarded_line: trip.boarded_line || null,
    exited_line: trip.exited_line || null,
    journey_id: trip.journey_id,
    new_id: trip.new_id || crypto.randomUUID(),
    deleted_at: trip.deleted_at || null,
  };
}

// --- Save a new trip to Supabase (live or manual logging) ---
export async function saveLiveTripToSupabase(trip, userId) {
  console.log("🚀 saveLiveTripToSupabase called with:", trip);

  try {
    const record = normalizeTrip(trip, userId);

    // Ensure required fields
    if (!record.device_id || !record.user_id || !record.journey_id) {
      console.error("⚠️ Missing required fields in trip:", record);
      toast.error("Missing required fields — not saved");
      return null;
    }

    console.log("🌿 Supabase insert payload:", record);

    const { data, error } = await supabase
      .from("logs")
      .insert([record])
      .select();

    if (error) {
      console.error("❌ Supabase insert error:", error);
      toast.error("Failed to save trip to Supabase");
      return null;
    }

    console.log("✅ Trip inserted successfully:", data);
    toast.success("Trip saved to cloud!");
    return data;
  } catch (err) {
    console.error("💥 Unexpected saveLiveTripToSupabase error:", err);
  }
}

// --- Soft delete a trip ---
export async function softDeleteTripInSupabase(journeyId, userId) {
  try {
    console.log("🗑️ Soft-deleting trip:", journeyId);

    const { data: oldTrips } = await supabase
      .from("logs")
      .select("*")
      .eq("journey_id", journeyId)
      .eq("user_id", userId);

    const { error } = await supabase
      .from("logs")
      .update({ deleted_at: new Date().toISOString() })
      .eq("journey_id", journeyId)
      .eq("user_id", userId);

    if (error) throw error;

    await recordTripHistory(journeyId, userId, "delete", oldTrips, null);
    console.log("✅ Trip soft-deleted in Supabase");
  } catch (error) {
    console.error("❌ Supabase delete error:", error);
    toast.error("Failed to delete trip in cloud");
  }
}
