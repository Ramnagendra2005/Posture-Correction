/**
 * Shared Scoring Utilities
 *
 * Canonical posture score computation used by BOTH the analytics/reports
 * endpoint and the AI report generator.  Any change here is reflected
 * everywhere scores are shown, guaranteeing consistency.
 */

const clampScore = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
};

const extractSessionScore = (session, sessionKey) => {
  const candidates = [
    session?.scores?.[sessionKey],
    session?.[sessionKey],
  ];
  for (const candidate of candidates) {
    const n = Number(candidate);
    if (Number.isFinite(n)) {
      return clampScore(n);
    }
  }
  return 0;
};

const averageScores = (values) => {
  const valid = values
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v >= 0 && v <= 100);
  if (!valid.length) return 0;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
};

const hasRealSummaryData = (summary) => {
  if (!summary) return false;
  return (Number(summary.sessionsCount) || 0) > 0;
};

const pickComponentScore = ({ todaySummary, weekDailySummaries, weekSessions, summaryKey, sessionKey }) => {
  if (hasRealSummaryData(todaySummary)) {
    const todayValue = Number(todaySummary?.averageScores?.[summaryKey]);
    if (Number.isFinite(todayValue) && todayValue > 0) {
      return clampScore(todayValue);
    }
  }

  const weeklySummaryValues = weekDailySummaries
    .filter(hasRealSummaryData)
    .map((s) => Number(s?.averageScores?.[summaryKey]))
    .filter((v) => Number.isFinite(v) && v > 0);

  if (weeklySummaryValues.length > 0) {
    return clampScore(averageScores(weeklySummaryValues));
  }

  const weeklySessionValues = weekSessions
    .map((s) => extractSessionScore(s, sessionKey))
    .filter((v) => Number.isFinite(v) && v > 0);

  if (weeklySessionValues.length > 0) {
    return clampScore(averageScores(weeklySessionValues));
  }

  return 0;
};

/**
 * Compute canonical posture scores — the SINGLE source of truth for all
 * score display across the application (report page, AI report, emails).
 */
const computeCanonicalPostureScores = ({ todaySummary, weekDailySummaries, weekSessions }) => {
  const neckScore = Math.round(
    pickComponentScore({
      todaySummary,
      weekDailySummaries,
      weekSessions,
      summaryKey: "headTilt",
      sessionKey: "headTiltScore",
    })
  );

  const shoulderScore = Math.round(
    pickComponentScore({
      todaySummary,
      weekDailySummaries,
      weekSessions,
      summaryKey: "shoulderAlignment",
      sessionKey: "shoulderAlignmentScore",
    })
  );

  const backScore = Math.round(
    pickComponentScore({
      todaySummary,
      weekDailySummaries,
      weekSessions,
      summaryKey: "spinalPosture",
      sessionKey: "spinalPostureScore",
    })
  );

  const overallScore = Math.round(
    averageScores([neckScore, shoulderScore, backScore])
  );

  return {
    neckScore,
    shoulderScore,
    backScore,
    overallScore,
    headTiltScore: neckScore,
    shoulderAlignmentScore: shoulderScore,
    spinalPostureScore: backScore,
  };
};

const normalizeMinutes = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n > 1000) return n / 60;
  return n;
};

const toDateKey = (value) => {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

module.exports = {
  clampScore,
  extractSessionScore,
  averageScores,
  hasRealSummaryData,
  pickComponentScore,
  computeCanonicalPostureScores,
  normalizeMinutes,
  toDateKey,
};
