// src/db.js
import localforage from "localforage";

export const db = localforage.createInstance({
  name: "transit-logger",
  storeName: "events",
});

export const K = {
  deviceId: "device-id",
  outbox: "outbox",
};

export function uid() {
  return Math.random().toString(36).substring(2, 10);
}
