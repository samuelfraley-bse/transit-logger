# 🧭 Transit Logger – Change Log

All notable changes to this project are documented here.  
Dates follow the **YYYY-MM-DD** format.

---

## Version 2.0.1 – 2025-10-09
**Added Trip Editing** Allow users to edit and add or delete in the UI

## Version 2.0.0 – 2025-10-07
**Updated Station and Line Confirmation** Tap On and Tap Off now include confirmation steps for smoother interaction. Prevents stale filter states from previous flow.
**New In-Progress Screen** Displays active trip status, start station, selected line, and live timer until Tap Off.
**Updated UI Experience** Added animated transitions between trip states and smoother switching between tabs.
**Enhanced Map Visuals** Introduced pulsing user location marker and clearer nearest-station highlights.
**Developer Notes** Refactored trip-state handling, improved Supabase sync reliability, optimized nearest-station detection, and integrated Framer Motion for transitions.


## 🚀 Version 0.3.0 – 2025-10-06

### ✨ New Features
- **Interactive Map:** Now displays all stations using **Leaflet** with the **CartoDB Dark Matter basemap**.
- **Tap On / Tap Off Workflow:** Record metro trips by tapping on when boarding and off when exiting.
- **Line Selection:** Added drop-down menus for selecting metro lines when starting or ending a trip (no filtering, free selection).
- **Journey Tracking:** Each trip is linked with a persistent `journey_id` to connect Tap On / Tap Off events.
- **Persistent Trip in Progress:** Even after page reload, ongoing journeys remain active until Tap Off.
- **Release Notes Tab:** New tab dynamically loads and renders this changelog file using **ReactMarkdown**.

---

### 🧠 Improvements
- **Supabase Schema Updates:**
  - Added new columns: `boarded_line`, `exited_line`, and `journey_id`.
  - Enforced foreign key relationship: `logs.user_id → auth.users.id`.
  - Added **Row-Level Security (RLS)** to restrict data access per user.
- **API Enhancements:**
  - Improved error handling and debugging in `api.js`.
  - Added rich console logging for Supabase interactions.
- **Frontend Updates:**
  - Simplified `useStations.js` logic and eliminated infinite re-renders.
  - Added smoother toast notifications for trip sync and errors.
  - Enhanced offline handling and background syncing.

---

### 🐛 Fixes
- Fixed **duplicate React key warnings** in station and trip lists.
- Fixed **invalid UUID errors** by switching `journey_id` to short IDs.
- Fixed **foreign key constraint** errors related to `auth.users`.
- Prevented **trip state loss** when refreshing the page mid-journey.
- Resolved **map marker duplication** on re-renders.

---

## 🧩 Version 0.2.0 – 2025-10-05

### Features
- Added Supabase authentication with **Google OAuth**.
- Implemented secure session handling for user-based trip logging.
- Connected trip logger frontend to Supabase backend.
- Introduced **Trip Summary Table** to display recent trips.
- Styled app with **Tailwind CSS** and added responsive layout.

---

## 🌱 Version 0.1.0 – 2025-10-04

### Initial Release
- Created base React + Vite project.
- Set up **Supabase** integration and environment configuration.
- Added **MapView** component with geolocation hooks.
- Implemented basic tab navigation (Log / Summary).
- Added offline-first architecture with local DB caching.

---

🧾 *
