// src/hooks/useStations.js
import { useEffect, useState } from "react";

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

  // Load stations once
  useEffect(() => {
    async function loadStations() {
      try {
        const res = await fetch(GIST_URL);
        const text = await res.text();

        const lines = text.trim().split("\n").slice(1); // skip header
        const parsed = lines
          .map((line) => {
            const [lng, lat, type, lineName, name] = line.split(",");
            const latNum = parseFloat(lat);
            const lonNum = parseFloat(lng);
            if (isNaN(latNum) || isNaN(lonNum)) return null;
            return { lat: latNum, lon: lonNum, line: lineName, name };
          })
          .filter(Boolean);

        setStations(parsed);
      } catch (err) {
        console.error("Failed to load stations:", err);
      }
    }
    loadStations();
  }, []);

  // Compute nearest station whenever position changes
  useEffect(() => {
    if (!pos || !pos.lat || !pos.lon || stations.length === 0) return;

    let closest = null;
    let minDist = Infinity;

    for (const s of stations) {
      const d = distance(pos.lat, pos.lon, s.lat, s.lon);
      if (d < minDist) {
        minDist = d;
        closest = { ...s, distance: d };
      }
    }

    setNearest(closest);
  }, [pos, stations]);

  return nearest;
}
