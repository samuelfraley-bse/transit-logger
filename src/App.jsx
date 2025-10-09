import React, { useEffect, useState } from "react";
import { db, K, uid } from "./db.js";
import { useGeolocation } from "./hooks/useGeolocation.js";
import { useNearestStation } from "./hooks/useStations.js";
import { postLogs, fetchRecentLogs } from "./api.js";
import { supabase } from "./supabaseClient.js";
import MapView from "./components/MapView.jsx";
import toast, { Toaster } from "react-hot-toast";
import TripEditor from "./components/TripEditor.jsx";
import ReactMarkdown from "react-markdown";
import { motion, AnimatePresence } from "framer-motion";

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

  // --- Change Log ---
  const [changelog, setChangelog] = useState("Loading changelog...");
  useEffect(() => {
    fetch("/CHANGELOG.md")
      .then((res) => res.text())
      .then(setChangelog)
      .catch(() => setChangelog("⚠️ Could not load changelog."));
  }, []);

  // --- Core States ---
  const [deviceId, setDeviceId] = useState(null);
  const [outbox, setOutbox] = useState([]);
  const [serverLogs, setServerLogs] = useState([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [activeTab, setActiveTab] = useState("log");
  const [stations, setStations] = useState([]);
  const [uniqueStations, setUniqueStations] = useState([]);
  const [uniqueLines, setUniqueLines] = useState([]);
  const [activeJourneyId, setActiveJourneyId] = useState(null);
  const [activeTrip, setActiveTrip] = useState(null);
  const [tripStartTime, setTripStartTime] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [tripState, setTripState] = useState("idle"); // idle → startConfirm → active → endConfirm → complete
  const [confirmStation, setConfirmStation] = useState("");
  const [confirmLine, setConfirmLine] = useState("");
  const [showingAll, setShowingAll] = useState(false);

  //Full trip log
  async function fetchAllTripsFromSupabase(userId) {
  const { data, error } = await supabase
    .from("logs") // change table name if yours is different
    .select("*")
    .eq("user_id", userId)
    .order("timestamp", { ascending: false });

  if (error) {
    console.error("❌ Error fetching full history:", error);
    toast.error("Failed to load full trip history");
    return [];
  }

  return data || [];
}


  // --- Trip Editor ---
const [editingTrip, setEditingTrip] = useState(null);
const [editMode, setEditMode] = useState("add");

function handleTripSave(updatedTrip) {
  // Merge new or edited trip into local state
  setServerLogs((prev) => {
    const filtered = prev.filter((l) => l.journey_id !== updatedTrip.journey_id);
    return [...filtered, updatedTrip];
  });
  setEditingTrip(null);
}

function handleTripDelete(journeyId) {
  setServerLogs((prev) => prev.filter((l) => l.journey_id !== journeyId));
  setEditingTrip(null);
}


  // --- Persist tripState & tripStartTime ---
  useEffect(() => {
    if (tripState) db.setItem(K.tripState, tripState);
  }, [tripState]);

  useEffect(() => {
    if (tripStartTime) db.setItem(K.tripStartTime, tripStartTime);
  }, [tripStartTime]);

  const pos = useGeolocation();
  const nearest = useNearestStation(pos);

  // --- Load Stations ---
  useEffect(() => {
    async function loadStations() {
      console.log("📡 Fetching stations CSV...");
      try {
        const res = await fetch(
          "https://gist.githubusercontent.com/martgnz/1e5d9eb712075d8b8c6f7772a95a59f1/raw/data.csv",
          { cache: "no-store" }
        );
        const csv = await res.text();
        const cleanCsv = csv.replace(/^\uFEFF/, "").trim();
        const lines = cleanCsv.split("\n").slice(1);
        const parsed = lines
          .map((row) => {
            const [lng, lat, type, line, name] = row.split(",").map((v) => v.trim());
            if (!line || !name || isNaN(+lat) || isNaN(+lng)) return null;
            return { lng: +lng, lat: +lat, type, line, name };
          })
          .filter(Boolean);
        setStations(parsed);
        setUniqueStations([...new Set(parsed.map((s) => s.name))]);
        setUniqueLines([...new Set(parsed.map((s) => s.line))]);
        console.log("✅ Loaded stations:", parsed.length);
      } catch (err) {
        console.error("❌ Failed to load stations:", err);
      }
    }
    loadStations();
  }, []);

  // --- Persistent Device ID ---
  useEffect(() => {
    async function init() {
      let id = await db.getItem(K.deviceId);
      if (!id) {
        id = `dev_${uid()}`;
        await db.setItem(K.deviceId, id);
      }
      setDeviceId(id);
    }
    init();
  }, []);

  // --- Restore Trip State + Active Trip ---
  useEffect(() => {
    async function restoreTrip() {
      const savedTripState = await db.getItem(K.tripState);
      const savedTrip = await db.getItem(K.activeTrip);
      const savedJourneyId = await db.getItem(K.activeJourneyId);
      const savedTripStartTime = await db.getItem(K.tripStartTime);

      if (savedTrip && savedTripState === "active") {
        setActiveTrip(savedTrip);
        setActiveJourneyId(savedTrip.journey_id || savedJourneyId);
        setTripStartTime(savedTripStartTime ? Number(savedTripStartTime) : null);
        setTripState("active");
        toast("🔁 Resumed active trip");
        return;
      }

      if (savedTripState && ["startConfirm", "endConfirm"].includes(savedTripState)) {
        setTripState(savedTripState);
        toast("⚠️ You have a pending confirmation");
        return;
      }

      setTripState("idle");
    }

    restoreTrip();
  }, []);

  // --- Sync ---
  useEffect(() => {
    const set = () => setOnline(navigator.onLine);
    window.addEventListener("online", set);
    window.addEventListener("offline", set);
    return () => {
      window.removeEventListener("online", set);
      window.removeEventListener("offline", set);
    };
  }, []);

  useEffect(() => {
    if (online) syncNow();
  }, [online]);

  useEffect(() => {
    syncNow();
  }, []);

  async function syncNow() {
    const pending = (await db.getItem(K.outbox)) || [];
    if (pending.length === 0) {
      toast("✅ All trips synced — nothing pending.");
      return;
    }

    toast("🔄 Syncing pending trips...");
    try {
      const res = await postLogs(pending);
      if (res.ok) {
        await db.setItem(K.outbox, []);
        setOutbox([]);
        toast.success("✅ Synced logs!");
      } else {
        toast.error("❌ Server rejected logs");
      }
    } catch {
      toast.error("⚠️ Sync failed");
    }
  }

  // --- Tap Start ---
  async function handleTapStart() {
    if (!user) return toast.error("Please sign in first.");

    const journeyId = activeJourneyId || uid();
    console.log("🚆 Starting new trip with journeyId:", journeyId);

    const entry = {
      timestamp: new Date().toISOString(),
      deviceId,
      user_id: user.id,
      email: user.email,
      action: "on",
      lat: pos?.lat,
      lon: pos?.lon,
      journey_id: journeyId,
    };

    await db.setItem(K.pendingOnLog, entry);
    setActiveJourneyId(journeyId);
    await db.setItem(K.activeJourneyId, journeyId);

    const now = Date.now();
    setTripStartTime(now);
    await db.setItem(K.tripStartTime, now);

    setTripState("startConfirm");
    setConfirmStation(nearest?.name || "");
  }

  // --- Tap End ---
  async function handleTapEnd() {
    if (!user) return toast.error("Please sign in first.");

    // 🩹 Ensure journey ID persists
    let journeyId = activeJourneyId || (await db.getItem(K.activeJourneyId));
    console.log("🏁 handleTapEnd - activeJourneyId:", journeyId);

    if (!journeyId) return toast.error("No active trip found.");

    const entry = {
      timestamp: new Date().toISOString(),
      deviceId,
      user_id: user.id,
      email: user.email,
      action: "off",
      lat: pos?.lat,
      lon: pos?.lon,
      journey_id: journeyId,
    };

    await db.setItem(K.pendingOffLog, entry);
    setTripState("endConfirm");
    setConfirmStation(nearest?.name || "");
  }

  // --- Confirm Stage ---
  async function confirmTripStage() {
    const pendingKey = tripState === "startConfirm" ? K.pendingOnLog : K.pendingOffLog;
    const log = await db.getItem(pendingKey);
    if (!log) return toast.error("No pending log found.");

    const entry = {
      ...log,
      station: confirmStation || "Unknown",
      boarded_line: tripState === "startConfirm" ? confirmLine : null,
      exited_line: tripState === "endConfirm" ? confirmLine : null,
    };

    const updated = [...outbox, entry];
    await db.setItem(K.outbox, updated);
    setOutbox(updated);

    if (tripState === "startConfirm") {
      await db.setItem(K.activeTrip, entry);
      setActiveTrip(entry);

      // 🆕 Ensure journeyId is persisted
      const savedJourneyId = entry.journey_id;
      setActiveJourneyId(savedJourneyId);
      await db.setItem(K.activeJourneyId, savedJourneyId);
      console.log("🎯 Journey ID persisted:", savedJourneyId);

      setTripState("active");
      toast.success("🚇 Trip started!");
    } else {
      // Clean up
      setTripStartTime(null);
      await db.removeItem(K.tripStartTime);
      setElapsed(0);

      await db.removeItem(K.activeTrip);
      await db.removeItem(K.activeJourneyId);
      setActiveTrip(null);
      setTripState("complete");

      toast.success("🏁 Trip completed!");
      setTimeout(() => setTripState("idle"), 1000);
    }
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
    fetchRecentLogs().then(setServerLogs).catch(() => {});
  }, [outbox]);

  // --- UI ---
if (!user) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-slate-100 flex items-center justify-center"
    >
      <div className="text-center space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">🚇 Transit Logger</h1>
        <p className="text-slate-400">Log your metro journeys seamlessly — even offline.</p>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleLogin}
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-semibold shadow-lg"
        >
          Log In with Google
        </motion.button>
      </div>
    </motion.div>
  );
}

