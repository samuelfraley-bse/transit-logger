import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";

export default function TripEditor({
  mode = "edit",
  initialData,
  uniqueStations,
  uniqueLines,
  onSave,
  onDelete,
  onCancel,
}) {
  const [step, setStep] = useState("on"); // "on" first, then "off"
  const [onData, setOnData] = useState(initialData?.on || {});
  const [offData, setOffData] = useState(initialData?.off || {});

  function handleOnChange(field, value) {
    setOnData((prev) => ({ ...prev, [field]: value }));
  }

  function handleOffChange(field, value) {
    setOffData((prev) => ({ ...prev, [field]: value }));
  }

  async function handleNext() {
    if (!onData.station || !onData.boarded_line || !onData.timestamp) {
      return toast.error("Please fill in all required Tap On fields");
    }
    setStep("off");
  }

  async function handleSave() {
    if (!offData.station || !offData.exited_line || !offData.timestamp) {
      return toast.error("Please fill in all required Tap Off fields");
    }

    await onSave({ on: onData, off: offData });
  }

  const commonInputClass =
    "w-full bg-slate-700 text-slate-100 rounded-xl p-2 mb-3";

  const modalTitle = step === "on" ? "✏️ Edit Tap On" : "🏁 Edit Tap Off";

  return (
    <AnimatePresence>
      <motion.div
        key={step}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      >
        <motion.div
          layout
          className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-xl"
        >
          <h2 className="text-xl font-bold mb-4">{modalTitle}</h2>

          {/* Step: TAP ON */}
          {step === "on" && (
            <>
              <label className="block text-slate-400 text-sm mb-1">
                Start Station *
              </label>
              <select
                value={onData.station || ""}
                onChange={(e) => handleOnChange("station", e.target.value)}
                className={commonInputClass}
              >
                <option value="">Select station...</option>
                {uniqueStations.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>

              <label className="block text-slate-400 text-sm mb-1">Line *</label>
              <select
                value={onData.boarded_line || ""}
                onChange={(e) => handleOnChange("boarded_line", e.target.value)}
                className={commonInputClass}
              >
                <option value="">Select line...</option>
                {uniqueLines.map((line) => (
                  <option key={line}>{line}</option>
                ))}
              </select>

              <label className="block text-slate-400 text-sm mb-1">
                Car Number
              </label>
              <input
                type="text"
                value={onData.car || ""}
                onChange={(e) => handleOnChange("car", e.target.value)}
                placeholder="Optional"
                className={commonInputClass}
              />

              <label className="block text-slate-400 text-sm mb-1">
                Start Time *
              </label>
              <input
                type="datetime-local"
                value={
                  onData.timestamp
                    ? new Date(onData.timestamp).toISOString().slice(0, 16)
                    : ""
                }
                onChange={(e) => handleOnChange("timestamp", e.target.value)}
                className={commonInputClass}
              />

              <div className="flex justify-between mt-5">
                <button
                  onClick={onCancel}
                  className="bg-slate-600 text-white px-4 py-2 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleNext}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg"
                >
                  Next →
                </button>
              </div>
            </>
          )}

          {/* Step: TAP OFF */}
          {step === "off" && (
            <>
              <label className="block text-slate-400 text-sm mb-1">
                End Station *
              </label>
              <select
                value={offData.station || ""}
                onChange={(e) => handleOffChange("station", e.target.value)}
                className={commonInputClass}
              >
                <option value="">Select station...</option>
                {uniqueStations.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>

              <label className="block text-slate-400 text-sm mb-1">Line *</label>
              <select
                value={offData.exited_line || ""}
                onChange={(e) => handleOffChange("exited_line", e.target.value)}
                className={commonInputClass}
              >
                <option value="">Select line...</option>
                {uniqueLines.map((line) => (
                  <option key={line}>{line}</option>
                ))}
              </select>

              <label className="block text-slate-400 text-sm mb-1">
                End Time *
              </label>
              <input
                type="datetime-local"
                value={
                  offData.timestamp
                    ? new Date(offData.timestamp).toISOString().slice(0, 16)
                    : ""
                }
                onChange={(e) => handleOffChange("timestamp", e.target.value)}
                className={commonInputClass}
              />

              <div className="flex justify-between mt-5">
                <button
                  onClick={() => setStep("on")}
                  className="bg-slate-600 text-white px-4 py-2 rounded-lg"
                >
                  ← Back
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => onDelete(onData.journey_id)}
                    className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg"
                  >
                    Delete
                  </button>
                  <button
                    onClick={handleSave}
                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg"
                  >
                    Save ✅
                  </button>
                </div>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
