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
  const [selectedStationOn, setSelectedStationOn] = useState("");
  const [selectedStationOff, setSelectedStationOff] = useState("");

  const pos = useGeolocation();
  const nearest = useNearestStation(pos);

  // --- Load stations from gist ---
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

  // --- Auto-select nearest station ---
  useEffect(() => {
    if (nearest && nearest.name) {
      setSelectedStationOn(nearest.name);
    }
  }, [nearest]);

  // --- Persistent device ID ---
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

  // --- Filter stations while typing ---
  const handleStationSearch = (e, setter) => {
    const value = e.target.value.toLowerCase();
    setter(value);
    const filtered = stations.filter((s) =>
      s.name.toLowerCase().includes(value)
    );
    setFilteredStations(filtered);
  };

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

    const station =
      action === "on"
        ? selectedStationOn || nearest?.name
        : selectedStationOff || nearest?.name;

    const entry = {
      id: uid(),
      timestamp: new Date().toISOString(),
      deviceId,
      user,
      car: car || null,
      action,
      station: station || "Unknown",
      lat: pos?.lat,
      lon: pos?.lon,
    };

    const updated = [...outbox, entry];
    setOutbox(updated);
    await db.setItem(K.outbox, updated);

    toast.success(`✅ Tap ${action.toUpperCase()} recorded!`);
  }

  // --- Fetch server logs ---
  useEffect(() => {
    fetchRecentLogs().then(setServerLogs).catch(() => {});
  }, [outbox]);

  // --- UI ---
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center py-6 px-4">
      {/* --- Tabs --- */}
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

      {/* --- LOG TAB --- */}
      {activeTab === "log" && (
        <>
          <div className="max-w-md w-full bg-slate-800/60 p-4 rounded-2xl shadow-lg space-y-3 border border-slate-700">
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
    placeholder="Search station..."
    className="w-full bg-slate-800 text-slate-100 rounded-xl p-2"
    value={selectedStationOn}
    onChange={(e) => setSelectedStationOn(e.target.value)}
    list="stationsOn"
  />
  <datalist id="stationsOn">
    {stations.map((s) => (
      <option key={s.name} value={s.name}>
        {s.name} ({s.line})
      </option>
    ))}
  </datalist>
</div>

{/* --- Tap Off Station --- */}
<div className="mb-4">
  <label className="block text-slate-400 text-sm mb-1">
    Tap Off Station
  </label>
  <input
    type="text"
    placeholder="Search station..."
    className="w-full bg-slate-800 text-slate-100 rounded-xl p-2"
    value={selectedStationOff}
    onChange={(e) => setSelectedStationOff(e.target.value)}
    list="stationsOff"
  />
  <datalist id="stationsOff">
    {stations.map((s) => (
      <option key={s.name} value={s.name}>
        {s.name} ({s.line})
      </option>
    ))}
  </datalist>
</div>


            {/* --- Map --- */}
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
              <MapView key={`${pos.lat}-${pos.lon}`} pos={pos} nearest={nearest} />
            ) : (
              <div className="text-slate-400 text-sm text-center py-2">
                Waiting for location permission…
              </div>
            )}

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

          {/* --- Local Logs --- */}
          <div className="max-w-md w-full bg-slate-800/60 mt-6 p-4 rounded-2xl border border-slate-700">
            <h2 className="font-semibold mb-2 text-lg">🕒 Recent (Local)</h2>
            <div className="text-sm">
              {outbox.filter((r) => r.user === user).length === 0 ? (
                <p className="text-slate-400">
                  No local logs for {user || "this user"}.
                </p>
              ) : (
                <table className="w-full text-left text-slate-200 text-sm">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Action</th>
                      <th>Station</th>
                      <th>Car</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outbox
                      .filter((r) => r.user === user)
                      .slice(-10)
                      .reverse()
                      .map((r) => (
                        <tr key={r.id}>
                          <td>{new Date(r.timestamp).toLocaleTimeString()}</td>
                          <td>{r.action}</td>
                          <td>{r.station}</td>
                          <td>{r.car || "-"}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}

      {/* --- SUMMARY TAB --- */}
      {activeTab === "summary" && (
        <div className="max-w-md w-full bg-slate-800/60 p-4 rounded-2xl shadow-lg border border-slate-700">
          <h2 className="text-xl font-bold mb-3">📊 My Trips Summary</h2>
          {serverLogs.filter((r) => r.user === user).length === 0 ? (
            <p className="text-slate-400">
              No trips yet for {user || "this user"}.
            </p>
          ) : (
            <table className="w-full text-sm text-slate-200 border-collapse">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left py-1">🕓 Time</th>
                  <th className="text-left py-1">Action</th>
                  <th className="text-left py-1">Station</th>
                  <th className="text-left py-1">Car</th>
                </tr>
              </thead>
              <tbody>
                {serverLogs
                  .filter((r) => r.user === user)
                  .slice(-10)
                  .reverse()
                  .map((r) => (
                    <tr key={r.id} className="border-b border-slate-800">
                      <td>{new Date(r.timestamp).toLocaleTimeString()}</td>
                      <td>{r.action}</td>
                      <td>{r.station}</td>
                      <td>{r.car || "-"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <Toaster position="bottom-center" />
    </div>
  );
}