return (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ duration: 0.5 }}
    className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 text-slate-100 flex flex-col items-center py-6 px-4"
  >
    {/* Header */}
    <div className="flex justify-between w-full max-w-md mb-6 items-center">
      <div className="flex items-center gap-2">
        <span className="text-slate-300">👋 {user.email}</span>
        {online ? (
          <span className="text-green-400 text-xs">● Online</span>
        ) : (
          <span className="text-amber-400 text-xs">● Offline</span>
        )}
      </div>
      <button
        onClick={handleLogout}
        className="text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded-lg"
      >
        Logout
      </button>
    </div>

    {/* Tabs */}
    <div className="flex flex-col sm:flex-row justify-center mb-6 gap-3 w-full max-w-md">
      <button
        onClick={() => setActiveTab("log")}
        className={`px-4 py-2 rounded-xl font-semibold w-full sm:w-auto transition ${
          activeTab === "log"
            ? "bg-blue-600 shadow-md"
            : "bg-slate-700 hover:bg-slate-600"
        }`}
      >
        🚇 Log Trip
      </button>
      <button
        onClick={() => setActiveTab("summary")}
        className={`px-4 py-2 rounded-xl font-semibold w-full sm:w-auto transition ${
          activeTab === "summary"
            ? "bg-blue-600 shadow-md"
            : "bg-slate-700 hover:bg-slate-600"
        }`}
      >
        📊 My Trips
      </button>
    </div>

    <AnimatePresence mode="wait">
      {/* --- LOG TAB --- */}
      {activeTab === "log" && (
        <motion.div
          key="log"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.4 }}
          className="w-full flex flex-col items-center"
        >
          <AnimatePresence mode="wait">
            {tripState === "idle" && (
              <motion.div
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                className="max-w-md w-full bg-slate-800/70 p-5 rounded-2xl border border-slate-700 space-y-4 text-center shadow-lg"
              >
                <p className="text-slate-400 text-sm">
                  📍 Nearest Station:{" "}
                  <span className="text-white font-medium">
                    {nearest?.name || "Detecting..."}
                  </span>
                </p>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleTapStart}
                  className="bg-green-600 hover:bg-green-700 text-white px-5 py-3 rounded-xl font-semibold w-full"
                >
                  🚇 Tap On
                </motion.button>
              </motion.div>
            )}

            {["startConfirm", "endConfirm"].includes(tripState) && (
              <motion.div
                key="confirm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                className="max-w-md w-full bg-slate-800 border border-slate-700 rounded-2xl p-5 mb-6 shadow-md"
              >
                <h2 className="text-lg font-bold mb-4">
                  {tripState === "startConfirm"
                    ? "🚇 Confirm Start Station"
                    : "🏁 Confirm Exit Station"}
                </h2>

                <div className="mb-3">
                  <label className="block text-slate-400 text-sm mb-1">Station</label>
                  <select
                    value={confirmStation}
                    onChange={(e) => setConfirmStation(e.target.value)}
                    className="w-full bg-slate-700 text-slate-100 rounded-xl p-2"
                  >
                    <option value="">Select station...</option>
                    {uniqueStations.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mb-3">
                  <label className="block text-slate-400 text-sm mb-1">Line</label>
                  <select
                    value={confirmLine}
                    onChange={(e) => setConfirmLine(e.target.value)}
                    className="w-full bg-slate-700 text-slate-100 rounded-xl p-2"
                  >
                    <option value="">Select line...</option>
                    {uniqueLines.map((line) => (
                      <option key={line} value={line}>
                        {line}
                      </option>
                    ))}
                  </select>
                </div>

                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={confirmTripStage}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-2 font-semibold"
                >
                  Confirm
                </motion.button>
              </motion.div>
            )}

            {tripState === "active" && activeTrip && (
              <motion.div
                key="active"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
                className="max-w-md w-full bg-slate-800 border border-slate-700 rounded-2xl p-4 mt-4 text-center shadow-md"
              >
                <h2 className="text-lg font-semibold mb-2 text-yellow-300 animate-pulse">
                  🟢 Trip in Progress
                </h2>
                <p className="text-sm text-slate-400 mb-1">
                  From{" "}
                  <span className="font-medium text-slate-200">{activeTrip.station}</span>
                </p>
                <p className="text-sm text-slate-400 mb-2">
                  Duration: <span className="font-mono text-slate-200">{elapsed}s</span>
                </p>

                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleTapEnd}
                  className="bg-red-600 hover:bg-red-700 text-white px-5 py-3 rounded-xl font-semibold w-full mt-3"
                >
                  🏁 Tap Off
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="max-w-md w-full mt-6"
          >
            <MapView position={pos} stations={stations} nearest={nearest} tripState={tripState} />
          </motion.div>
        </motion.div>
      )}

      {/* --- SUMMARY TAB --- */}
      {activeTab === "summary" && (
        <motion.div
          key="summary"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.5 }}
          className="max-w-md w-full bg-slate-800/70 p-5 rounded-2xl border border-slate-700 mt-6 shadow-lg"
        >
      {/* Header */}
