import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export default function MapView({ position, stations = [], nearest, tripState }) {
  const mapRef = useRef(null);
  const userMarkerRef = useRef(null);
  const stationLayerRef = useRef(null);

  // --- Initialize map once ---
  useEffect(() => {
    if (mapRef.current) return;

    mapRef.current = L.map("map", {
      center: [41.3851, 2.1734],
      zoom: 13,
      zoomControl: true,
    });

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 19,
      }
    ).addTo(mapRef.current);

    userMarkerRef.current = L.layerGroup().addTo(mapRef.current);
    stationLayerRef.current = L.layerGroup().addTo(mapRef.current);

    return () => {
      mapRef.current.remove();
      mapRef.current = null;
    };
  }, []);

  // --- Inject pulsing CSS once ---
  useEffect(() => {
    if (document.getElementById("pulse-style")) return;
    const style = document.createElement("style");
    style.id = "pulse-style";
    style.innerHTML = `
      @keyframes pulseRing {
        0% { transform: scale(0.6); opacity: 0.9; }
        70% { transform: scale(1.8); opacity: 0; }
        100% { opacity: 0; }
      }

      .pulse-wrapper {
        position: relative;
        width: 16px;
        height: 16px;
      }

      .pulse-ring {
        position: absolute;
        top: 0; left: 0;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: rgba(0, 212, 255, 0.4);
        animation: pulseRing 2s infinite ease-out;
      }

      .pulse-core {
        position: absolute;
        top: 4px; left: 4px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #00d4ff;
        box-shadow: 0 0 10px rgba(0, 212, 255, 0.9);
      }
    `;
    document.head.appendChild(style);
  }, []);

  // --- Update user marker ---
  useEffect(() => {
    if (!mapRef.current || !position?.lat || !position?.lon) return;
    const map = mapRef.current;
    const layer = userMarkerRef.current;
    layer.clearLayers();

    // 🔵 Composite marker: glowing ring + core
    const markerHTML = `
      <div class="pulse-wrapper">
        <div class="pulse-ring"></div>
        <div class="pulse-core"></div>
      </div>
    `;
    const div = L.divIcon({
      className: "",
      html: markerHTML,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });

    L.marker([position.lat, position.lon], { icon: div }).addTo(layer);

    // Optional accuracy circle
    if (position.acc) {
      L.circle([position.lat, position.lon], {
        radius: position.acc,
        color: "#00d4ff33",
        fillColor: "#00d4ff22",
        fillOpacity: 0.15,
      }).addTo(layer);
    }

    map.setView([position.lat, position.lon], map.getZoom());
  }, [position]);

  // --- Station markers ---
  useEffect(() => {
    if (!mapRef.current || stations.length === 0) return;
    const layer = stationLayerRef.current;
    layer.clearLayers();

    stations.forEach((s) => {
      if (!s.lat || !s.lng) return;
      L.circleMarker([s.lat, s.lng], {
        radius: 4,
        color: s.name === nearest?.name ? "yellow" : "#999",
        fillColor: s.name === nearest?.name ? "yellow" : "#555",
        fillOpacity: s.name === nearest?.name ? 0.9 : 0.6,
      })
        .addTo(layer)
        .bindPopup(`<b>${s.name}</b><br/>Line: ${s.line}`);
    });
  }, [stations, nearest]);

  return (
    <div
      id="map"
      className="rounded-xl border border-slate-700"
      style={{ height: "300px", width: "100%" }}
    ></div>
  );
}
