// src/db.js
import localforage from "localforage";

export const db = localforage.createInstance({
  name: "transit-logger",
  storeName: "events",
});

export const K = {
  deviceId: "deviceId",
  activeTrip: "activeTrip",
  activeJourneyId: "activeJourneyId",
  tripState: "tripState",
  tripStartTime: "tripStartTime",
  outbox: "outbox",
  pendingOnLog: "pendingOnLog",
  pendingOffLog: "pendingOffLog",
};

// ✅ Generate proper UUIDs
export function uid() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}