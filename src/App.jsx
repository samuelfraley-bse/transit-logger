import React, { useEffect, useState } from "react";
import { db, K, uid } from "./db.js";
import { useGeolocation } from "./hooks/useGeolocation.js";
import { useNearestStation } from "./hooks/useStations.js";
import { postLogs, fetchRecentLogs } from "./api.js";
import { supabase } from "./supabaseClient.js";
import toast, { Toaster } from "react-hot-toast";
import {
  saveLiveTripToSupabase,
  softDeleteTripInSupabase,
} from "./utils/tripSync.js";

export default function App() {
  // --- Auth ---
  const [user, setUser] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleLogin() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) toast.error("Login failed: " + error.message);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    toast("Signed out");
  }

  // --- Core States ---
  const [deviceId, setDeviceId] = useState(null);
  const [outbox, setOutbox] = useState([]);
  const [serverLogs, setServerLogs] = useState([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [tripState, setTripState] = useState("idle");
  const [activeJourneyId, setActiveJourneyId] = useState(null);
  const [activeTrip, setActiveTrip] = useState(null);
  const [tripStartTime, setTripStartTime] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [confirmStation, setConfirmStation] = useState("");
  const [confirmLine, setConfirmLine] = useState("");
  const [confirmCar, setConfirmCar] = useState("");

  const pos = useGeolocation();
  const nearest = useNearestStation(pos);

  // --- Persistent Device ID ---
  useEffect(() => {
    async function init() {
      let id = await db.getItem(K.deviceId);
      if (!id) {
        id = `dev_${uid()}`;
        await db.setItem(K.deviceId, id);
      }
      console.log("📱 Device ID:", id);
      setDeviceId(id);
    }
    init();
  }, []);

  // --- Network Sync Watcher ---
  useEffect(() => {
    const handler = () => setOnline(navigator.onLine);
    window.addEventListener("online", handler);
    window.addEventListener("offline", handler);
    return () => {
      window.removeEventListener("online", handler);
      window.removeEventListener("offline", handler);
    };
  }, []);

  useEffect(() => {
    if (online && user) {
      console.log("🌍 Network online — triggering syncNow()");
      syncNow();
    }
  }, [online, user]);

  // --- Sync Outbox to Supabase ---
  async function syncNow() {
    const pending = (await db.getItem(K.outbox)) || [];
    console.log("📦 SyncNow called — pending:", pending.length, "items");

    if (pending.length === 0) {
      console.log("✅ Nothing to sync");
      return;
    }

    try {
      toast("🔄 Syncing trips...");
      const res = await postLogs(pending);
      console.log("📬 postLogs response:", res);

      if (res?.ok || res?.status === 200) {
        await db.setItem(K.outbox, []);
        setOutbox([]);
        toast.success("✅ Trips synced to Supabase!");
      } else {
        console.warn("⚠️ postLogs() failed:", res);
        toast.error("Server rejected logs");
      }
    } catch (err) {
      console.error("💥 SyncNow error:", err);
      toast.error("Sync failed");
    }
  }

  // --- Confirm Trip Stage (start or end) ---
  async function confirmTripStage() {
    const pendingKey =
      tripState === "startConfirm" ? K.pendingOnLog : K.pendingOffLog;
    const log = await db.getItem(pendingKey);
    if (!log) return toast.error("No pending log found.");

    const entry = {
      ...log,
      device_id: log.device_id || deviceId,
      user_id: log.user_id || user?.id,
      email: user?.email,
      station: confirmStation || "Unknown",
      boarded_line: tripState === "startConfirm" ? confirmLine : null,
      exited_line: tripState === "endConfirm" ? confirmLine : null,
      car: tripState === "startConfirm" ? confirmCar || null : log.car || null,
    };

    console.log("🚀 Confirmed entry:", entry);

    const updated = [...outbox, entry];
    await db.setItem(K.outbox, updated);
    setOutbox(updated);

    if (tripState === "startConfirm") {
      setActiveTrip(entry);
      setActiveJourneyId(entry.journey_id);
      await db.setItem(K.activeTrip, entry);
      await db.setItem(K.activeJourneyId, entry.journey_id);
      setTripState("active");

      // Live save if possible
      if (online && user) {
        console.log("🌐 Saving trip start live to Supabase...");
        await saveLiveTripToSupabase(entry, user.id);
      }

      toast.success("🚇 Trip started!");
    } else {
      // End confirmation
      await db.removeItem(K.activeTrip);
      await db.removeItem(K.activeJourneyId);
      setTripState("complete");

      if (online && user) {
        console.log("🌐 Saving trip end live to Supabase...");
        await saveLiveTripToSupabase(entry, user.id);
      }

      toast.success("🏁 Trip completed!");
      setTimeout(() => setTripState("idle"), 1000);
    }
  }

  // --- Delete Trip Handler ---
  async function handleTripDelete(journeyId) {
    if (!user) return;
    console.log("🗑️ Deleting trip:", journeyId);
    await softDeleteTripInSupabase(journeyId, user.id);
    toast.success("Trip deleted (soft)");
  }

  // --- Timer ---
  useEffect(() => {
    if (tripState !== "active" || !tripStartTime) return;
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - tripStartTime) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [tripState, tripStartTime]);

  // --- Fetch Logs ---
  useEffect(() => {
    if (user) {
      fetchRecentLogs().then(setServerLogs).catch(() => {});
    }
  }, [outbox, user]);

  // --- UI ---
  if (!user) {
    return (
      <div className="h-screen flex flex-col justify-center items-center text-center text-white">
        <h1 className="text-3xl font-bold mb-4">🚇 Transit Logger</h1>
        <button
          onClick={handleLogin}
          className="bg-blue-600 px-6 py-3 rounded-lg font-semibold"
        >
          Log In with Google
        </button>
      </div>
    );
  }

  return (
    <div className="text-white p-6">
      <h2 className="text-xl mb-4">Hi, {user.email}</h2>
      <p>Device ID: {deviceId}</p>
      <p>Trip State: {tripState}</p>
      <button
        className="bg-green-600 px-4 py-2 rounded-lg mr-3"
        onClick={() => setTripState("startConfirm")}
      >
        Simulate Confirm Start
      </button>
      <button
        className="bg-red-600 px-4 py-2 rounded-lg"
        onClick={() => setTripState("endConfirm")}
      >
        Simulate Confirm End
      </button>

      <Toaster position="bottom-center" />
    </div>
  );
}
