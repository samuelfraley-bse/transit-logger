import React, { useEffect, useState } from "react";
import { db, K, uid } from "./db.js";
import { useGeolocation } from "./hooks/useGeolocation.js";
import { useNearestStation } from "./hooks/useStations.js";
import { postLogs, fetchRecentLogs } from "./api.js";
import MapView from "./components/MapView.jsx";
import toast, { Toaster } from "react-hot-toast";

export default function App() {
  // --- State ---
  const [deviceId, setDeviceId] = useState(null);
  const [user, setUser] = useState("");
  const [car, setCar] = useState("");
  const [outbox, setOutbox] = useState([]);
  const [serverLogs, setServerLogs] = useState([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [activeTab, setActiveTab] = useState("log");
  const [stations, setStations] = useState([]);
  const [filteredStations, setFilteredStations] = useState([]);
  const [selectedLine, setSelectedLine] = useState("");
  const [selectedStationOn, setSelectedStationOn] = useState("");
  const [selectedStationOff, setSelectedStationOff] = useState("");
  const [autoFilled, setAutoFilled] = useState(false);
  const [activeTrip, setActiveTrip] = useState(null);

  const pos = useGeolocation();
  const nearest = useNearestStation(pos);

  // --- Load stations from CSV ---
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
        setFilteredStations(parsed);
      })
      .catch((err) => console.error("Failed to load stations", err));
  }, []);

  // --- Load persistent device ID ---
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

  // --- Auto-select nearest station once ---
  useEffect(() => {
    if (!autoFilled && nearest?.name) {
      setSelectedStationOn(nearest.name);
      setAutoFilled(true);
    }
  }, [nearest, autoFilled]);

  // --- Detect online/offline ---
  useEffect(() => {
    const set = () => setOnline(navigator.onLine);
    window.addEventListener("online", set);
    window.addEventListener("offline", set);
    return () => {
      window.removeEventListener("online", set);
      window.removeEventListener("offline", set);
    };
  }, []);

  // --- Auto-sync when back online ---
  useEffect(() => {
    if (online) {
      console.log("📡 Back online, syncing...");
      syncNow();
    }
  }, [online]);

  // --- Load saved preferences for user ---
  useEffect(() => {
    if (!user) return;
    (async () => {
      const key = `prefs_${user}`;
      const saved = (await db.getItem(key)) || {};
      if (saved.car) setCar(saved.car);
      if (saved.selectedStationOn) setSelectedStationOn(saved.selectedStationOn);
      if (saved.selectedStationOff) setSelectedStationOff(saved.selectedStationOff);
      if (saved.selectedLine) setSelectedLine(saved.selectedLine);
    })();
  }, [user]);

  // --- Save preferences when filters change ---
  useEffect(() => {
    if (!user) return;
    const key = `prefs_${user}`;
    const prefs = {
      car,
      selectedStationOn,
      selectedStationOff,
      selectedLine,
    };
    db.setItem(key, prefs);
  }, [user, car, selectedStationOn, selectedStationOff, selectedLine]);

  // --- Load active trip on startup ---
  useEffect(() => {
    db.getItem("activeTrip").then((trip) => {
      if (trip) {
        setActiveTrip(trip);
        setUser(trip.user);
        setSelectedStationOn(trip.stationOn);
        setSelectedLine(trip.line);
      }
    });
  }, []);

  // --- Filter stations dynamically (when line changes) ---
  useEffect(() => {
    if (!selectedLine || selectedLine === "Other") {
      setFilteredStations(stations);
      return;
    }
    const filtered = stations.filter((s) => s.line === selectedLine);
    setFilteredStations(filtered);
  }, [selectedLine, stations]);

  // --- Sync logs ---
  async function syncNow() {
    const pending = (await db.getItem(K.outbox)) || [];
    if (pending.length === 0) return;

    try {
      const res = await postLogs(pending);
      if (res.ok) {
        await db.setItem(K.outbox, []);
        setOutbox([]);
        toast.success("✅ Synced logs to server!");
      } else {
        console.error("Server rejected logs", res.status);
        toast.error("❌ Server rejected logs");
      }
    } catch (err) {
      console.error("Sync failed", err);
      toast.error("⚠️ Sync failed");
    }
  }

  // --- Tap On / Off ---
  async function handleTap(action) {
    if (!user) {
      toast.error("Please select a user.");
      return;
    }

    if (action === "on") {
      if (activeTrip) {
        toast.error("You already have an active trip. Please tap off first.");
        return;
      }
      const trip = {
        id: uid(),
        user,
        stationOn: selectedStationOn || nearest?.name || "Unknown",
        line: selectedLine || "Unknown",
        startTime: new Date().toISOString(),
      };
      await db.setItem("activeTrip", trip);
      setActiveTrip(trip);
      toast.success(`🚇 Trip started at ${trip.stationOn}!`);
    } else if (action === "off") {
      if (!activeTrip) {
        toast.error("No active trip found. Please tap on first.");
        return;
      }

      const entry = {
        id: uid(),
        timestamp: new Date().toISOString(),
        deviceId,
        user,
        car: car || null,
        line: selectedLine || "Unknown",
        action,
        station: selectedStationOff || nearest?.name || "Unknown",
        lat: pos?.lat,
        lon: pos?.lon,
        linkedTrip: activeTrip.id, // ✅ connect the two
      };

      const updated = [...outbox, entry];
      setOutbox(updated);
      await db.setItem(K.outbox, updated);

      await db.removeItem("activeTrip");
      setActiveTrip(null);
      toast.success("🏁 Trip completed!");
    }
  }

  // --- Fetch server logs ---
  useEffect(() => {
    fetchRecentLogs().then(setServerLogs).catch(() => {});
  }, [outbox]);

  // --- Unique Lines ---
  const uniqueLines = [...new Set(stations.map((s) => s.line).filter(Boolean))].sort();

  // --- UI ---
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center py-6 px-4">
      {/* Tabs */}
      <div className="flex justify-center mb-4 gap-3">
        <button
          onClick={() => setActiveTab("log")}
          className={`px-4 py-2 rounded-xl font-semibold ${
            activeTab === "log" ? "bg-blue-600" : "bg-slate-700"
          }`}
        >
          🚇 Log Trip
        </button>
        <button
          onClick={() => setActiveTab("summary")}
          className={`px-4 py-2 rounded-xl font-semibold ${
            activeTab === "summary" ? "bg-blue-600" : "bg-slate-700"
          }`}
        >
          📊 My Trips
        </button>
      </div>

      {/* --- Active Trip Reminder --- */}
      {activeTrip && (
        <div className="bg-yellow-500 text-black text-center p-2 rounded-md mb-3">
          🚇 Active trip in progress: <b>{activeTrip.stationOn}</b> on{" "}
          <b>{activeTrip.line}</b>
        </div>
      )}

      {/* --- LOG TAB --- */}
      {activeTab === "log" && (
        <>
          <div className="max-w-md w-full bg-slate-800/60 p-4 rounded-2xl shadow-lg border border-slate-700">
            <h1 className="text-2xl font-bold text-center mb-2">
              🚇 Barcelona Transit Logger
            </h1>

            {/* --- User selector --- */}
            <div className="mb-3">
              <label className="block text-slate-400 text-sm mb-1">User</label>
              <select
                className="w-full bg-slate-800 text-slate-100 rounded-xl p-2"
                value={user}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "__new__") {
                    const name = prompt("Enter new user name:");
                    if (name) setUser(name.trim());
                  } else {
                    setUser(val);
                  }
                }}
              >
                <option value="">-- Select user --</option>
                <option value="Nicole">Nicole</option>
                <option value="Sam">Sam</option>
                <option value="Sammy">Sammy</option>
                <option value="__new__">➕ Add new user…</option>
              </select>
            </div>

            {/* --- Car number --- */}
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

            {/* --- Tap On Station --- */}
            <div className="mb-4">
              <label className="block text-slate-400 text-sm mb-1">
                Tap On Station
              </label>
              <input
                type="text"
                placeholder="Search or enter station..."
                className="w-full bg-slate-800 text-slate-100 rounded-xl p-2"
                value={selectedStationOn}
                onChange={(e) => setSelectedStationOn(e.target.value)}
                list="stationsOn"
              />
              <datalist id="stationsOn">
                {filteredStations.map((s) => (
                  <option key={`${s.name}-${s.line}`} value={s.name}>
                    {s.name} ({s.line})
                  </option>
                ))}
                <option value="Other">Other</option>
              </datalist>
            </div>

            {/* --- Select Line --- */}
            <div className="mb-4">
              <label className="block text-slate-400 text-sm mb-1">
                Transit Line
              </label>
              <input
                type="text"
                placeholder="Search line..."
                className="w-full bg-slate-800 text-slate-100 rounded-xl p-2"
                value={selectedLine}
                onChange={(e) => setSelectedLine(e.target.value)}
                list="linesList"
              />
              <datalist id="linesList">
                {uniqueLines.map((line) => (
                  <option key={line} value={line}>
                    {line}
                  </option>
                ))}
                <option value="Other">Other</option>
              </datalist>
            </div>

            {/* --- Tap Off Station --- */}
            <div className="mb-4">
              <label className="block text-slate-400 text-sm mb-1">
                Tap Off Station
              </label>
              <input
                type="text"
                placeholder="Search or enter station..."
                className="w-full bg-slate-800 text-slate-100 rounded-xl p-2"
                value={selectedStationOff}
                onChange={(e) => setSelectedStationOff(e.target.value)}
                list="stationsOff"
              />
              <datalist id="stationsOff">
                {filteredStations.map((s) => (
                  <option key={`${s.name}-${s.line}`} value={s.name}>
                    {s.name}
                  </option>
                ))}
                <option value="Other">Other</option>
              </datalist>
            </div>

            {/* --- Map + Info --- */}
            <div className="text-sm text-slate-300 mb-2">
              {pos && pos.lat != null && pos.lon != null ? (
                <>
                  📍 {pos.lat.toFixed(5)}, {pos.lon.toFixed(5)} (±
                  {pos.acc || "?"}m)
                </>
              ) : (
                "Getting location..."
              )}
              <br />
              {nearest ? (
                <span>
                  Nearest station: <b>{nearest.name}</b>
                </span>
              ) : (
                <span>No station nearby</span>
              )}
            </div>

            {pos && pos.lat && pos.lon ? (
              <MapView
                key={`${pos.lat}-${pos.lon}`}
                pos={pos}
                nearest={nearest}
              />
            ) : (
              <div className="text-slate-400 text-sm text-center py-2">
                Waiting for location permission…
              </div>
            )}

            {/* --- Tap Buttons --- */}
            <div className="flex justify-center gap-3 mt-3">
              <button
                onClick={() => handleTap("on")}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-semibold"
              >
                🚇 Tap On
              </button>
              <button
                onClick={() => handleTap("off")}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-semibold"
              >
                🏁 Tap Off
              </button>
            </div>

            {/* --- Sync + Status --- */}
            <div className="flex justify-between items-center mt-3 text-sm">
              <button
                onClick={syncNow}
                className="bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded-lg"
              >
                🔄 Sync Now ({outbox.length})
              </button>
              <div className="flex items-center gap-2">
                <span
                  className={`h-3 w-3 rounded-full ${
                    online ? "bg-green-500" : "bg-red-500"
                  }`}
                ></span>
                {online ? "Online" : "Offline"}
              </div>
            </div>
          </div>
        </>
      )}

      {/* --- SUMMARY TAB --- */}
     {activeTab === "summary" && (
  <div className="max-w-md w-full bg-slate-800/60 p-4 rounded-2xl shadow-lg border border-slate-700 overflow-y-auto max-h-[70vh]">
    <h2 className="text-xl font-bold mb-3">📅 My Trips Summary</h2>

    {(() => {
      const userTrips = serverLogs
        .filter((r) => r.user === user)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      if (userTrips.length === 0)
        return (
          <p className="text-slate-400">
            No trips yet for {user || "this user"}.
          </p>
        );

      // --- Try pairing consecutive on/off for same user ---
      const pairedTrips = [];
      for (let i = 0; i < userTrips.length; i++) {
        const curr = userTrips[i];
        const next = userTrips[i + 1];

        if (curr.action === "on" && next && next.action === "off") {
          pairedTrips.push({
            id: curr.id,
            on: curr,
            off: next,
          });
          i++; // skip next
        } else {
          pairedTrips.push({ id: curr.id, on: curr, off: null });
        }
      }

      // --- Group by relative day ---
      const groups = { today: [], yesterday: [], earlier: [] };
      const now = new Date();
      pairedTrips.forEach((p) => {
        const d = new Date(p.on.timestamp);
        const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
        if (diffDays === 0) groups.today.push(p);
        else if (diffDays === 1) groups.yesterday.push(p);
        else groups.earlier.push(p);
      });

      // --- Render helper ---
      const renderGroup = (title, trips) => {
        if (!trips.length) return null;
        return (
          <div key={title} className="mb-5">
            <h3 className="text-slate-300 text-sm font-semibold mb-2">
              {title}
            </h3>
            <div className="space-y-3">
              {trips.map((p) => {
                const start = new Date(p.on.timestamp);
                const startTime = start.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                });
                const dateLabel = start.toLocaleDateString([], {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                });

                let offTime = null;
                if (p.off) {
                  const end = new Date(p.off.timestamp);
                  offTime = end.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                }

                return (
                  <div
                    key={p.id}
                    className={`rounded-xl border border-slate-600 p-3 bg-gradient-to-br ${
                      p.off
                        ? "from-green-900/40 to-red-900/40"
                        : "from-green-800/30 to-slate-800/30"
                    }`}
                  >
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                      <span>{dateLabel}</span>
                      <span>ID: {p.id.slice(0, 6)}</span>
                    </div>

                    <div className="text-slate-100 font-semibold">
                      {p.on.station}
                      {p.off ? (
                        <>
                          {" "}
                          →{" "}
                          <span className="text-slate-200 font-semibold">
                            {p.off.station}
                          </span>
                        </>
                      ) : (
                        <span className="text-yellow-400 text-xs ml-1">
                          (in progress)
                        </span>
                      )}
                    </div>

                    <div className="text-slate-400 text-xs mt-1">
                      {p.on.line || "?"} | {startTime}
                      {offTime && ` → ${offTime}`}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      };

      return (
        <>
          {renderGroup("Today", groups.today)}
          {renderGroup("Yesterday", groups.yesterday)}
          {renderGroup("Earlier", groups.earlier)}
        </>
      );
    })()}
  </div>
)}




      <Toaster position="bottom-center" />
    </div>
  );
}
