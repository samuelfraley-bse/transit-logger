import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as ReTooltip,
  ResponsiveContainer,
} from "recharts";

// Row type (JS-style JSDoc for clarity)
/**
 * @typedef {Object} LogRow
 * @property {string} timestamp
 * @property {number|null} lat
 * @property {number|null} lon
 * @property {string|null} station
 * @property {string|null} line
 * @property {string|null} action
 * @property {string|null} email
 * @property {string|null} car
 * @property {string|null} journey_id
 */

function countBy(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (k == null) continue;
    const key = String(k).trim();
    if (!key) continue;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map.entries()).map(([key, count]) => ({ key, count }));
}

function topN(arr, n = 5) {
  return arr.slice(0, n);
}

function weekdayLabel(i) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][i] ?? String(i);
}

export default function DashboardTab() {
  const [rows, setRows] = useState(/** @type {LogRow[]|null} */(null));
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  
  // Settings with defaults from localStorage
  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem('dashboardSettings');
    return saved ? JSON.parse(saved) : {
      perTripCost: 2,
      tjoveCost: 45,
      co2PerMinute: 6.7,
    };
  });
  
  const [tempSettings, setTempSettings] = useState(settings);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from("logs_clean_v")
          .select("timestamp, lat, lon, station, line, action, email, car, journey_id")
          .limit(20000);
        if (error) throw error;
        if (isMounted) setRows(data ?? []);
      } catch (e) {
        if (isMounted) setError(e?.message ?? String(e));
      } finally {
        if (isMounted) setLoading(false);
      }
    })();
    return () => { isMounted = false; };
  }, []);

  const saveSettings = () => {
    setSettings(tempSettings);
    localStorage.setItem('dashboardSettings', JSON.stringify(tempSettings));
    setShowSettings(false);
  };

  const points = useMemo(() =>
    (rows ?? []).filter(r => typeof r.lat === "number" && typeof r.lon === "number"),
  [rows]);

  const byHour = useMemo(() => {
    const counts = new Array(24).fill(0);
    for (const r of rows ?? []) {
      const d = new Date(r.timestamp);
      const h = d.getHours();
      if (!Number.isNaN(h)) counts[h]++;
    }
    return counts.map((count, hour) => ({ hour, count }));
  }, [rows]);

  const byDow = useMemo(() => {
    const counts = new Array(7).fill(0);
    for (const r of rows ?? []) {
      const d = new Date(r.timestamp);
      const dow = d.getDay();
      if (!Number.isNaN(dow)) counts[dow]++;
    }
    return counts.map((count, dow) => ({ dow, label: weekdayLabel(dow), count }));
  }, [rows]);

  const topStations = useMemo(() => {
    const counts = countBy(rows ?? [], r => r.station);
    counts.sort((a, b) => b.count - a.count);
    return topN(counts, 5);
  }, [rows]);

  const topLines = useMemo(() => {
    const counts = countBy(rows ?? [], r => r.line);
    counts.sort((a, b) => b.count - a.count);
    return topN(counts, 5);
  }, [rows]);

  const carLeaders = useMemo(() => {
    const counts = countBy(rows ?? [], r => r.car);
    counts.sort((a, b) => b.count - a.count);
    return topN(counts, 20);
  }, [rows]);

  const userLeaders = useMemo(() => {
    const counts = countBy(rows ?? [], r => r.email);
    counts.sort((a, b) => b.count - a.count);
    return topN(counts, 20);
  }, [rows]);

  // NEW INSIGHTS
  const avgCommuteTime = useMemo(() => {
    const journeys = new Map();
    
    for (const r of rows ?? []) {
      if (!r.journey_id) continue;
      if (!journeys.has(r.journey_id)) {
        journeys.set(r.journey_id, { on: null, off: null });
      }
      const journey = journeys.get(r.journey_id);
      if (r.action === 'on') journey.on = new Date(r.timestamp);
      if (r.action === 'off') journey.off = new Date(r.timestamp);
    }
    
    const durations = [];
    for (const journey of journeys.values()) {
      if (journey.on && journey.off) {
        const minutes = (journey.off - journey.on) / (1000 * 60);
        if (minutes > 0 && minutes < 180) {
          durations.push(minutes);
        }
      }
    }
    
    if (durations.length === 0) return null;
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    return Math.round(avg);
  }, [rows]);

  const tjoveSavings = useMemo(() => {
    const journeys = new Map();
    
    for (const r of rows ?? []) {
      if (!r.journey_id) continue;
      if (!journeys.has(r.journey_id)) {
        journeys.set(r.journey_id, { hasOn: false, hasOff: false });
      }
      const journey = journeys.get(r.journey_id);
      if (r.action === 'on') journey.hasOn = true;
      if (r.action === 'off') journey.hasOff = true;
    }
    
    const completeJourneys = Array.from(journeys.values())
      .filter(j => j.hasOn && j.hasOff).length;
    
    const wouldHavePaid = completeJourneys * settings.perTripCost;
    const saved = wouldHavePaid - settings.tjoveCost;
    const roi = settings.tjoveCost > 0 ? ((saved / settings.tjoveCost) * 100) : 0;
    
    return {
      completeJourneys,
      saved,
      roi,
      wouldHavePaid
    };
  }, [rows, settings]);

  const co2Saved = useMemo(() => {
    const journeys = new Map();
    
    for (const r of rows ?? []) {
      if (!r.journey_id) continue;
      if (!journeys.has(r.journey_id)) {
        journeys.set(r.journey_id, { on: null, off: null });
      }
      const journey = journeys.get(r.journey_id);
      if (r.action === 'on') journey.on = new Date(r.timestamp);
      if (r.action === 'off') journey.off = new Date(r.timestamp);
    }
    
    let totalMinutes = 0;
    for (const journey of journeys.values()) {
      if (journey.on && journey.off) {
        const minutes = (journey.off - journey.on) / (1000 * 60);
        if (minutes > 0 && minutes < 180) {
          totalMinutes += minutes;
        }
      }
    }
    
    const gramsOfCO2 = totalMinutes * settings.co2PerMinute;
    const kg = gramsOfCO2 / 1000;
    
    return Math.round(kg * 10) / 10;
  }, [rows, settings]);

  return (
    <div className="p-6 space-y-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Transit Dashboard</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setTempSettings(settings);
              setShowSettings(true);
            }}
            className="px-3 py-1.5 text-sm rounded-lg border hover:bg-gray-50 transition-colors"
          >
            ⚙️ Settings
          </button>
          <div className="text-sm opacity-70">View: <code>logs_clean_v</code></div>
        </div>
      </header>

      {loading && <div className="text-sm opacity-70">Loading…</div>}
      {error && (
        <div className="rounded-xl border p-3 bg-red-50 text-red-700">{String(error)}</div>
      )}

      {/* INSIGHT CARDS */}
      {!loading && !error && (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-2xl border p-6 bg-gradient-to-br from-blue-50 to-white">
            <div className="text-sm font-medium text-blue-600 mb-1">Average Commute</div>
            <div className="text-3xl font-bold text-gray-900">
              {avgCommuteTime !== null ? `${avgCommuteTime} min` : '—'}
            </div>
            <div className="text-xs text-gray-500 mt-1">per journey</div>
          </div>
          
          <div className="rounded-2xl border p-6 bg-gradient-to-br from-green-50 to-white">
            <div className="text-sm font-medium text-green-600 mb-1">T-jove Savings</div>
            <div className="text-3xl font-bold text-gray-900">
              {tjoveSavings.saved > 0 ? `€${tjoveSavings.saved}` : '—'}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {tjoveSavings.completeJourneys} trips • {Math.round(tjoveSavings.roi)}% ROI
            </div>
          </div>
          
          <div className="rounded-2xl border p-6 bg-gradient-to-br from-emerald-50 to-white">
            <div className="text-sm font-medium text-emerald-600 mb-1">CO₂ Saved</div>
            <div className="text-3xl font-bold text-gray-900">
              {co2Saved > 0 ? `${co2Saved} kg` : '—'}
            </div>
            <div className="text-xs text-gray-500 mt-1">vs. driving</div>
          </div>
        </section>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-semibold mb-4">Dashboard Settings</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Single Trip Cost (€)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={tempSettings.perTripCost}
                  onChange={(e) => setTempSettings({...tempSettings, perTripCost: parseFloat(e.target.value) || 0})}
                  className="w-full px-3 py-2 border rounded-lg"
                />
                <p className="text-xs text-gray-500 mt-1">Cost per trip without T-jove</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  T-jove Monthly Cost (€)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={tempSettings.tjoveCost}
                  onChange={(e) => setTempSettings({...tempSettings, tjoveCost: parseFloat(e.target.value) || 0})}
                  className="w-full px-3 py-2 border rounded-lg"
                />
                <p className="text-xs text-gray-500 mt-1">Monthly T-jove pass cost</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  CO₂ per minute (grams)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={tempSettings.co2PerMinute}
                  onChange={(e) => setTempSettings({...tempSettings, co2PerMinute: parseFloat(e.target.value) || 0})}
                  className="w-full px-3 py-2 border rounded-lg"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Car emissions (default: 6.7g/min = 200g/km @ 30km/h)
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowSettings(false)}
                className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={saveSettings}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HEATMAP */}
      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Tap locations</h2>
        <div className="h-[420px] rounded-2xl overflow-hidden border">
          <MapContainer
            center={[41.387, 2.17]}
            zoom={12}
            className="h-full w-full"
            scrollWheelZoom={false}
            doubleClickZoom={false}
            dragging={false}
            boxZoom={false}
            keyboard={false}
            zoomControl={false}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {points.slice(0, 5000).map((p, i) => (
              <CircleMarker key={i} center={[p.lat, p.lon]} radius={3}>
                <Tooltip>
                  <div className="text-xs">{p.station || "(unknown station)"}</div>
                </Tooltip>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>
      </section>

      {/* BAR: taps by hour */}
      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Taps by time of day</h2>
        <div className="h-[360px] rounded-2xl border p-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byHour}>
              <XAxis 
                dataKey="hour" 
                tickFormatter={(h) => `${h}:00`}
                interval={1}
              />
              <YAxis allowDecimals={false} />
              <ReTooltip 
                labelFormatter={(h) => `${h}:00`}
                formatter={(value) => [value, 'Taps']}
              />
              <Bar dataKey="count" fill="#60a5fa" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* BAR: taps by weekday */}
      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Taps by weekday</h2>
        <div className="h-[320px] rounded-2xl border p-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byDow}>
              <XAxis dataKey="label" />
              <YAxis allowDecimals={false} />
              <ReTooltip />
              <Bar dataKey="count" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* CALLOUTS */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl border p-4">
          <div className="text-sm opacity-70">Top stations</div>
          <ol className="mt-2 space-y-1 list-decimal list-inside">
            {topStations.map((s) => (
              <li key={s.key} className="flex justify-between">
                <span className="truncate pr-2">{s.key}</span>
                <span className="tabular-nums">{s.count}</span>
              </li>
            ))}
            {topStations.length === 0 && <div className="opacity-60">No station data</div>}
          </ol>
        </div>
        <div className="rounded-2xl border p-4">
          <div className="text-sm opacity-70">Top lines</div>
          <ol className="mt-2 space-y-1 list-decimal list-inside">
            {topLines.map((s) => (
              <li key={s.key} className="flex justify-between">
                <span className="truncate pr-2">{s.key}</span>
                <span className="tabular-nums">{s.count}</span>
              </li>
            ))}
            {topLines.length === 0 && <div className="opacity-60">No line data</div>}
          </ol>
        </div>
      </section>

      {/* LEADERBOARDS */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl border p-4">
          <h3 className="text-lg font-semibold mb-2">Most ridden car numbers</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-1">Car</th>
                <th className="py-1">Taps</th>
              </tr>
            </thead>
            <tbody>
              {carLeaders.map((r) => (
                <tr key={r.key} className="border-b last:border-0">
                  <td className="py-1">{r.key}</td>
                  <td className="py-1 tabular-nums">{r.count}</td>
                </tr>
              ))}
              {carLeaders.length === 0 && (
                <tr><td colSpan={2} className="py-2 opacity-60">No car data</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="rounded-2xl border p-4">
          <h3 className="text-lg font-semibold mb-2">Top users (by taps)</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-1">User (email)</th>
                <th className="py-1">Taps</th>
              </tr>
            </thead>
            <tbody>
              {userLeaders.map((r) => (
                <tr key={r.key} className="border-b last:border-0">
                  <td className="py-1">{r.key}</td>
                  <td className="py-1 tabular-nums">{r.count}</td>
                </tr>
              ))}
              {userLeaders.length === 0 && (
                <tr><td colSpan={2} className="py-2 opacity-60">No user data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}