<div className="flex justify-between items-center mb-3">
  <h2 className="text-xl font-bold">📊 My Trips</h2>

  <div className="flex gap-2">
    {/* Add Trip button */}
    <button
      onClick={() => {
        setEditMode("add");
        setEditingTrip({});
      }}
      className="bg-green-600 hover:bg-green-700 text-white text-sm px-3 py-1 rounded-lg"
    >
      ➕ Add Trip
    </button>

    {/* Show All / Show Recent toggle */}
    <button
      onClick={async () => {
        if (!user) return;

        // Determine toggle mode
        if (!showingAll) {
          toast("📦 Loading full trip history...");
          const fullHistory = await fetchAllTripsFromSupabase(user.id);
          setServerLogs(fullHistory);
          setShowingAll(true);
          toast.success(`✅ Loaded ${fullHistory.length} total trips`);
        } else {
          toast("🔄 Loading recent trips...");
          const recent = await fetchRecentLogs();
          setServerLogs(recent);
          setShowingAll(false);
          toast.success("✅ Showing recent trips");
        }
      }}
      className="bg-slate-700 hover:bg-slate-600 text-white text-sm px-3 py-1 rounded-lg"
    >
      {showingAll ? "🔙 Show Recent" : "📜 Show All"}
    </button>
  </div>
