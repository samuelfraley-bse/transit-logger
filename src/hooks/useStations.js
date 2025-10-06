import { useEffect, useState, useRef } from "react";

const GIST_URL =
  "https://gist.githubusercontent.com/martgnz/1e5d9eb712075d8b8c6f7772a95a59f1/raw/data.csv";

// Haversine distance in meters
function distance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function useNearestStation(pos) {
  const [stations, setStations] = useState([]);
  const [nearest, setNearest] = useState(null);
  const hasLoaded = useRef(false);

  // ✅ Load station list once
  useEffect(() => {
    if (hasLoaded.current) return;
    hasLoaded.current = true;

    async function loadStations() {
      try {
        console.log("📡 Fetching stations CSV...");
        const res = await fetch(GIST_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();

        // ✅ Clean BOM + normalize newlines
        const cleanCsv = text.replace(/^\uFEFF/, "").trim();
        const lines = cleanCsv.split("\n").slice(1);
        const parsed = lines
          .map((row) => {
            const [lng, lat, type, line, name] = row.split(",").map((v) => v.trim());
            if (!line || !name || isNaN(+lat) || isNaN(+lng)) return null;
            return { lng: +lng, lat: +lat, type, line, name };
          })
          .filter(Boolean);

        console.log("✅ Loaded stations:", parsed.length);
        console.log("🧭 First few:", parsed.slice(0, 5));
        setStations(parsed);
      } catch (err) {
        console.error("❌ Failed to load stations:", err);
      }
    }

    loadStations();
  }, []);

  // ✅ Compute nearest station when position changes
  useEffect(() => {
    if (!pos?.lat || !pos?.lon || stations.length === 0) return;

    let closest = null;
    let minDist = Infinity;

    for (const s of stations) {
      const d = distance(pos.lat, pos.lon, s.lat, s.lng);
      if (d < minDist) {
        minDist = d;
        closest = { ...s, distance: d };
      }
    }

    setNearest(closest);
  }, [pos?.lat, pos?.lon, stations]);

  return nearest;
}
