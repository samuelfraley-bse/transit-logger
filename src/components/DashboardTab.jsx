import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  RadialBarChart,
  RadialBar,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as ReTooltip,
  ResponsiveContainer,
  PolarAngleAxis,
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

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from("logs_clean_v")
          .select("timestamp, lat, lon, station, line, action, email, car")
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
      const dow = d.getDay(); // 0..6
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

  return (
    <div className="p-6 space-y-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Transit Dashboard</h1>
        <div className="text-sm opacity-70">View: <code>logs_clean_v</code></div>
      </header>

      {loading && <div className="text-sm opacity-70">Loading…</div>}
      {error && (
        <div className="rounded-xl border p-3 bg-red-50 text-red-700">{String(error)}</div>
      )}

      {/* HEATMAP (point cloud via CircleMarker for simplicity) */}
      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Tap locations</h2>
        <div className="h-[420px] rounded-2xl overflow-hidden border">
          <MapContainer
          center={[41.387, 2.17]} // Barcelona
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

      {/* RADIAL: taps by hour */}
      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Taps by time of day</h2>
        <div className="h-[360px] rounded-2xl border p-4">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart innerRadius="25%" outerRadius="85%" data={byHour} startAngle={90} endAngle={-270}>
              <PolarAngleAxis type="number" domain={[0, 23]} tick={{ fontSize: 12 }} tickFormatter={(v) => `${v}:00`} />
              <ReTooltip formatter={(v, _n, p) => [v, `${p?.payload?.hour}:00`]} />
              <RadialBar dataKey="count" fill="#60a5fa" stroke="none" />
            </RadialBarChart>
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