</div>


          {/* Trip List */}
          {serverLogs.filter((r) => r.user_id === user.id).length === 0 ? (
            <p className="text-slate-400">No trips yet.</p>
          ) : (
            <motion.div
              initial="hidden"
              animate="visible"
              variants={{
                hidden: { opacity: 1 },
                visible: {
                  opacity: 1,
                  transition: { staggerChildren: 0.1 },
                },
              }}
              className="space-y-4"
            >
             {/* Grouped Trips */}
{(() => {
  const userTrips = serverLogs.filter((r) => r.user_id === user.id);
  if (userTrips.length === 0) {
    return <p className="text-slate-400">No trips yet.</p>;
  }

  // --- Group logs by journey_id
  const trips = Object.values(
    userTrips.reduce((acc, log) => {
      if (!log.journey_id) return acc;
      if (!acc[log.journey_id]) acc[log.journey_id] = [];
      acc[log.journey_id].push(log);
      return acc;
    }, {})
  ).map((logs) => {
    const on = logs.find((l) => l.action === "on");
    const off = logs.find((l) => l.action === "off");
    const startTime = on ? new Date(on.timestamp) : null;
    const endTime = off ? new Date(off.timestamp) : null;
    const durationMin =
      startTime && endTime
        ? Math.max(0, Math.round((endTime - startTime) / 60000))
        : null;
    return { on, off, startTime, endTime, durationMin };
  });

  // --- Group trips by relative date: Today, This Week, Older
  const now = new Date();
  const today = trips.filter(
    (t) => t.startTime && t.startTime.toDateString() === now.toDateString()
  );
  const week = trips.filter((t) => {
    if (!t.startTime) return false;
    const diffDays = (now - t.startTime) / (1000 * 60 * 60 * 24);
    return diffDays > 0 && diffDays <= 7 && t.startTime.toDateString() !== now.toDateString();
  });
  const older = trips.filter((t) => {
    if (!t.startTime) return false;
    const diffDays = (now - t.startTime) / (1000 * 60 * 60 * 24);
    return diffDays > 7;
  });

  const sections = [
    { label: "🕒 Today", data: today },
    { label: "📅 This Week", data: week },
    { label: "🗓️ Older", data: older },
  ].filter((s) => s.data.length > 0);

  return (
    <div className="space-y-6">
      {sections.map(({ label, data }) => (
        <div key={label}>
          <h3 className="text-slate-300 font-semibold mb-2 border-b border-slate-700 pb-1">
            {label}
          </h3>
          <div className="space-y-3">
            {data.map((t, i) => (
              <motion.div
                key={i}
                variants={{
                  hidden: { opacity: 0, y: 10 },
                  visible: { opacity: 1, y: 0 },
                }}
                className="bg-slate-800 border border-slate-700 rounded-xl p-4 shadow-sm"
              >
                <div className="flex justify-between items-center text-sm text-slate-400 mb-2">
                  <div>
                    <span>{t.on?.station}</span>
                    {t.off && <span> → {t.off.station}</span>}
                    {t.on?.manual && (
                      <span className="text-amber-400 ml-2">✍️ Manual</span>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setEditMode("edit");
                        setEditingTrip(t.on);
                      }}
                      className="text-blue-400 hover:text-blue-300 text-xs"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => handleTripDelete(t.on?.journey_id)}
                      className="text-red-400 hover:text-red-300 text-xs"
                    >
                      🗑️
                    </button>
                  </div>
                </div>

                <div className="text-xs text-slate-400 flex flex-col gap-1">
                  {t.durationMin !== null && <span>⏱️ {t.durationMin} min</span>}
                  {t.startTime && (
                    <span>
                      📅{" "}
                      {t.startTime.toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}{" "}
                      •{" "}
                      {t.startTime.toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
})()}

            </motion.div>
          )}

          {/* TripEditor Modal */}
          {editingTrip && (
            <TripEditor
              mode={editMode}
              initialData={editingTrip}
              uniqueStations={uniqueStations}
              uniqueLines={uniqueLines}
              onSave={handleTripSave}
              onDelete={handleTripDelete}
              onCancel={() => setEditingTrip(null)}
              user={user}
              deviceId={deviceId}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>

    {/* Release Notes */}
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.4 }}
      className="max-w-md w-full mt-10 bg-slate-800/70 p-4 rounded-2xl border border-slate-700 text-slate-200 shadow-md"
    >
      <h2 className="text-xl font-bold mb-4">📝 Release Notes</h2>
      <div className="prose prose-invert text-sm max-w-none">
        <ReactMarkdown>{changelog}</ReactMarkdown>
      </div>
    </motion.div>

    <Toaster position="bottom-center" />
  </motion.div>
);
}
