import React, { useEffect, useState } from "react";
import { db, K, uid } from "./db.js";
import { useGeolocation } from "./hooks/useGeolocation.js";
import { useNearestStation } from "./hooks/useStations.js";
import { postLogs, fetchRecentLogs } from "./api.js";
import { supabase } from "./supabaseClient.js";
import MapView from "./components/MapView.jsx";
import toast, { Toaster } from "react-hot-toast";
import ReactMarkdown from "react-markdown";

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
    options: {
      redirectTo: window.location.origin, // ✅ keeps you on localhost or production automatically
    },
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
  const [searchOn, setSearchOn] = useState("");
  const [searchOff, setSearchOff] = useState("");
  const [selectedStationOn, setSelectedStationOn] = useState("");
  const [selectedStationOff, setSelectedStationOff] = useState("");
  const [selectedLineOn, setSelectedLineOn] = useState("");
  const [selectedLineOff, setSelectedLineOff] = useState("");
  const [activeTrip, setActiveTrip] = useState(null);
  const [activeJourneyId, setActiveJourneyId] = useState(null);

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
            const [lng, lat, type, line, name] = row
              .split(",")
              .map((v) => v.trim());
            if (!line || !name || isNaN(+lat) || isNaN(+lng)) return null;
            return { lng: +lng, lat: +lat, type, line, name };
          })
          .filter(Boolean);
        setStations(parsed);
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

  // --- Restore Active Trip on Reload ---
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

  // --- Online/Offline Sync ---
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

  // --- Tap Logic ---
  async function handleTap(action) {
    if (!user) return toast.error("Please sign in first.");

    const journeyId = activeJourneyId || uid();
    const station =
      action === "on"
        ? selectedStationOn || "Unknown"
        : selectedStationOff || "Unknown";
    const line =
      action === "on" ? selectedLineOn || null : selectedLineOff || null;

    const entry = {
      timestamp: new Date().toISOString(),
      deviceId,
      user_id: user.id,
      email: user.email,
      car: car || null,
      action,
      station,
      lat: pos?.lat,
      lon: pos?.lon,
      boarded_line: action === "on" ? line : null,
      exited_line: action === "off" ? line : null,
      journey_id: journeyId,
    };

    const updated = [...outbox, entry];
    setOutbox(updated);
    await db.setItem(K.outbox, updated);

    if (action === "on") {
      const tripData = {
        id: entry.timestamp,
        station: entry.station,
        startTime: entry.timestamp,
        journey_id: journeyId,
      };
      setActiveTrip(tripData);
      setActiveJourneyId(journeyId);
      await db.setItem(K.activeTrip, tripData);
      toast.success("🚇 Trip started!");
    } else {
      setActiveTrip(null);
      setActiveJourneyId(null);
      await db.removeItem(K.activeTrip);
      toast.success("🏁 Trip completed!");
    }
  }

  useEffect(() => {
    fetchRecentLogs().then(setServerLogs).catch(() => {});
  }, [outbox]);

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

      {/* --- Main Content --- */}
      {activeTab === "log" && (
        <>
          <div className="max-w-md w-full bg-slate-800/60 p-4 rounded-2xl border border-slate-700 space-y-3">
            {!activeTrip ? (
              <>
                <h1 className="text-2xl font-bold text-center">🚇 Tap On</h1>

                {/* Tap On Station */}
                <div className="mb-4">
                  <label className="block text-slate-400 text-sm mb-1">
                    Station
                  </label>
                  <input
                    type="text"
                    placeholder="Type station name..."
                    value={searchOn}
                    onChange={(e) => {
                      setSearchOn(e.target.value);
                      setSelectedStationOn(e.target.value);
                    }}
                    list="stationsListOn"
                    className="w-full bg-slate-800 text-slate-100 rounded-xl p-2"
                  />
                  <datalist id="stationsListOn">
                    {stations.map((s) => (
                      <option key={`${s.name}-${s.line}`} value={s.name}>
                        {s.name} ({s.line})
                      </option>
                    ))}
                  </datalist>
                </div>

                {/* Boarded Line */}
                <div className="mb-4">
                  <label className="block text-slate-400 text-sm mb-1">
                    Boarded Line
                  </label>
                  <select
                    value={selectedLineOn}
                    onChange={(e) => setSelectedLineOn(e.target.value)}
                    className="w-full bg-slate-800 text-slate-100 rounded-xl p-2"
                  >
                    <option value="">Select line...</option>
                    {[...new Set(stations.map((s) => s.line))].map((line) => (
                      <option key={line} value={line}>
                        {line}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Car Number */}
                <div className="mb-4">
                  <label className="block text-slate-400 text-sm mb-1">
                    Car Number (optional)
                  </label>
                  <input
                    type="text"
                    maxLength="3"
                    inputMode="numeric"
                    pattern="\d*"
                    className="w-full bg-slate-800 text-slate-100 rounded-xl p-2"
                    placeholder="e.g. 123"
                    value={car}
                    onChange={(e) =>
                      setCar(e.target.value.replace(/\D/g, "").slice(0, 3))
                    }
                  />
                </div>

                <div className="flex justify-center mt-4">
                  <button
                    onClick={() => handleTap("on")}
                    className="bg-green-600 hover:bg-green-700 text-white px-5 py-3 rounded-xl font-semibold w-full"
                  >
                    🚇 Tap On
                  </button>
                </div>
              </>
            ) : (
              <>
                <h1 className="text-xl font-bold text-yellow-400 text-center">
                  🟡 Trip in Progress
                </h1>

                {/* Tap Off Station */}
                <div className="mb-4 mt-4">
                  <label className="block text-slate-400 text-sm mb-1">
                    Exit Station
                  </label>
                  <input
                    type="text"
                    placeholder="Type station name..."
                    value={searchOff}
                    onChange={(e) => {
                      setSearchOff(e.target.value);
                      setSelectedStationOff(e.target.value);
                    }}
                    list="stationsListOff"
                    className="w-full bg-slate-800 text-slate-100 rounded-xl p-2"
                  />
                  <datalist id="stationsListOff">
                    {stations.map((s) => (
                      <option key={`${s.name}-${s.line}`} value={s.name}>
                        {s.name} ({s.line})
                      </option>
                    ))}
                  </datalist>
                </div>

                {/* Exited Line */}
                <div className="mb-4">
                  <label className="block text-slate-400 text-sm mb-1">
                    Exited Line
                  </label>
                  <select
                    value={selectedLineOff}
                    onChange={(e) => setSelectedLineOff(e.target.value)}
                    className="w-full bg-slate-800 text-slate-100 rounded-xl p-2"
                  >
                    <option value="">Select line...</option>
                    {[...new Set(stations.map((s) => s.line))].map((line) => (
                      <option key={line} value={line}>
                        {line}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex justify-center mt-4">
                  <button
                    onClick={() => handleTap("off")}
                    className="bg-red-600 hover:bg-red-700 text-white px-5 py-3 rounded-xl font-semibold w-full"
                  >
                    🏁 Tap Off
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Map Section */}
          <div className="max-w-md w-full mt-6">
            <MapView position={pos} stations={stations} nearest={nearest} />
          </div>
        </>
      )}

  {activeTab === "summary" && (
  <div className="max-w-md w-full bg-slate-800/60 p-4 rounded-2xl border border-slate-700 mt-6">
    <h2 className="text-xl font-bold mb-3">📊 My Trips</h2>

    {serverLogs.filter((r) => r.user_id === user.id).length === 0 ? (
      <p className="text-slate-400">No trips yet.</p>
    ) : (
      <div className="space-y-4">
        {serverLogs
          .filter((r) => r.user_id === user.id)
          .slice(-20)
          .reverse()
          .map((r, i, arr) => {
            // Match up on/off pairs by journey_id
            const journeyLogs = arr.filter((j) => j.journey_id === r.journey_id);
            const on = journeyLogs.find((j) => j.action === "on");
            const off = journeyLogs.find((j) => j.action === "off");

            if (!on) return null; // skip incomplete journey

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
                key={`${r.journey_id}-${i}`}
                className="bg-slate-800 border border-slate-700 rounded-xl p-4 shadow-sm"
              >
                {/* Date Header */}
                <div className="text-sm text-slate-400 mb-2">{dateLabel}</div>

                {/* Trip Flow */}
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

                {/* Meta Info */}
                <div className="text-xs text-slate-400 space-y-1 mt-2">
                  {on.boarded_line && (
                    <p>Line: {on.boarded_line}</p>
                  )}
                  {off?.exited_line && (
                    <p>Exited Line: {off.exited_line}</p>
                  )}
                  {durationMin !== null && (
                    <p>
                      ⏱️ <strong>Duration:</strong> {durationMin} min
                    </p>
                  )}
                  <p>Journey ID: {r.journey_id}</p>
                </div>
              </div>
            );
          })}
      </div>
    )}
  </div>
)}


      {/* --- Release Notes Section --- */}
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
