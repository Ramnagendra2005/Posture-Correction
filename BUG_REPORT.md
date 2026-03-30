# Comprehensive Bug & Issues Report - Posture-Correction App

**Date:** March 16, 2026
**Analyzed By:** Claude Code (Opus 4.6)
**Project:** Smart Posture - Posture Correction Application
**Stack:** Node.js/Express Backend, React (Vite) Frontend, MongoDB, Python (MediaPipe), Socket.IO

---

## CRITICAL BUGS

### 1. Hardcoded User ID - Data Leak / Wrong User Data
**File:** `Backend/routes/posture.js:681`
```js
const userId = req.userId || "688dafbc5deaf9b3fe4bacf8"; // Test user ID
```
The `/api/posture/today-overview` endpoint falls back to a hardcoded test user ID when no auth is present. Since this route has **no `authenticateToken` middleware**, every unauthenticated request returns this specific user's real data. This is a **data leak**.

---

### 2. Multiple Unauthenticated Routes Expose All User Data
**File:** `Backend/routes/posture.js`

These routes accept a `userId` as a URL parameter with **zero authentication** -- anyone can query anyone's data:

| Route | Line |
|-------|------|
| `GET /api/posture/report/daily/:userId?` | 256 |
| `GET /api/posture/report/weekly/:userId?` | 345 |
| `GET /api/posture/report/monthly/:userId?` | 452 |
| `GET /api/posture/heatmap/:year/:userId?` | 554 |
| `GET /api/posture/trend/:timeRange/:userId?` | 803 |
| `POST /api/posture/track` | 20 |
| `POST /api/posture/update-realtime` | 970 |
| `POST /api/posture/tracked-time` | 1435 |
| `GET /api/posture/tracked-time` | 1494 |
| `POST /api/posture/tracked-time-normalized` | 1542 |
| `GET /api/posture/tracked-time-normalized` | 1592 |

---

### 3. `/api/posture/track` Auto-Creates Users with Fake Emails
**File:** `Backend/routes/posture.js:86-97`
```js
user = new User({
  username: user_id,
  email: `${user_id}@posture-tracking.local`,
  password: "flask-integration-user",
  firstName: user_id,
});
```
Anyone can POST to `/track` and create arbitrary user accounts with fabricated emails. The `lastName` field is **required** in the schema but not provided, so this will throw a Mongoose validation error in production.

---

### 4. Leaked OAuth Credentials in Source Code
**File:** `Backend/pyth/backend.py:883-892`
```python
client_id=YOUR_CLIENT_ID_HERE,
client_secret=YOUR_CLIENT_SECRET_HERE
```
Google OAuth `t_id` and `client_secret` are hardcoded in plaintext. These should be revoked immediately.

---

### 5. XSS Vulnerability via `dangerouslySetInnerHTML`
**File:** `Frontend/src/components/Chatbot.jsx:536`
```jsx
<div dangerouslySetInnerHTML={{ __html: msg.text }} />
```
Bot responses go through `formatMessage()` which does regex-based markdown, but the AI-generated content is **not sanitized**. If the AI returns HTML/script tags, they execute in the user's browser. This is a stored XSS vector.

---

## DATABASE DESIGN FLAWS

### 6. `DailySummary` Schema Mismatch with Actual Usage
The `DailySummary` model defines `totalCorrections` with fields:
- `headTiltCorrections`, `shoulderCorrections`, `backCorrections`, `total`

But `posture.js:178` writes field `proximityWarnings` which **doesn't exist in the schema**:
```js
proximityWarnings: correction_breakdown.too_close || 0,
```
This data is silently dropped by Mongoose strict mode.

---

### 7. `TrackedTime` Model Appended After `module.exports`
**File:** `Backend/models/index.js:335-353`
```js
module.exports = { User, PostureSession, PosturePattern, DailySummary };
// --- Appended: Tracked Time Schema and Export ---
module.exports.TrackedTime = mongoose.model("TrackedTime", trackedTimeSchema);
```
Works technically, but the `TrackedTime` model is **not included** when other files destructure:
`const { User, PostureSession } = require("../models")`. Any file that needs `TrackedTime` must explicitly access `require("../models").TrackedTime`.

---

### 8. `ExerciseRecommendation` Model Used But Never Defined
**File:** `Backend/routes/exercises.js:4`
```js
const { User, ExerciseRecommendation, PostureSession, DailySummary } = require("../models");
```
`ExerciseRecommendation` is **not defined anywhere** in `models/index.js`. This will be `undefined`, causing a crash on `new ExerciseRecommendation(...)` at line 100.

---

### 9. `exercises.js` Route Never Registered in `server.js`
The exercise route file exists at `Backend/routes/exercises.js` but **is never imported or mounted** in `server.js`. The endpoints `/api/exercises/*` return 404.

