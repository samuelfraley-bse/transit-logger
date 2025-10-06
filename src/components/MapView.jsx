import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export default function MapView({ position, stations = [], nearest }) {
  const mapRef = useRef(null);
  const userMarkerRef = useRef(null);
  const stationLayerRef = useRef(null);

  // --- Initialize the map ONCE ---
  useEffect(() => {
    if (mapRef.current) return; // already created

    mapRef.current = L.map("map", {
      center: [41.3851, 2.1734], // Barcelona default
      zoom: 13,
      zoomControl: true,
    });

    // 🗺️ CartoDB Dark Matter (HTTPS-safe)
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 19,
      }
    ).addTo(mapRef.current);

    // create empty layer groups
    userMarkerRef.current = L.layerGroup().addTo(mapRef.current);
    stationLayerRef.current = L.layerGroup().addTo(mapRef.current);

    return () => {
      mapRef.current.remove();
      mapRef.current = null;
    };
  }, []);

  // --- Update user marker when position changes ---
  useEffect(() => {
    if (!mapRef.current || !position?.lat || !position?.lon) return;

    const map = mapRef.current;
    const layer = userMarkerRef.current;
    layer.clearLayers();

    // user location marker
    L.circleMarker([position.lat, position.lon], {
      radius: 8,
      color: "#00d4ff",
      fillColor: "#00d4ff",
      fillOpacity: 0.8,
    }).addTo(layer);

    // accuracy circle
    if (position.acc) {
      L.circle([position.lat, position.lon], {
        radius: position.acc,
        color: "#00d4ff33",
        fillColor: "#00d4ff22",
        fillOpacity: 0.2,
      }).addTo(layer);
    }

    // pan smoothly to new position
    map.setView([position.lat, position.lon], map.getZoom());
  }, [position]);

  // --- Update stations and nearest highlight ---
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
