// src/components/TripEditor.jsx
import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import { db, K, uid } from "../db.js";

export default function TripEditor({
  mode = "add",
  initialData = null,
  uniqueStations = [],
  uniqueLines = [],
  onSave,
  onDelete,
  onCancel,
  user,
  deviceId,
}) {
  const [form, setForm] = useState(
    initialData || {
      station_from: "",
      station_to: "",
      line: "",
      start_time: "",
      end_time: "",
      manual: true,
    }
  );

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  async function handleSave() {
    if (!form.station_from || !form.line || !form.start_time) {
      return toast.error("Please fill in required fields.");
    }

    const journey_id = initialData?.journey_id || uid();
    const trip = {
      ...form,
      user_id: user.id,
      email: user.email,
      deviceId,
      journey_id,
      timestamp: new Date().toISOString(),
      action: "manual",
    };

    // Save to IndexedDB
    const outbox = (await db.getItem(K.outbox)) || [];
    const existingIndex = outbox.findIndex((t) => t.journey_id === journey_id);
    if (existingIndex >= 0) {
      outbox[existingIndex] = trip;
    } else {
      outbox.push(trip);
    }
    await db.setItem(K.outbox, outbox);

    toast.success("✅ Trip saved locally");
    onSave(trip);
  }

  async function handleDelete() {
    if (!initialData?.journey_id) return;
    const outbox = (await db.getItem(K.outbox)) || [];
    const updated = outbox.filter((t) => t.journey_id !== initialData.journey_id);
    await db.setItem(K.outbox, updated);
    toast("🗑️ Trip deleted locally");
    onDelete(initialData.journey_id);
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-lg text-slate-100"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
        >
          <h2 className="text-xl font-bold mb-4">
            {mode === "add" ? "➕ Add New Trip" : "✏️ Edit Trip"}
          </h2>

          {/* Form fields */}
          <div className="space-y-3">
            <div>
              <label className="block text-slate-400 text-sm mb-1">Start Station *</label>
              <select
                name="station_from"
                value={form.station_from}
                onChange={handleChange}
                className="w-full bg-slate-700 rounded-xl p-2"
              >
                <option value="">Select station...</option>
                {uniqueStations.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-400 text-sm mb-1">End Station</label>
              <select
                name="station_to"
                value={form.station_to}
                onChange={handleChange}
                className="w-full bg-slate-700 rounded-xl p-2"
              >
                <option value="">Select station...</option>
                {uniqueStations.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-400 text-sm mb-1">Line *</label>
              <select
                name="line"
                value={form.line}
                onChange={handleChange}
                className="w-full bg-slate-700 rounded-xl p-2"
              >
                <option value="">Select line...</option>
                {uniqueLines.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-400 text-sm mb-1">Start Time *</label>
              <input
                type="datetime-local"
                name="start_time"
                value={form.start_time}
                onChange={handleChange}
                className="w-full bg-slate-700 rounded-xl p-2 text-slate-100"
              />
            </div>

            <div>
              <label className="block text-slate-400 text-sm mb-1">End Time</label>
              <input
                type="datetime-local"
                name="end_time"
                value={form.end_time}
                onChange={handleChange}
                className="w-full bg-slate-700 rounded-xl p-2 text-slate-100"
              />
            </div>
          </div>

          {/* Buttons */}
          <div className="flex justify-between items-center mt-6">
            <button
              onClick={onCancel}
              className="px-4 py-2 bg-slate-600 hover:bg-slate-500 rounded-xl"
            >
              Cancel
            </button>

            <div className="flex gap-2">
              {mode === "edit" && (
                <button
                  onClick={handleDelete}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-xl"
                >
                  Delete
                </button>
              )}
              <button
                onClick={handleSave}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl font-semibold"
              >
                Save
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
