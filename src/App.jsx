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
    });
    if (error) toast.error("Login failed: " + error.message);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    toast("Signed out");
  }
//change log
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
  const [changelog, setChangelog] = useState("Loading changelog...");

  const pos = useGeolocation();
  const nearest = useNearestStation(pos);

  // --- Load Stations ---
  useEffect(() => {
    fetch(
      "https://gist.githubusercontent.com/martgnz/1e5d9eb712075d8b8c6f7772a95a59f1/raw/data.csv"
    )
      .then((res) => res.text())
      .then((csv) => {
        const lines = csv.trim().split("\n").slice(1);
        const parsed = lines.map((row) => {
          const [lng, lat, type, line, name] = row.split(",");
          return { lng: +lng, lat: +lat, type, line, name };
        });
        setStations(parsed);
      })
      .catch((err) => console.error("Failed to load stations", err));
  }, []);

  // --- Auto-select nearest station ---
  useEffect(() => {
    if (nearest?.name && !searchOn) {
      setSearchOn(nearest.name);
      setSelectedStationOn(nearest.name);
    }
  }, [nearest]);

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

    const entry = {
      timestamp: new Date().toISOString(),
      deviceId,
      user_id: user.id,
      email: user.email,
      car: car || null,
      action,
      station:
        action === "on"
          ? selectedStationOn || nearest?.name || "Unknown"
          : selectedStationOff || nearest?.name || "Unknown",
      lat: pos?.lat,
      lon: pos?.lon,
      boarded_line: action === "on" ? selectedLineOn : null,
      exited_line: action === "off" ? selectedLineOff : null,
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

// --- Main Authenticated UI ---
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

    {/* Tabs (Responsive) */}
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
              <p className="text-center text-slate-400">
                Nearest: <strong>{nearest?.name || "Detecting..."}</strong>
              </p>

              {/* Station Search */}
              <div className="mb-4 relative">
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
                  list="stationsList"
                  className="w-full bg-slate-800 text-slate-100 rounded-xl p-2"
                />
                <datalist id="stationsList">
                  {stations.map((s) => (
                    <option key={`${s.name}-${s.line}`} value={s.name}>
                      {s.name} ({s.line})
                    </option>
                  ))}
                </datalist>
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
              <p className="text-center text-slate-300">
                From <strong>{activeTrip.station}</strong>
              </p>
              <p className="text-center text-slate-400">
                Started at{" "}
                {new Date(activeTrip.startTime).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
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
          <table className="w-full text-sm text-slate-200 border-collapse">
            <thead>
              <tr className="border-b border-slate-700">
                <th>🕓 Time</th>
                <th>Action</th>
                <th>Station</th>
              </tr>
            </thead>
            <tbody>
              {serverLogs
                .filter((r) => r.user_id === user.id)
                .slice(-20)
                .reverse()
                .map((r) => (
                  <tr key={r.id} className="border-b border-slate-800">
                    <td>
                      {new Date(r.timestamp).toLocaleString([], {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                    <td>{r.action}</td>
                    <td>{r.station}</td>
                  </tr>
                ))}
            </tbody>
          </table>
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

