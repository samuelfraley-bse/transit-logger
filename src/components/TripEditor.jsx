// src/components/TripEditor.jsx
import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import { db, K, uid } from "../db.js";
import { useSync } from "../hooks/useSync.js";

export default function TripEditor({
  mode = "add", // "add" or "edit"
  initialData = null, // The "on" log when editing
  offData = null, // The "off" log when editing
  uniqueStations = [],
  uniqueLines = [],
  onSave,
  onDelete,
  onCancel,
  user,
  deviceId,
}) {
  const { syncNow } = useSync();
  // Form state
  const [form, setForm] = useState({
    // Tap On fields
    on_station: "",
    on_line: "",
    on_car: "",
    on_time: "",
    on_lat: null,
    on_lon: null,
    
    // Tap Off fields
    off_station: "",
    off_line: "",
    off_time: "",
    off_lat: null,
    off_lon: null,
  });

  console.log("TripEditor deviceId:", deviceId);
  console.log("TripEditor user:", user?.id);

  // Pre-fill form when editing
  useEffect(() => {
    if (mode === "edit" && initialData) {
      const onLog = initialData;
      
      setForm({
        on_station: onLog.station || "",
        on_line: onLog.boarded_line || onLog.line || "",
        on_car: onLog.car || "",
        on_time: onLog.timestamp ? formatDateTimeLocal(onLog.timestamp) : "",
        on_lat: onLog.lat || null,
        on_lon: onLog.lon || null,
        
        // Fill off fields if offData is provided
        off_station: offData?.station || "",
        off_line: offData?.exited_line || offData?.line || "",
        off_time: offData?.timestamp ? formatDateTimeLocal(offData.timestamp) : "",
        off_lat: offData?.lat || null,
        off_lon: offData?.lon || null,
      });
    }
  }, [mode, initialData, offData]);

  // Format ISO timestamp to datetime-local input format
  function formatDateTimeLocal(isoString) {
    if (!isoString) return "";
    const date = new Date(isoString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

 async function handleSave() {
  // Validation
  if (!form.on_station || !form.on_line || !form.on_time) {
    return toast.error("Please fill in tap-on station, line, and time.");
  }

  if (!deviceId) {
    return toast.error("Device ID not available. Please refresh and try again.");
  }

  const journey_id = initialData?.journey_id || uid();

  if (mode === "edit" && initialData?.journey_id) {
    // ✅ EDITING: Create new logs with new_id (api.js will auto-deprecate old ones)
  const onLog = {
  ...initialData,
  device_id: initialData.device_id || deviceId,
  new_id: uid(),
  timestamp: new Date(form.on_time).toISOString(),
  station: form.on_station,
  line: form.on_line, // ✅ Just use line
  car: form.on_car || initialData.car || null,
  manual: true,
  deprecated: false,
};

    let offLog = null;
    if (form.off_station && form.off_time && offData) {
   offLog = {
  ...offData,
  device_id: offData.device_id || deviceId,
  new_id: uid(),
  timestamp: new Date(form.off_time).toISOString(),
  station: form.off_station,
  line: form.off_line || form.on_line, // ✅ Just use line
  manual: true,
  deprecated: false,
};
    } else if (form.off_station && form.off_time) {
      // User is adding a tap-off to a trip that didn't have one
      offLog = {
        ...initialData,
        device_id: deviceId,
        new_id: uid(),
        timestamp: new Date(form.off_time).toISOString(),
        action: "off",
        station: form.off_station,
        boarded_line: null,
        exited_line: form.off_line || form.on_line,
        car: null,
        manual: true,
        deprecated: false,
      };
    }

    // Get current outbox
    const outbox = (await db.getItem(K.outbox)) || [];

    // ✅ Just add the new logs - api.js will handle deprecation
    const updatedOutbox = [...outbox, onLog];
    if (offLog) updatedOutbox.push(offLog);

    await db.setItem(K.outbox, updatedOutbox);
    toast.success("✅ Trip updated (will sync when online)");
    syncNow(); 
    onSave({ on: onLog, off: offLog, journey_id });
  } else {
    // ✅ ADDING NEW TRIP: Create from scratch
    const onLog = {
      new_id: uid(),
      timestamp: new Date(form.on_time).toISOString(),
      device_id: deviceId,
      user_id: user.id,
      email: user.email,
      action: "on",
      station: form.on_station,
      boarded_line: form.on_line,
      exited_line: null,
      car: form.on_car || null,
      lat: form.on_lat,
      lon: form.on_lon,
      journey_id: journey_id,
      manual: true,
      deprecated: false,
    };

    let offLog = null;
    if (form.off_station && form.off_time) {
      offLog = {
        new_id: uid(),
        timestamp: new Date(form.off_time).toISOString(),
        device_id: deviceId,
        user_id: user.id,
        email: user.email,
        action: "off",
        station: form.off_station,
        boarded_line: null,
        exited_line: form.off_line || form.on_line,
        car: null,
        lat: form.off_lat,
        lon: form.off_lon,
        journey_id: journey_id,
        manual: true,
        deprecated: false,
      };
    }

    const outbox = (await db.getItem(K.outbox)) || [];
    const updatedOutbox = [...outbox, onLog];
    if (offLog) updatedOutbox.push(offLog);

    await db.setItem(K.outbox, updatedOutbox);
    toast.success("✅ New trip added (will sync when online)");
    onSave({ on: onLog, off: offLog, journey_id });
  }
}

  async function handleDelete() {
    if (!initialData?.journey_id) return;

    const outbox = (await db.getItem(K.outbox)) || [];
    
    // Mark entries as deleted instead of removing them
    const updatedOutbox = outbox.map((log) => {
      if (log.journey_id === initialData.journey_id) {
        return {
          ...log,
          device_id: log.device_id || deviceId, // ✅ Ensure device_id
          deprecated: true,
          deleted_at: new Date().toISOString(),
        };
      }
      return log;
    });

    await db.setItem(K.outbox, updatedOutbox);
    toast("🗑️ Trip marked for deletion");
    syncNow()
    onDelete(initialData.journey_id);
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 overflow-y-auto"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={(e) => e.target === e.currentTarget && onCancel()}
      >
        <motion.div
          className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-lg text-slate-100 my-4"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
        >
          <h2 className="text-xl font-bold mb-4">
            {mode === "add" ? "➕ Add New Trip" : "✏️ Edit Trip"}
          </h2>

          <div className="space-y-6">
            {/* TAP ON SECTION */}
            <div className="bg-slate-700/50 rounded-xl p-4 space-y-3">
              <h3 className="text-green-400 font-semibold text-sm">🚇 TAP ON</h3>
              
              <div>
                <label className="block text-slate-400 text-sm mb-1">
                  Station *
                </label>
                <select
                  name="on_station"
                  value={form.on_station}
                  onChange={handleChange}
                  className="w-full bg-slate-700 text-slate-100 rounded-xl p-2 border border-slate-600 focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Select station...</option>
                  {uniqueStations.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 text-sm mb-1">
                  Line *
                </label>
                <select
                  name="on_line"
                  value={form.on_line}
                  onChange={handleChange}
                  className="w-full bg-slate-700 text-slate-100 rounded-xl p-2 border border-slate-600 focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Select line...</option>
                  {uniqueLines.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 text-sm mb-1">
                  Car Number (optional)
                </label>
                <input
                  type="text"
                  name="on_car"
                  value={form.on_car}
                  onChange={handleChange}
                  placeholder="e.g. Car 203 or 04B"
                  className="w-full bg-slate-700 text-slate-100 rounded-xl p-2 border border-slate-600 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-400 text-sm mb-1">
                  Time *
                </label>
                <input
                  type="datetime-local"
                  name="on_time"
                  value={form.on_time}
                  onChange={handleChange}
                  className="w-full bg-slate-700 text-slate-100 rounded-xl p-2 border border-slate-600 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            {/* TAP OFF SECTION */}
            <div className="bg-slate-700/50 rounded-xl p-4 space-y-3">
              <h3 className="text-red-400 font-semibold text-sm">🏁 TAP OFF</h3>
              
              <div>
                <label className="block text-slate-400 text-sm mb-1">
                  Station {mode === "add" && "(optional)"}
                </label>
                <select
                  name="off_station"
                  value={form.off_station}
                  onChange={handleChange}
                  className="w-full bg-slate-700 text-slate-100 rounded-xl p-2 border border-slate-600 focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Select station...</option>
                  {uniqueStations.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 text-sm mb-1">
                  Line (defaults to tap-on line)
                </label>
                <select
                  name="off_line"
                  value={form.off_line}
                  onChange={handleChange}
                  className="w-full bg-slate-700 text-slate-100 rounded-xl p-2 border border-slate-600 focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Same as tap-on</option>
                  {uniqueLines.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 text-sm mb-1">
                  Time {mode === "add" && "(optional)"}
                </label>
                <input
                  type="datetime-local"
                  name="off_time"
                  value={form.off_time}
                  onChange={handleChange}
                  className="w-full bg-slate-700 text-slate-100 rounded-xl p-2 border border-slate-600 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* ACTION BUTTONS */}
          <div className="flex justify-between items-center mt-6 gap-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 bg-slate-600 hover:bg-slate-500 rounded-xl transition"
            >
              Cancel
            </button>

            <div className="flex gap-2">
              {mode === "edit" && (
                <button
                  onClick={handleDelete}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-xl transition"
                >
                  Delete
                </button>
              )}
              <button
                onClick={handleSave}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl font-semibold transition"
              >
                {mode === "edit" ? "Save Changes" : "Add Trip"}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}