// src/App.jsx
import React, { useEffect, useState } from "react";
import { db, K, uid } from "./db.js";
import { useGeolocation } from "./hooks/useGeolocation.js";
import { useNearestStation } from "./hooks/useStations.js";
import { postLogs, fetchRecentLogs } from "./api.js";
import MapView from "./components/MapView.jsx";

export default function App() {
  const [deviceId, setDeviceId] = useState(null);
  const [user, setUser] = useState("");
  const [car, setCar] = useState(""); // ✅ added car state
  const [outbox, setOutbox] = useState([]);
  const [serverLogs, setServerLogs] = useState([]);
  const [online, setOnline] = useState(navigator.onLine);

  const pos = useGeolocation();
  const nearest = useNearestStation(pos);

  // --- Setup persistent device ID ---
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

  // --- Sync logs to server ---
  async function syncNow() {
    const pending = (await db.getItem(K.outbox)) || [];
    if (pending.length === 0) return;

    try {
      const res = await postLogs(pending);
      if (res.ok) {
        await db.setItem(K.outbox, []);
        setOutbox([]);
        console.log("✅ Synced logs to server");
      } else {
        console.error("Server rejected logs", res.status);
      }
    } catch (err) {
      console.error("Sync failed", err);
    }
  }

 // --- Tap On / Tap Off (Supabase) ---
async function handleTap(action) {
  if (!user || !nearest) {
    alert("Please select your name and allow location access.");
    return;
  }

  try {
    const userId = await ensureUser(user);

    const entry = {
      device_id: deviceId,
      user_id: userId,
      car: car || null,
      action,
      station: nearest.name,
      lat: pos?.lat,
      lon: pos?.lon,
    };

    await postLogs([entry]);
    console.log("✅ Log saved to Supabase:", entry);

    // refresh logs list
    const logs = await fetchRecentLogs();
    setServerLogs(logs);
  } catch (err) {
    console.error("❌ Failed to save log:", err);
  }
}


  // --- Fetch recent logs from server ---
  useEffect(() => {
    fetchRecentLogs().then(setServerLogs).catch(() => {});
  }, [outbox]);

  // --- Render ---
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center py-6 px-4">
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

        {/* --- Optional Car Number --- */}
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

        {/* --- Location + Station --- */}
        <div className="text-sm text-slate-300">
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

        {/* --- Map --- */}
        {pos && pos.lat && pos.lon ? (
          <MapView key={`${pos.lat}-${pos.lon}`} pos={pos} nearest={nearest} />
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

        {/* --- Sync + Online Status --- */}
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

      {/* --- Recent Logs --- */}
      <div className="max-w-md w-full bg-slate-800/60 mt-6 p-4 rounded-2xl border border-slate-700">
        <h2 className="font-semibold mb-2 text-lg">🕒 Recent (Server)</h2>
        <div className="text-sm">
          {serverLogs.length === 0 ? (
            <p className="text-slate-400">No logs yet.</p>
          ) : (
            <table className="w-full text-left text-slate-200 text-sm">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Station</th>
                  <th>Car</th>
                </tr>
              </thead>
              <tbody>
                {serverLogs.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.timestamp).toLocaleTimeString()}</td>
                    <td>{r.user || "-"}</td>
                    <td>{r.action}</td>
                    <td>{r.station}</td>
                    <td>{r.car || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {deviceId && (
          <p className="text-xs text-slate-500 mt-3">Device: {deviceId}</p>
        )}
      </div>
    </div>
  );
}
