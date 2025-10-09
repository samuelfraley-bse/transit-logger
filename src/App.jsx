import React, { useEffect, useState } from "react";
import { db, K, uid } from "./db.js";
import { useGeolocation } from "./hooks/useGeolocation.js";
import { useNearestStation } from "./hooks/useStations.js";
import { postLogs, fetchRecentLogs } from "./api.js";
import { supabase } from "./supabaseClient.js";
import MapView from "./components/MapView.jsx";
import toast, { Toaster } from "react-hot-toast";
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
        className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center"
      >
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold">🚇 Transit Logger</h1>
          <p className="text-slate-400">Please log in to continue.</p>
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={handleLogin}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl font-semibold"
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
      className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center py-6 px-4"
    >
      <div className="flex justify-between w-full max-w-md mb-4">
        <span className="text-slate-300">👋 {user.email}</span>
        <button
          onClick={handleLogout}
          className="text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded-lg"
        >
          Logout
        </button>
      </div>

      {/* Tabs */}
      <div className="flex flex-col sm:flex-row justify-center mb-4 gap-3 w-full max-w-md">
        <button
          onClick={() => setActiveTab("log")}
          className={`px-4 py-2 rounded-xl font-semibold w-full sm:w-auto ${
            activeTab === "log" ? "bg-blue-600" : "bg-slate-700"
          }`}
        >
          🚇 Log Trip
        </button>
        <button
          onClick={() => setActiveTab("summary")}
          className={`px-4 py-2 rounded-xl font-semibold w-full sm:w-auto ${
            activeTab === "summary" ? "bg-blue-600" : "bg-slate-700"
          }`}
        >
          📊 My Trips
        </button>
      </div>

      <AnimatePresence mode="wait">
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
                  className="max-w-md w-full bg-slate-800/60 p-4 rounded-2xl border border-slate-700 space-y-3 text-center"
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
                  className="max-w-md w-full bg-slate-800 border border-slate-700 rounded-2xl p-4 mb-6"
                >
                  <h2 className="text-lg font-bold mb-2">
                    {tripState === "startConfirm"
                      ? "🚇 Confirm Start Station"
                      : "🏁 Confirm Exit Station"}
                  </h2>

                  <div className="mb-3">
                    <label className="block text-slate-400 text-sm mb-1">Station</label>
                    <select
                      value={confirmStation}
                      onChange={(e) => setConfirmStation(e.target.value)}
                      className="w-full bg-slate-800 text-slate-100 rounded-xl p-2"
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
                      className="w-full bg-slate-800 text-slate-100 rounded-xl p-2"
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
                  className="max-w-md w-full bg-slate-800 border border-slate-700 rounded-2xl p-4 mt-4 text-center"
                >
                  <h2 className="text-lg font-semibold mb-2 text-yellow-300 animate-pulse">
                    🟢 Trip in Progress
                  </h2>
                  <p className="text-sm text-slate-400 mb-1">
                    From <span className="font-medium text-slate-200">{activeTrip.station}</span>
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

        {activeTab === "summary" && (
          <motion.div
            key="summary"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.5 }}
            className="max-w-md w-full bg-slate-800/60 p-4 rounded-2xl border border-slate-700 mt-6"
          >
            <h2 className="text-xl font-bold mb-3">📊 My Trips</h2>

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
                {Object.values(
                  serverLogs
                    .filter((r) => r.user_id === user.id)
                    .reduce((acc, log) => {
                      if (!log.journey_id) return acc;
                      if (!acc[log.journey_id]) acc[log.journey_id] = [];
                      acc[log.journey_id].push(log);
                      return acc;
                    }, {})
                ).map((logs, i) => {
                  const on = logs.find((l) => l.action === "on");
                  const off = logs.find((l) => l.action === "off");
                  if (!on) return null;

                  const startTime = new Date(on.timestamp);
                  const endTime = off ? new Date(off.timestamp) : null;
                  const durationMin = endTime
                    ? Math.max(0, Math.round((endTime - startTime) / 60000))
                    : null;

                  return (
                    <motion.div
                      key={i}
                      variants={{
                        hidden: { opacity: 0, y: 10 },
                        visible: { opacity: 1, y: 0 },
                      }}
                      className="bg-slate-800 border border-slate-700 rounded-xl p-4 shadow-sm"
                    >
                      <div className="flex justify-between text-sm text-slate-400 mb-2">
                        <span>{on.station}</span>
                        {off && <span>→ {off.station}</span>}
                      </div>
                      <p className="text-xs text-slate-400">
                        {durationMin !== null && `⏱️ ${durationMin} min`}
                      </p>
                    </motion.div>
                  );
                })}
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Release Notes */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="max-w-md w-full mt-10 bg-slate-800/60 p-4 rounded-2xl border border-slate-700 text-slate-200"
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
