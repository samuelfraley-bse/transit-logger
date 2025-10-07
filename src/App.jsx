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
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
      }
    );

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
  const [car, setCar] = useState("");
  const [outbox, setOutbox] = useState([]);
  const [serverLogs, setServerLogs] = useState([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [activeTab, setActiveTab] = useState("log");
  const [stations, setStations] = useState([]);
  const [uniqueStations, setUniqueStations] = useState([]);
  const [uniqueLines, setUniqueLines] = useState([]);
  const [activeJourneyId, setActiveJourneyId] = useState(null);
  const [activeTrip, setActiveTrip] = useState(null);

  // --- Confirmation UI ---
  const [tripState, setTripState] = useState("idle"); // idle → startConfirm → active → endConfirm → complete
  const [confirmStation, setConfirmStation] = useState("");
  const [confirmLine, setConfirmLine] = useState("");

  const pos = useGeolocation();
  const nearest = useNearestStation(pos);

  // --- Load Stations ---
  useEffect(() => {
    async function loadStations() {
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
        console.log("✅ Stations loaded:", parsed.length);
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

  // --- Restore Active Trip ---
  useEffect(() => {
    async function loadActiveTrip() {
      const savedTrip = await db.getItem(K.activeTrip);
      if (savedTrip) {
        setActiveTrip(savedTrip);
        setActiveJourneyId(savedTrip.journey_id);
      }
    }
    loadActiveTrip();
  }, []);

  // --- Online Sync ---
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

  async function syncNow() {
    const pending = (await db.getItem(K.outbox)) || [];
    if (pending.length === 0) return;
    try {
      const res = await postLogs(pending);
      if (res.ok) {
        await db.setItem(K.outbox, []);
        setOutbox([]);
        toast.success("✅ Synced logs!");
      } else toast.error("❌ Server rejected logs");
    } catch {
      toast.error("⚠️ Sync failed");
    }
  }

  // --- Tap Start / End ---
  async function handleTapStart() {
    if (!user) return toast.error("Please sign in first.");

    const journeyId = activeJourneyId || uid();
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
    setTripState("startConfirm");
    setConfirmStation(nearest?.name || "");
    setConfirmLine("");
  }

  async function handleTapEnd() {
    if (!user) return toast.error("Please sign in first.");
    if (!activeJourneyId) return toast.error("No active trip found.");

    const entry = {
      timestamp: new Date().toISOString(),
      deviceId,
      user_id: user.id,
      email: user.email,
      action: "off",
      lat: pos?.lat,
      lon: pos?.lon,
      journey_id: activeJourneyId,
    };

    await db.setItem(K.pendingOffLog, entry);
    setTripState("endConfirm");
    setConfirmStation(nearest?.name || "");
    setConfirmLine("");
  }

  // --- Confirm Stage ---
  async function confirmTripStage() {
    const pendingKey =
      tripState === "startConfirm" ? K.pendingOnLog : K.pendingOffLog;
    const log = await db.getItem(pendingKey);
    if (!log) return toast.error("No pending log found.");

    const entry = {
      ...log,
      station: confirmStation || "Unknown",
      boarded_line: tripState === "startConfirm" ? confirmLine : null,
      exited_line: tripState === "endConfirm" ? confirmLine : null,
      car: car || null,
    };

    const updated = [...outbox, entry];
    await db.setItem(K.outbox, updated);
    setOutbox(updated);

    if (tripState === "startConfirm") {
      await db.setItem(K.activeTrip, {
        id: entry.timestamp,
        station: entry.station,
        startTime: entry.timestamp,
        journey_id: entry.journey_id,
      });
      setActiveTrip(entry);
      setTripState("active");
      toast.success("🚇 Trip started!");
    } else {
      await db.removeItem(K.activeTrip);
      setActiveTrip(null);
      setActiveJourneyId(null);
      setTripState("complete");
      toast.success("🏁 Trip completed!");
    }
  }

  useEffect(() => {
    fetchRecentLogs().then(setServerLogs).catch(() => {});
  }, [outbox]);

  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (tripState !== "active") return;
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [tripState]);


  // --- UI ---
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold">🚇 Transit Logger</h1>
          <p className="text-slate-400">Please log in to continue.</p>
          <button
            onClick={handleLogin}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl font-semibold"
          >
            Log In with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center py-6 px-4">
      {/* Header */}
      <div className="flex justify-between w-full max-w-md mb-4">
        <span className="text-slate-300">👋 {user.email}</span>
          {tripState === "active" && (
            <div className="flex items-center text-green-400 text-sm mb-2 animate-pulse">
              <span className="mr-2">🟢</span> Trip in progress
            </div>
)}

        <button
          onClick={handleLogout}
          className="text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded-lg"
        >
          Logout
        </button>
      </div>

      {/* Debug trip state */}
      <div className="text-xs text-slate-500 mb-2">State: {tripState}</div>

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

      {/* Confirmation Card */}
      {["startConfirm", "endConfirm"].includes(tripState) && (
        <div className="max-w-md w-full bg-slate-800 border border-slate-700 rounded-2xl p-4 mb-6">
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

          <button
            onClick={confirmTripStage}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-2 font-semibold"
          >
            Confirm
          </button>
        </div>
      )}

   {/* --- LOG TAB --- */}
{activeTab === "log" && (
  <>
    <div className="max-w-md w-full bg-slate-800/60 p-4 rounded-2xl border border-slate-700 space-y-3">

      {/* Idle: Show nearest station info and Tap On */}
      {tripState === "idle" && (
        <div className="space-y-3">
          <div className="text-center text-slate-400 text-sm bg-slate-800 border border-slate-700 rounded-xl p-3">
            {nearest?.name ? (
              <>
                <span className="text-slate-300 font-semibold">📍 Nearest Station:</span>{" "}
                <span className="text-white font-medium">{nearest.name}</span>
              </>
            ) : (
              <span>Detecting nearest station...</span>
            )}
          </div>

          <button
            onClick={handleTapStart}
            className="bg-green-600 hover:bg-green-700 text-white px-5 py-3 rounded-xl font-semibold w-full"
          >
            🚇 Tap On
          </button>
        </div>
      )}

      {/* Active: Show Trip Progress + Tap Off */}
      {tripState === "active" && (
        <>
          <button
            onClick={handleTapEnd}
            className="bg-red-600 hover:bg-red-700 text-white px-5 py-3 rounded-xl font-semibold w-full"
          >
            🏁 Tap Off
          </button>

          {/* Progress Card */}
          {activeTrip && (
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-4 mt-4 text-center animate-pulse">
              <h2 className="text-lg font-semibold mb-2 text-yellow-300">
                🟢 Trip in Progress
              </h2>

              <p className="text-sm text-slate-400 mb-1">
                From{" "}
                <span className="font-medium text-slate-200">
                  {activeTrip.station || "Unknown"}
                </span>
              </p>

              <p className="text-sm text-slate-400 mb-1">
                Line:{" "}
                <span className="font-medium text-slate-200">
                  {activeTrip.boarded_line || "—"}
                </span>
              </p>

              <p className="text-sm text-slate-400 mb-2">
                Duration:{" "}
                <span className="font-mono text-slate-200">
                  {Math.floor(elapsed / 60)}m {elapsed % 60}s
                </span>
              </p>

              {/* Animated progress bar */}
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="bg-yellow-400 h-full transition-all duration-1000 ease-linear"
                  style={{ width: `${(elapsed % 60) * (100 / 60)}%` }}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>

    {/* Map Section */}
    <div className="max-w-md w-full mt-6">
      <MapView position={pos} stations={stations} nearest={nearest} />
    </div>
  </>
)}



      {/* --- SUMMARY TAB --- */}
      {activeTab === "summary" && (
        <div className="max-w-md w-full bg-slate-800/60 p-4 rounded-2xl border border-slate-700 mt-6">
          <h2 className="text-xl font-bold mb-3">📊 My Trips</h2>

          {serverLogs.filter((r) => r.user_id === user.id).length === 0 ? (
            <p className="text-slate-400">No trips yet.</p>
          ) : (
            <div className="space-y-4">
              {(() => {
                const journeys = Object.values(
                  serverLogs
                    .filter((r) => r.user_id === user.id)
                    .reduce((acc, log) => {
                      if (!log.journey_id) return acc;
                      if (!acc[log.journey_id]) acc[log.journey_id] = [];
                      acc[log.journey_id].push(log);
                      return acc;
                    }, {})
                );

                journeys.sort((a, b) => {
                  const aTime = Math.max(
                    ...a.map((x) => new Date(x.timestamp).getTime())
                  );
                  const bTime = Math.max(
                    ...b.map((x) => new Date(x.timestamp).getTime())
                  );
                  return bTime - aTime;
                });

                return journeys.map((logs, i) => {
                  const on = logs.find((l) => l.action === "on");
                  const off = logs.find((l) => l.action === "off");
                  if (!on) return null;

                  const startTime = new Date(on.timestamp);
                  const endTime = off ? new Date(off.timestamp) : null;
                  const durationMin = endTime
                    ? Math.max(0, Math.round((endTime - startTime) / 60000))
                    : null;

                  const dateLabel = startTime.toLocaleDateString([], {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  });

                  return (
                    <div
                      key={on.journey_id || i}
                      className="bg-slate-800 border border-slate-700 rounded-xl p-4 shadow-sm"
                    >
                      <div className="text-sm text-slate-400 mb-2">
                        {dateLabel}
                      </div>

                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-1">
                        <div>
                          <span className="font-semibold text-slate-100">
                            🚇 {on.station}
                          </span>
                          {off && (
                            <>
                              <span className="text-slate-500 mx-2">→</span>
                              <span className="font-semibold text-slate-100">
                                🏁 {off.station}
                              </span>
                            </>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 mt-1 sm:mt-0">
                          {startTime.toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {off &&
                            `–${endTime.toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}`}
                        </div>
                      </div>

                      <div className="text-xs text-slate-400 space-y-1 mt-2">
                        {on.boarded_line && <p>Line: {on.boarded_line}</p>}
                        {off?.exited_line && <p>Exited Line: {off.exited_line}</p>}
                        {durationMin !== null && (
                          <p>
                            ⏱️ <strong>Duration:</strong> {durationMin} min
                          </p>
                        )}
                        <p>Journey ID: {on.journey_id}</p>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </div>
      )}

      {/* --- RELEASE NOTES --- */}
      <div className="max-w-md w-full mt-10 bg-slate-800/60 p-4 rounded-2xl border border-slate-700 text-slate-200">
        <h2 className="text-xl font-bold mb-4">📝 Release Notes</h2>
        <div className="prose prose-invert text-sm max-w-none">
          <ReactMarkdown>{changelog}</ReactMarkdown>
        </div>
      </div>

      <Toaster position="bottom-center" />
    </div>
  );
}
