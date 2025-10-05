// src/components/MapView.jsx
import React, { useEffect, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

const GIST_URL =
  "https://gist.githubusercontent.com/martgnz/1e5d9eb712075d8b8c6f7772a95a59f1/raw/data.csv";

export default function MapView({ pos, nearest }) {
  const [stations, setStations] = useState([]);

  // --- Load the CSV with known structure ---
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
            const lngNum = parseFloat(lng);
            if (isNaN(latNum) || isNaN(lngNum)) return null;
            return { lat: latNum, lng: lngNum, line: lineName, name };
          })
          .filter(Boolean);

        setStations(parsed);
        console.log("Loaded stations:", parsed.length);
      } catch (err) {
        console.error("Failed to load stations:", err);
      }
    }
    loadStations();
  }, []);

  if (!pos || !pos.lat || !pos.lon)
    return (
      <div className="text-slate-400 text-sm text-center py-2">
        Waiting for location…
      </div>
    );

  return (
    <div className="mt-3 rounded-xl overflow-hidden">
      <MapContainer
        center={[pos.lat, pos.lon]}
        zoom={13}
        scrollWheelZoom={false}
        style={{ height: "250px", width: "100%", borderRadius: "12px" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />

        {/* --- User Position --- */}
        <CircleMarker
          center={[pos.lat, pos.lon]}
          radius={8}
          color="#00FFFF"
          fillColor="#00FFFF"
          fillOpacity={0.8}
        >
          <Popup>Your current location</Popup>
        </CircleMarker>

        {/* --- Nearest Station Highlight --- */}
        {nearest && (
          <CircleMarker
            center={[nearest.lat, nearest.lon]}
            radius={10}
            color="#FFD700"
            fillColor="#FFD700"
            fillOpacity={0.9}
          >
            <Popup>Nearest: {nearest.name}</Popup>
          </CircleMarker>
        )}

        {/* --- All Stations --- */}
        {stations.map((s, i) => (
          <CircleMarker
            key={i}
            center={[s.lat, s.lng]}
            radius={4}
            color="#00FF88"
            fillColor="#00FF88"
            fillOpacity={0.7}
          >
            <Popup>
              <b>{s.name}</b> <br />
              Line {s.line}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
