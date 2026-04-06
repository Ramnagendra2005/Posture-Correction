/**
 * User Data Fetcher
 *
 * Shared data access layer for both AI agents. Fetches and formats user
 * posture data into structured context for LLM consumption.
 */

const {
  PostureSession,
  DailySummary,
  TrackedTime,
  User,
  ExerciseRecommendation,
} = require("../models");
const logger = require("../utils/logger");

const {
  clampScore,
  normalizeMinutes,
  extractSessionScore,
  averageScores,
  hasRealSummaryData,
  computeCanonicalPostureScores,
} = require("../utils/scoringUtils");

const formatMinutes = (mins) => {
  const safe = Math.max(0, Math.min(1440, Math.round(mins || 0)));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${h}h ${m}m`;
};

/**
 * Fetch comprehensive posture data for a user.
 * Returns a structured object AND a text summary suitable for LLM context.
 */
async function fetchUserPostureData(userId) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Parallel fetch
  const [
    user,
    todaySessions,
    weekSessions,
    monthSessions,
    todaySummary,
    weekSummaries,
    trackedTime,
    exerciseHistory,
  ] = await Promise.all([
    User.findById(userId).select("-password").lean(),
    PostureSession.find({
      userId,
      startTime: { $gte: todayStart, $lt: todayEnd },
    })
      .sort({ startTime: -1 })
      .lean(),
    PostureSession.find({
      userId,
      startTime: { $gte: weekStart },
    })
      .sort({ startTime: -1 })
      .lean(),
    PostureSession.find({
      userId,
      startTime: { $gte: monthStart },
    })
      .sort({ startTime: -1 })
      .lean(),
    DailySummary.findOne({
      userId,
      date: { $gte: todayStart, $lt: todayEnd },
    }).lean(),
    DailySummary.find({
      userId,
      date: { $gte: weekStart },
    })
      .sort({ date: -1 })
      .lean(),
    TrackedTime.findOne({
      userId,
      date: { $gte: todayStart, $lt: todayEnd },
    }).lean(),
    ExerciseRecommendation.find({
      userId,
      date: { $gte: weekStart },
      completed: true,
    }).lean(),
  ]);

  // --- Process Today's Data ---
  // Deduplicate sessions by deviceInfo.sessionId to avoid inflated averages
  // from real-time update duplicates (same logic as analytics route)
  const todaySessionMap = new Map();
  for (const s of todaySessions) {
    const key = s?.deviceInfo?.sessionId || String(s?._id);
    const existing = todaySessionMap.get(key);
    if (!existing) {
      todaySessionMap.set(key, s);
    } else {
      // Keep the one with more data (longer duration or more recent update)
      const existingDur = normalizeMinutes(existing?.duration || 0);
      const nextDur = normalizeMinutes(s?.duration || 0);
      if (nextDur >= existingDur) {
        todaySessionMap.set(key, s);
      }
    }
  }
  const dedupedTodaySessions = Array.from(todaySessionMap.values());
  const todaySessionCount = dedupedTodaySessions.length;

  const todayMinutesFromTracker =
    Math.max(0, Number(trackedTime?.todaysTimeTrackedSeconds || 0)) / 60;
  const todayMinutesFromSessions = dedupedTodaySessions.reduce((sum, s) => {
    if (s.startTime && s.endTime) {
      return (
        sum +
        Math.min(
          120,
          (new Date(s.endTime) - new Date(s.startTime)) / (1000 * 60)
        )
      );
    }
    return sum + normalizeMinutes(s.duration || 0);
  }, 0);
  const todayMinutes =
    todayMinutesFromTracker > 0
      ? todayMinutesFromTracker
      : todayMinutesFromSessions;

  const todayScores = dedupedTodaySessions
    .map((s) => clampScore(s.scores?.overallScore))
    .filter((v) => v > 0);
  // Primary: use session-derived average; Fallback: use DailySummary average
  const todayAvgScoreFromSessions =
    todayScores.length > 0
      ? Math.round(todayScores.reduce((a, b) => a + b, 0) / todayScores.length)
      : 0;
  const todayAvgScoreFromSummary = clampScore(todaySummary?.averageScores?.overall);
  const todayAvgScore = todayAvgScoreFromSessions > 0
    ? todayAvgScoreFromSessions
    : todayAvgScoreFromSummary;

  const todayBestScore =
    todayScores.length > 0 ? Math.max(...todayScores) : 0;
  const todayWorstScore =
    todayScores.length > 0 ? Math.min(...todayScores) : 0;

  const todayCorrections = dedupedTodaySessions.reduce(
    (sum, s) => sum + (s.postureMetrics?.totalCorrections || 0),
    0
  );

  // Component scores for today (from deduped sessions, with DailySummary fallback)
  const todayHeadScores = dedupedTodaySessions
    .map((s) => clampScore(s.scores?.headTiltScore))
    .filter((v) => v > 0);
  const todayShoulderScores = dedupedTodaySessions
    .map((s) => clampScore(s.scores?.shoulderAlignmentScore))
    .filter((v) => v > 0);
  const todaySpineScores = dedupedTodaySessions
    .map((s) => clampScore(s.scores?.spinalPostureScore))
    .filter((v) => v > 0);

  const avg = (arr) =>
    arr.length > 0
      ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)
      : 0;

  const todayComponents = {
    headTilt: avg(todayHeadScores) || clampScore(todaySummary?.averageScores?.headTilt),
    shoulderAlignment: avg(todayShoulderScores) || clampScore(todaySummary?.averageScores?.shoulderAlignment),
    spinalPosture: avg(todaySpineScores) || clampScore(todaySummary?.averageScores?.spinalPosture),
  };

  // --- Process Weekly Data ---
  const weekSessionCount = weekSessions.length;
  const weekMinutes = weekSummaries.reduce(
    (sum, s) => sum + normalizeMinutes(s.totalTimeTracked || 0),
    0
  );
  const weekScores = weekSessions
    .map((s) => clampScore(s.scores?.overallScore))
    .filter((v) => v > 0);
  const weekAvgScore = avg(weekScores);
  const weekCorrections = weekSessions.reduce(
    (sum, s) => sum + (s.postureMetrics?.totalCorrections || 0),
    0
  );

  const weekComponents = {
    headTilt: avg(
      weekSessions
        .map((s) => clampScore(s.scores?.headTiltScore))
        .filter((v) => v > 0)
    ),
    shoulderAlignment: avg(
      weekSessions
        .map((s) => clampScore(s.scores?.shoulderAlignmentScore))
        .filter((v) => v > 0)
    ),
    spinalPosture: avg(
      weekSessions
        .map((s) => clampScore(s.scores?.spinalPostureScore))
        .filter((v) => v > 0)
    ),
  };

  // Trend detection
  const recentScores = weekScores.slice(0, Math.ceil(weekScores.length / 2));
  const olderScores = weekScores.slice(Math.ceil(weekScores.length / 2));
  const recentAvg = avg(recentScores);
  const olderAvg = avg(olderScores);
  let trend = "insufficient_data";
  if (recentScores.length >= 2 && olderScores.length >= 2) {
    if (recentAvg > olderAvg + 2) trend = "improving";
    else if (recentAvg < olderAvg - 2) trend = "declining";
    else trend = "stable";
  }

  // --- Monthly aggregation ---
  const monthSessionCount = monthSessions.length;
  const monthScores = monthSessions
    .map((s) => clampScore(s.scores?.overallScore))
    .filter((v) => v > 0);
  const monthAvgScore = avg(monthScores);

  // Detect dominant flaws
  const flawCounts = {
    head_tilt: 0,
    shoulder_misalignment: 0,
    forward_lean: 0,
    back_bending: 0,
    too_close: 0,
  };
  for (const s of weekSessions) {
    if (clampScore(s.scores?.headTiltScore) < 70) flawCounts.head_tilt++;
    if (clampScore(s.scores?.shoulderAlignmentScore) < 70)
      flawCounts.shoulder_misalignment++;
    if (clampScore(s.scores?.spinalPostureScore) < 70) {
      flawCounts.forward_lean++;
      flawCounts.back_bending++;
    }
  }
  const dominantFlaws = Object.entries(flawCounts)
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([flaw, count]) => ({ flaw, count }));

  // Hourly pattern (when does posture tend to be worst?)
  const hourlyBuckets = {};
  for (const s of todaySessions) {
    const hour = new Date(s.startTime).getHours();
    if (!hourlyBuckets[hour]) hourlyBuckets[hour] = [];
    const score = clampScore(s.scores?.overallScore);
    if (score > 0) hourlyBuckets[hour].push(score);
  }
  const hourlyPattern = Object.entries(hourlyBuckets)
    .map(([hour, scores]) => ({
      hour: parseInt(hour),
      avgScore: avg(scores),
      count: scores.length,
    }))
    .sort((a, b) => a.hour - b.hour);

  // === CANONICAL SCORES ===
  // Use the EXACT same scoring function that the Report page's analytics
  // endpoint uses.  This is the single source of truth.
  const canonicalScores = computeCanonicalPostureScores({
    todaySummary,
    weekDailySummaries: weekSummaries,
    weekSessions: dedupedTodaySessions.concat(weekSessions),
  });

  logger.info(`[UserDataFetcher] Canonical scores (same as Report page) → overall: ${canonicalScores.overallScore}, neck: ${canonicalScores.neckScore}, shoulder: ${canonicalScores.shoulderScore}, back: ${canonicalScores.backScore}`);

  // Build structured data
  const data = {
    user: {
      name: user?.firstName || user?.username || "User",
      email: user?.email || "",
      preferences: user?.preferences || {},
    },
    // Canonical scores — AUTHORITATIVE, same as Report page
    canonicalScores,
    today: {
      sessions: todaySessionCount,
      timeTracked: formatMinutes(todayMinutes),
      timeTrackedMinutes: Math.round(todayMinutes),
      // Use canonical overall as the primary score (matches Report page)
      avgScore: canonicalScores.overallScore,
      bestScore: todayBestScore,
      worstScore: todayWorstScore,
      corrections: todayCorrections,
      components: {
        headTilt: canonicalScores.neckScore,
        shoulderAlignment: canonicalScores.shoulderScore,
        spinalPosture: canonicalScores.backScore,
      },
      hourlyPattern,
    },
    week: {
      sessions: weekSessionCount,
      timeTracked: formatMinutes(weekMinutes),
      timeTrackedMinutes: Math.round(weekMinutes),
      avgScore: canonicalScores.overallScore,
      corrections: weekCorrections,
      components: {
        headTilt: canonicalScores.neckScore,
        shoulderAlignment: canonicalScores.shoulderScore,
        spinalPosture: canonicalScores.backScore,
      },
      trend,
    },
    month: {
      sessions: monthSessionCount,
      avgScore: monthAvgScore,
    },
    dominantFlaws,
    exercisesCompletedThisWeek: exerciseHistory.length,
    dailySummaries: weekSummaries.map((s) => ({
      date: s.date,
      avgScore: clampScore(s.averageScores?.overall),
      sessions: s.sessionsCount || 0,
      minutes: normalizeMinutes(s.totalTimeTracked || 0),
      trend: s.qualityMetrics?.improvementTrend || "insufficient_data",
    })),
  };

  // Build text summary for LLM
  const textSummary = buildTextSummary(data);

  // Debug: log the actual scores being sent to the AI
  logger.info(`[UserDataFetcher] User ${userId} data summary → Today: sessions=${data.today.sessions}, avgScore=${data.today.avgScore}, head=${data.today.components.headTilt}, shoulder=${data.today.components.shoulderAlignment}, spine=${data.today.components.spinalPosture} | Week: sessions=${data.week.sessions}, avgScore=${data.week.avgScore}`);

  return { data, textSummary };
}

/**
 * Convert structured data into a concise text summary for LLM context.
 */
function buildTextSummary(data) {
  const lines = [];
  lines.push(`## User: ${data.user.name}`);
  lines.push("");

  lines.push("### Today's Posture Data");
  if (data.today.sessions === 0) {
    lines.push("- No sessions recorded today.");
  } else {
    lines.push(`- Sessions: ${data.today.sessions}`);
    lines.push(`- Time Tracked: ${data.today.timeTracked}`);
    lines.push(`- Average Score: ${data.today.avgScore}/100`);
    lines.push(`- Best Score: ${data.today.bestScore}/100`);
    lines.push(`- Worst Score: ${data.today.worstScore}/100`);
    lines.push(`- Total Corrections: ${data.today.corrections}`);
    lines.push(
      `- Head Position Score: ${data.today.components.headTilt}/100`
    );
    lines.push(
      `- Shoulder Alignment Score: ${data.today.components.shoulderAlignment}/100`
    );
    lines.push(
      `- Spinal Posture Score: ${data.today.components.spinalPosture}/100`
    );
  }
  if (data.today.hourlyPattern.length > 0) {
    lines.push("- Hourly Pattern:");
    for (const hp of data.today.hourlyPattern) {
      lines.push(
        `  - ${String(hp.hour).padStart(2, "0")}:00 → Avg Score: ${hp.avgScore}, Sessions: ${hp.count}`
      );
    }
  }
  lines.push("");

  lines.push("### This Week's Data");
  lines.push(`- Sessions: ${data.week.sessions}`);
  lines.push(`- Time Tracked: ${data.week.timeTracked}`);
  lines.push(`- Average Score: ${data.week.avgScore}/100`);
  lines.push(`- Total Corrections: ${data.week.corrections}`);
  lines.push(`- Trend: ${data.week.trend}`);
  lines.push(
    `- Head Position Score: ${data.week.components.headTilt}/100`
  );
  lines.push(
    `- Shoulder Alignment Score: ${data.week.components.shoulderAlignment}/100`
  );
  lines.push(
    `- Spinal Posture Score: ${data.week.components.spinalPosture}/100`
  );
  lines.push("");

  lines.push("### Monthly Overview");
  lines.push(`- Sessions: ${data.month.sessions}`);
  lines.push(`- Average Score: ${data.month.avgScore}/100`);
  lines.push("");

  if (data.dominantFlaws.length > 0) {
    lines.push("### Dominant Posture Flaws This Week");
    for (const f of data.dominantFlaws) {
      lines.push(
        `- ${f.flaw.replace(/_/g, " ")}: detected in ${f.count} sessions`
      );
    }
    lines.push("");
  }

  lines.push(
    `### Exercises Completed This Week: ${data.exercisesCompletedThisWeek}`
  );
  lines.push("");

  if (data.dailySummaries.length > 0) {
    lines.push("### Daily Performance (Last 7 Days)");
    for (const ds of data.dailySummaries) {
      const dateStr = new Date(ds.date).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      lines.push(
        `- ${dateStr}: Score=${ds.avgScore}, Sessions=${ds.sessions}, Time=${Math.round(ds.minutes)}min, Trend=${ds.trend}`
      );
    }
  }

  return lines.join("\n");
}

module.exports = { fetchUserPostureData };