---

### 10. `PostureSession.deviceInfo.sessionId` -- Not in Schema
**File:** `Backend/routes/posture.js:114`
```js
let session = await PostureSession.findOne({
  userId: user._id,
  "deviceInfo.sessionId": session_id,
});
```
The `postureSessionSchema.deviceInfo` has `cameraResolution`, `userAgent`, `platform` -- but **no `sessionId` field**. This query never matches, so every `/track` call creates a new session instead of updating an existing one.

---

### 11. `cumulativeDuration` Field -- Never Properly Updated
**File:** `Backend/models/index.js:287`
```js
cumulativeDuration: { type: Number, default: 0 }, // in seconds (cumulative across all days)
```
This field exists in `DailySummary` but is **never written to** by `postureService.updateDailySummary()` or anywhere else. The `reports.js:197` reads it and always gets 0.

---

## FRONTEND-BACKEND MISMATCHES

### 12. Dashboard.jsx Uses Wrong API Base URL
**File:** `Frontend/src/components/Dashboard.jsx:8`
```js
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';
```
Every other frontend file defaults to `http://localhost:3001`. Dashboard defaults to `http://localhost:5000` (the old Flask port). **The Live Dashboard page is completely broken** unless `VITE_API_BASE_URL` is explicitly set.

---

### 13. PostureBreakdownChart Calls Non-Existent API Shape
**File:** `Frontend/src/components/PostureBreakdownChart.jsx:26-47`
```js
let endpoint = `/api/posture/report/${timeRange}`;
```
The backend endpoint is `/api/posture/report/daily/:userId?` and returns fields nested under `summary`. The frontend reads `result.average_scores` and `result.scores` at the top level, which is `undefined`. **The chart always shows "No posture data available"**.

---

### 14. ProgressTrendChart Calls `/api/posture/trend/:timeRange` -- Returns Different Shape
**File:** `Frontend/src/components/ProgressTrendChart.jsx:26`
```js
let endpoint = `/api/posture/trend/${timeRange}`;
```
Frontend expects `result.trend_data[].average_scores.overall`, but the backend stores scores as camelCase (`averageScores.overall`). The mapping uses `item.average_scores?.head_tilt` (snake_case) but the DB stores it as `headTilt`. **All trend values compute as 0**.

---

### 15. HeatmapGrid Calls `/api/posture/heatmap/:year` -- Response Shape Mismatch
**File:** `Frontend/src/components/HeatmapGrid.jsx:18`
```js
let endpoint = `/api/posture/heatmap/${year}`;
```
Frontend expects `result.heatmap_data[].average_scores.overall`, `total_corrections.head_tilt` etc. Backend returns data with camelCase keys from `DailySummary` (e.g., `averageScores.overall`). **All heatmap cells show 0 score**.

---

### 16. `req.user` vs `req.userId` Inconsistency in Chat Route
**File:** `Backend/routes/chat.js:189`
```js
logger.info(`Chat message from user ${req.user.username}: ...`);
```
Line 208 uses `req.user.id` (string representation), while `req.userId` is the ObjectId. Inconsistent but not crashing currently.

---

### 17. Session Start Returns `req.user.preferences`
**File:** `Backend/routes/session.js:81`
```js
preferences: req.user.preferences,
```
The session route is mounted with `authenticateToken` at the server level, so `req.user` exists. However, if the middleware ever fails silently, this crashes.

---

## INCONSISTENCIES & LOGIC BUGS

### 18. Duplicate CORS Configuration
**File:** `Backend/server.js:106-139`

CORS is configured twice -- once via the `cors()` middleware (line 106) and again via manual headers (line 118). The manual handler also responds to OPTIONS with `200` before the `cors()` middleware processes it, which can cause duplicate headers.

---

### 19. Error Handler Never Reached Due to 404 Wildcard
**File:** `Backend/server.js:266-274`
```js
app.use("*", (req, res) => {  // 404 handler - sends response
  res.status(404).json({...});
});
app.use(errorHandler);  // DEAD CODE - never reached
```
The `*` wildcard matches everything and **sends a response**, so `next()` is never called. The `errorHandler` middleware at line 274 is dead code.

---

### 20. `/api/reports/send-daily-email` Route Bypasses Rate Limiter
**File:** `Backend/server.js:240-263`

This endpoint is defined directly on `app` after `app.use("/api/reports", ...)`. It applies `authenticateToken` but **bypasses the `reportsLimiter`** applied to other report routes.

---

