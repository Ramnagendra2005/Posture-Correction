const { PostureSession, DailySummary } = require("../models");

function getDayBounds(dateInput) {
  const date = new Date(dateInput || Date.now());
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getSessionDurationSeconds(session, now = new Date()) {
  if (typeof session?.durationSeconds === "number" && session.durationSeconds >= 0) {
    return session.durationSeconds;
  }

  const start = session?.startTime ? new Date(session.startTime) : null;
  const end = session?.endTime ? new Date(session.endTime) : now;
  if (!start || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 0;
  }

  return Math.max(0, Math.round((end - start) / 1000));
}

function getDateKey(dateInput) {
  const date = new Date(dateInput);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function calculateConsistency(scores = []) {
  if (scores.length === 0) {
    return 0;
  }

  const avg = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const variance =
    scores.reduce((sum, score) => sum + Math.pow(score - avg, 2), 0) / scores.length;
  const stdDev = Math.sqrt(variance);
  return Math.max(0, Math.round(100 - stdDev * 2));
}

function calculateTrend(scores = []) {
  if (scores.length < 4) {
    return "insufficient_data";
  }

  const midpoint = Math.floor(scores.length / 2);
  const older = scores.slice(0, midpoint);
  const recent = scores.slice(midpoint);

  const olderAvg = older.reduce((sum, score) => sum + score, 0) / older.length;
  const recentAvg = recent.reduce((sum, score) => sum + score, 0) / recent.length;

  if (recentAvg > olderAvg + 2) {
    return "improving";
  }

  if (recentAvg < olderAvg - 2) {
    return "declining";
  }

  return "stable";
}

function aggregateSessions(sessions = [], now = new Date()) {
  const sortedSessions = [...sessions].sort(
    (left, right) => new Date(left.startTime) - new Date(right.startTime)
  );

  const totals = {
    totalTimeTrackedSeconds: 0,
    totalTimeTracked: 0,
    sessionsCount: sortedSessions.length,
    averageScores: {
      headTilt: 0,
      shoulderAlignment: 0,
      spinalPosture: 0,
      proximity: 0,
      overall: 0,
    },
    totalCorrections: {
      headTiltCorrections: 0,
      shoulderCorrections: 0,
      backCorrections: 0,
      proximityWarnings: 0,
      total: 0,
    },
    eyeHealthMetrics: {
      totalBlinks: 0,
      averageBlinkRate: 0,
      lowBlinkPeriods: 0,
    },
    qualityMetrics: {
      bestSessionScore: 0,
      worstSessionScore: 100,
      consistencyScore: 0,
      improvementTrend: "insufficient_data",
    },
    sustainedFlawSummary: {},
    notificationCount: 0,
  };

  if (sortedSessions.length === 0) {
    totals.qualityMetrics.worstSessionScore = 0;
    return totals;
  }

  const overallScores = [];
  let blinkRateTotal = 0;

  for (const session of sortedSessions) {
    const sessionDuration = getSessionDurationSeconds(session, now);
    totals.totalTimeTrackedSeconds += sessionDuration;

    const scores = session.scores || {};
    const metrics = session.postureMetrics || {};
    const eyeHealth = session.eyeHealth || {};

    const headTilt = toNumber(scores.headTiltScore);
    const shoulderAlignment = toNumber(scores.shoulderAlignmentScore);
    const spinalPosture = toNumber(scores.spinalPostureScore);
    const proximity = toNumber(scores.proximityScore, 100);
    const overall = toNumber(scores.overallScore);

    totals.averageScores.headTilt += headTilt;
    totals.averageScores.shoulderAlignment += shoulderAlignment;
    totals.averageScores.spinalPosture += spinalPosture;
    totals.averageScores.proximity += proximity;
    totals.averageScores.overall += overall;

    const headTiltCorrections = toNumber(metrics.headTiltCount ?? metrics.head_tilt);
    const shoulderCorrections = toNumber(
      metrics.shoulderBendingCount ?? metrics.shoulderMisalignmentCount ?? metrics.shoulder_bend
    );
    const backCorrections = toNumber(
      metrics.backBendingCount ?? metrics.forwardLeanCount ?? metrics.back_bend
    );
    const proximityWarnings = toNumber(
      metrics.proximityWarnings ?? metrics.tooCloseCount ?? metrics.too_close
    );
    const correctionTotal = toNumber(
      metrics.totalCorrections,
      headTiltCorrections + shoulderCorrections + backCorrections + proximityWarnings
    );

    totals.totalCorrections.headTiltCorrections += headTiltCorrections;
    totals.totalCorrections.shoulderCorrections += shoulderCorrections;
    totals.totalCorrections.backCorrections += backCorrections;
    totals.totalCorrections.proximityWarnings += proximityWarnings;
    totals.totalCorrections.total += correctionTotal;

    totals.eyeHealthMetrics.totalBlinks += toNumber(eyeHealth.blinkCount);
    totals.eyeHealthMetrics.lowBlinkPeriods += toNumber(eyeHealth.lowBlinkWarnings);
    blinkRateTotal += toNumber(eyeHealth.averageBlinkRate);

    totals.qualityMetrics.bestSessionScore = Math.max(
      totals.qualityMetrics.bestSessionScore,
      overall
    );
    totals.qualityMetrics.worstSessionScore = Math.min(
      totals.qualityMetrics.worstSessionScore,
      overall
    );

    overallScores.push(overall);

    for (const flaw of session.sustainedFlaws || []) {
      if (!flaw?.flawType) {
        continue;
      }

      if (!totals.sustainedFlawSummary[flaw.flawType]) {
        totals.sustainedFlawSummary[flaw.flawType] = {
          count: 0,
          totalDurationSeconds: 0,
          notificationsSent: 0,
        };
      }

      totals.sustainedFlawSummary[flaw.flawType].count += 1;
      totals.sustainedFlawSummary[flaw.flawType].totalDurationSeconds += toNumber(
        flaw.durationSeconds
      );
      if (flaw.notificationSent) {
        totals.sustainedFlawSummary[flaw.flawType].notificationsSent += 1;
      }
    }

    totals.notificationCount += (session.notifications || []).length;
  }

  totals.averageScores.headTilt = Math.round(
    totals.averageScores.headTilt / sortedSessions.length
  );
  totals.averageScores.shoulderAlignment = Math.round(
    totals.averageScores.shoulderAlignment / sortedSessions.length
  );
  totals.averageScores.spinalPosture = Math.round(
    totals.averageScores.spinalPosture / sortedSessions.length
  );
  totals.averageScores.proximity = Math.round(
    totals.averageScores.proximity / sortedSessions.length
  );
  totals.averageScores.overall = Math.round(
    totals.averageScores.overall / sortedSessions.length
  );

  // DailySummary.totalTimeTracked is stored in minutes.
  totals.totalTimeTracked = Math.min(
    1440,
    Math.round(totals.totalTimeTrackedSeconds / 60)
  );

  totals.eyeHealthMetrics.averageBlinkRate =
    sortedSessions.length > 0 ? blinkRateTotal / sortedSessions.length : 0;

  totals.qualityMetrics.consistencyScore = calculateConsistency(overallScores);
  totals.qualityMetrics.improvementTrend = calculateTrend(overallScores);

  return totals;
}

async function rebuildDailySummaryFromSessions(userId, dateInput) {
  const { start, end } = getDayBounds(dateInput);

  const sessions = await PostureSession.find({
    userId,
    startTime: { $gte: start, $lt: end },
  }).lean();

  if (sessions.length === 0) {
    await DailySummary.deleteOne({ userId, date: start });
    return null;
  }

  const aggregate = aggregateSessions(sessions);

  // Compute cumulativeDuration: sum of all prior days' totalTimeTracked (in seconds) + today
  const priorSummaries = await DailySummary.find({
    userId,
    date: { $lt: start },
  }).select('totalTimeTracked').lean();
  const priorSeconds = priorSummaries.reduce(
    (sum, s) => sum + (s.totalTimeTracked || 0) * 60, 0
  );
  const todaySeconds = (aggregate.totalTimeTrackedSeconds || 0);
  const cumulativeDuration = priorSeconds + todaySeconds;

  const summary = await DailySummary.findOneAndUpdate(
    { userId, date: start },
    {
      $set: {
        totalTimeTracked: aggregate.totalTimeTracked,
        sessionsCount: aggregate.sessionsCount,
        averageScores: aggregate.averageScores,
        totalCorrections: aggregate.totalCorrections,
        eyeHealthMetrics: aggregate.eyeHealthMetrics,
        qualityMetrics: aggregate.qualityMetrics,
        cumulativeDuration,
      },
      $setOnInsert: {
        userId,
        date: start,
      },
    },
    { new: true, upsert: true }
  );

  return summary;
}

async function getSessionsForRange(userId, startDate, endDate) {
  return PostureSession.find({
    userId,
    startTime: { $gte: startDate, $lt: endDate },
  })
    .sort({ startTime: 1 })
    .lean();
}

function buildDailyBucketsFromSessions(sessions, startDate, endDate, now = new Date()) {
  const map = new Map();

  for (const session of sessions) {
    const key = getDateKey(session.startTime);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(session);
  }

  const buckets = [];
  const cursor = new Date(startDate);

  while (cursor < endDate) {
    const key = getDateKey(cursor);
    const daySessions = map.get(key) || [];
    const aggregate = aggregateSessions(daySessions, now);

    buckets.push({
      date: key,
      sessions: daySessions.length,
      aggregate,
    });

    cursor.setDate(cursor.getDate() + 1);
  }

  return buckets;
}

function buildPostureInsights(aggregate, maxItems = 5) {
  const insights = [];
  const flawEntries = Object.entries(aggregate.sustainedFlawSummary || {}).sort(
    (left, right) => right[1].totalDurationSeconds - left[1].totalDurationSeconds
  );

  for (const [flawType, stats] of flawEntries.slice(0, 3)) {
    insights.push({
      type: "sustained_flaw",
      flawType,
      severity: stats.totalDurationSeconds >= 15 * 60 ? "high" : "medium",
      title: `${flawType.replace(/_/g, " ")} persisted`,
      message: `${stats.count} sustained periods totaling ${Math.round(
        stats.totalDurationSeconds / 60
      )} minutes.`,
    });
  }

  const scoreChecks = [
    {
      key: "headTilt",
      label: "Head alignment",
      value: aggregate.averageScores?.headTilt || 0,
    },
    {
      key: "shoulderAlignment",
      label: "Shoulder alignment",
      value: aggregate.averageScores?.shoulderAlignment || 0,
    },
    {
      key: "spinalPosture",
      label: "Spinal posture",
      value: aggregate.averageScores?.spinalPosture || 0,
    },
    {
      key: "proximity",
      label: "Screen distance",
      value: aggregate.averageScores?.proximity || 0,
    },
  ].sort((left, right) => left.value - right.value);

  for (const scoreCheck of scoreChecks.slice(0, 2)) {
    if (scoreCheck.value >= 85) {
      continue;
    }

    insights.push({
      type: "score_risk",
      metric: scoreCheck.key,
      severity: scoreCheck.value < 70 ? "high" : "medium",
      title: `${scoreCheck.label} score is low`,
      message: `Average ${scoreCheck.label.toLowerCase()} score is ${Math.round(
        scoreCheck.value
      )}/100.`,
    });
  }

  return insights.slice(0, maxItems);
}

module.exports = {
  getDayBounds,
  getSessionDurationSeconds,
  aggregateSessions,
  rebuildDailySummaryFromSessions,
  getSessionsForRange,
  buildDailyBucketsFromSessions,
  buildPostureInsights,
};
