// src/hooks/useGeolocation.js
import { useEffect, useState } from "react";

export function useGeolocation() {
  const [pos, setPos] = useState(null);
  const [status, setStatus] = useState("Waiting for location permission...");

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setStatus("Geolocation not supported");
      return;
    }

    // Ask explicitly first — ensures permission popup always shows
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos({
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          acc: p.coords.accuracy,
        });
        setStatus("Tracking location...");
        startWatcher();
      },
      (err) => {
        console.warn("Permission denied or error:", err);
        setStatus("Permission denied");
      },
      { enableHighAccuracy: true }
    );

    function startWatcher() {
      const id = navigator.geolocation.watchPosition(
        (p) => {
          setPos({
            lat: p.coords.latitude,
            lon: p.coords.longitude,
            acc: p.coords.accuracy,
          });
        },
        (err) => {
          console.error("Geolocation watch error:", err);
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
      );
      return () => navigator.geolocation.clearWatch(id);
    }
  }, []);

  return pos ? { ...pos, status } : { status };
}