### 21. Aggregation Service Uses Different Field Names Than the Schema
**File:** `Backend/services/aggregationService.js:138`
```js
totals.totalCorrections.shoulderCorrections += toNumber(metrics.shoulderMisalignmentCount);
totals.totalCorrections.forwardLeanCorrections += toNumber(metrics.forwardLeanCount);
totals.totalCorrections.tooCloseCorrections += toNumber(metrics.tooCloseCount);
```
The `PostureSession` schema defines `shoulderBendingCount`, `backBendingCount` -- not `shoulderMisalignmentCount`, `forwardLeanCount`, `tooCloseCount`. The aggregation service reads fields that **don't exist**, so all correction counts are always 0.

---

### 22. `report/daily` Endpoint Has No Auth but Uses `req.userId`
**File:** `Backend/routes/posture.js:256`
```js
router.get("/report/daily/:userId?", async (req, res, next) => {
  const userId = req.params.userId || req.userId;
```
When called without auth, `req.userId` is `undefined`. If `userId` param is also missing, the MongoDB query uses `undefined` as userId, returning empty data silently.

---

### 23. `@clerk/clerk-react` Dependency Is Unused
**File:** `Frontend/package.json`

The Clerk authentication library is installed but **never imported or used** anywhere in the frontend code. The app uses a custom `AuthContext` with JWT tokens instead. Adds unnecessary bundle size.

---

### 24. Daily Summary `totalTimeTracked` -- Never Accumulates
**File:** `Backend/routes/posture.js:186`
```js
dailySummary.totalTimeTracked = Math.min(
  Math.max(dailySummary.totalTimeTracked, timeTrackedMinutes), 1440
);
```
This uses `Math.max` (takes the greater value), meaning it **never accumulates** time across sessions -- it always keeps the maximum. If session 1 tracked 30 min and session 2 tracked 20 min, total shows 30 (not 50).

---

### 25. `postureService.updateDailySummary` Uses Wrong Running Average Formula
**File:** `Backend/services/postureService.js:420-435`

When `sessionsCount` is 1, the initial `averageScores` is set to 100 (not 0). So for the second session:
```
(100 * (2-1) + newScore) / 2 = (100 + newScore) / 2
```
This uses the default 100 from initialization, not the first session's actual score. The average is permanently inflated.

---

### 26. Activity Feed in Dashboard is Hardcoded
**File:** `Frontend/src/components/Dashboard.jsx:204-209`

The "Real-time Activity" section displays a static hardcoded array of activities ("2 min ago", "5 min ago", etc.) that **never changes** regardless of actual posture events.

---

### 27. Refresh Button in Dashboard Does Nothing
**File:** `Frontend/src/components/Dashboard.jsx:192-199`

The "Refresh" button has no `onClick` handler -- it is purely decorative.

---

### 28. `PostureSession` Schema Missing `proximityWarnings` Field
**File:** `Backend/routes/posture.js:144`
```js
proximityWarnings: correction_breakdown.too_close || 0,
```
The `postureMetrics` subdocument defines `headTiltCount`, `shoulderBendingCount`, `backBendingCount`, `totalCorrections` -- but **not** `proximityWarnings`. This field is silently dropped.

---

## SUMMARY BY SEVERITY

| Severity | Count | Description |
|----------|-------|-------------|
| **Critical** | 5 | Auth bypass, data leaks, XSS, leaked secrets, auto-user-creation |
| **Major** | 8 | Missing model, unregistered route, wrong API URL, schema mismatches, broken charts |
| **Moderate** | 9 | Field name mismatches, wrong aggregation, units confusion, dead code |
| **Minor** | 6 | Unused deps, hardcoded UI, duplicate CORS, cosmetic issues |

---

## RECOMMENDED FIX PRIORITY

1. **Add `authenticateToken` to all posture routes** (issues 1, 2, 22)
2. **Fix Dashboard API_BASE URL from 5000 to 3001** (issue 12)
3. **Define `ExerciseRecommendation` model and register the exercises route** (issues 8, 9)
4. **Fix frontend-backend field name mismatches (snake_case vs camelCase)** (issues 13, 14, 15)
5. **Remove hardcoded credentials from `backend.py`** (issue 4)
6. **Sanitize HTML before `dangerouslySetInnerHTML`** (issue 5)
7. **Fix `DailySummary` schema to include `proximityWarnings`** (issues 6, 28)
8. **Add `sessionId` to `PostureSession.deviceInfo` schema** (issue 10)
9. **Fix aggregation service field names to match schema** (issue 21)
10. **Fix daily summary time accumulation logic** (issue 24)
11. **Fix running average formula in posture service** (issue 25)
12. **Remove duplicate CORS config and fix error handler ordering** (issues 18, 19)
13. **Remove unused `@clerk/clerk-react` dependency** (issue 23)
14. **Wire up Dashboard refresh button and activity feed** (issues 26, 27)

---

*End of Report*
