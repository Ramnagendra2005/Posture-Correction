const express = require("express");
const { query, validationResult } = require("express-validator");
const { PostureSession, PosturePattern, DailySummary, TrackedTime } = require("../models");
const { buildDailyEmail } = require("../services/dailyReportService");
const { sendMail } = require("../services/emailService");
const { generatePostureReport, renderReportAsEmailHtml } = require("../services/reportAgentService");
const logger = require("../utils/logger");

const router = express.Router();

const clampScore = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
};

const toDateKey = (value) => {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
  // Legacy safety: some durations may have been stored in seconds.
  if (n > 1000) return n / 60;
  return n;
};

// Send today's daily email to the authenticated user
router.post("/send-daily-email", async (req, res) => {
  try {
    const { to, subject, html, text } = await buildDailyEmail(req.userId, new Date());

    const info = await sendMail({ to, subject, html, text });
    if (info?.skipped) {
      return res.status(202).json({
        success: false,
        message: "Email skipped (SMTP not configured)",
      });
    }

    return res.json({ success: true, messageId: info.messageId });
  } catch (err) {
    logger.error("Failed to send daily email:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Preview today's daily email content (no send)
router.get("/preview-daily-email", async (req, res) => {
  try {
    const payload = await buildDailyEmail(req.userId, new Date());
    res.json({
      success: true,
      preview: {
        to: payload.to,
        subject: payload.subject,
        htmlLength: payload.html.length,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @route   GET /api/reports/analytics
 * @desc    Get comprehensive analytics data for reports page
 * @access  Private
 */
router.get("/analytics", async (req, res, next) => {
  try {
    const userId = req.userId;
    const now = new Date();

    // Get date ranges
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Get today's sessions
    const todaySessions = await PostureSession.find({
      userId,
      startTime: { $gte: todayStart },
    }).sort({ startTime: -1 });

    // Get week's sessions
    const weekSessions = await PostureSession.find({
      userId,
      startTime: { $gte: weekStart },
    }).sort({ startTime: -1 });

    // Deduplicate week sessions by stable device session id to avoid inflated
    // trend points when realtime updates produced multiple noisy records.
    const weekSessionMap = new Map();
    weekSessions.forEach((session) => {
      const key = session?.deviceInfo?.sessionId || String(session?._id);
      const existing = weekSessionMap.get(key);
      if (!existing) {
        weekSessionMap.set(key, session);
        return;
      }

      const existingDuration = normalizeMinutes(existing?.duration || 0);
      const nextDuration = normalizeMinutes(session?.duration || 0);
      if (nextDuration >= existingDuration) {
        weekSessionMap.set(key, session);
      }
    });
    const dedupedWeekSessions = Array.from(weekSessionMap.values()).sort(
      (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );

    // Get month's sessions
    const monthSessions = await PostureSession.find({
      userId,
      startTime: { $gte: monthStart },
    }).sort({ startTime: -1 });

    // Use DailySummary to avoid double-counting across multiple sessions per day
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
    const todaySummary = await DailySummary.findOne({
      userId,
      date: { $gte: todayStart, $lt: todayEnd },
    }).lean();

    // Deduplicate today's sessions by sessionId to avoid over-counting when
    // realtime updates created noisy duplicates historically.
    const todaySessionMap = new Map();
    for (const session of todaySessions) {
      const key = session?.deviceInfo?.sessionId || String(session?._id);
      const existing =
        todaySessionMap.get(key) ||
        {
          durationMinutes: 0,
          corrections: 0,
          score: 0,
          hasSignal: false,
        };

      let minutes = normalizeMinutes(session?.duration || 0);
      if (minutes <= 0 && session?.startTime) {
        const start = new Date(session.startTime).getTime();
        const end =
          session.status === "active"
            ? now.getTime()
            : session.endTime
            ? new Date(session.endTime).getTime()
            : start;
        minutes = Math.max(0, (end - start) / (1000 * 60));
      }

      const corrections = Math.max(
        0,
        Number(session?.postureMetrics?.totalCorrections || 0)
      );
      const score = clampScore(session?.scores?.overallScore || 0);
      const hasSignal =
        minutes > 0.1 ||
        corrections > 0 ||
        Boolean(session?.endTime) ||
        session?.status === "active" ||
        session?.status === "completed";

      todaySessionMap.set(key, {
        durationMinutes: Math.max(existing.durationMinutes, minutes),
        corrections: Math.max(existing.corrections, corrections),
        score: score > 0 ? score : existing.score,
        hasSignal: existing.hasSignal || hasSignal,
      });
    }

    const todaySessionRows = Array.from(todaySessionMap.values()).filter(
      (row) => row.hasSignal
    );
    const sessionDerivedTodayMinutes = todaySessionRows.reduce(
      (sum, row) => sum + row.durationMinutes,
      0
    );

    const trackedTodayDoc = await TrackedTime.findOne({
      userId,
      date: { $gte: todayStart, $lt: todayEnd },
    }).lean();
    const trackedTodayMinutes = Math.max(
      0,
      Number(trackedTodayDoc?.todaysTimeTrackedSeconds || 0) / 60
    );

    const summaryTodayMinutes = normalizeMinutes(todaySummary?.totalTimeTracked || 0);
    const todayMinutesRaw =
      trackedTodayMinutes > 0
        ? trackedTodayMinutes
        : sessionDerivedTodayMinutes > 0
        ? sessionDerivedTodayMinutes
        : summaryTodayMinutes;
    const todayMinutes = Math.min(1440, todayMinutesRaw);
    const todayTimeTracked = todayMinutes / 60; // minutes -> hours
    const todaySessionsCount = todaySessionRows.length;

    const todayCorrectionsFromSummary = Number(
      todaySummary?.totalCorrections?.total || 0
    );
    const todayCorrectionsFromSessions = todaySessionRows.reduce(
      (total, row) =>
        total + row.corrections,
      0
    );
    const todayFeedbackCount = Math.max(
      todayCorrectionsFromSummary,
      todayCorrectionsFromSessions
    );

    const todayAverageFromSummary = hasRealSummaryData(todaySummary)
      ? Number(todaySummary?.averageScores?.overall || 0)
      : 0;
    const todayAverageFromSessions =
      todaySessionRows.length > 0
        ? todaySessionRows.reduce((sum, row) => sum + row.score, 0) /
          todaySessionRows.length
        : 0;
    // Use sessions average if available (most current data), otherwise use summary
    const todayAvgScore = Math.round(
      todayAverageFromSessions > 0
        ? todayAverageFromSessions
        : todayAverageFromSummary
    );

    const todayBestFromSummary = hasRealSummaryData(todaySummary)
      ? Number(todaySummary?.qualityMetrics?.bestSessionScore || 0)
      : 0;
    const todayBestFromSessions =
      todaySessionRows.length > 0
        ? Math.max(...todaySessionRows.map((row) => row.score))
        : 0;
    const todayBestScore = Math.round(
      Math.max(todayBestFromSummary, todayBestFromSessions)
    );

    // Calculate weekly metrics (sum of per-day totals from DailySummary)
    const weekDailySummaries = await DailySummary.find({
      userId,
      date: { $gte: weekStart },
    }).lean();
    const weekTimeTracked =
      weekDailySummaries.reduce(
        (sum, s) => sum + (s.totalTimeTracked || 0),
        0
      ) / 60; // minutes -> hours

    const weekFeedbackCount = dedupedWeekSessions.reduce(
      (total, session) =>
        total + (session.postureMetrics?.totalCorrections || 0),
      0
    );

    const canonicalScores = computeCanonicalPostureScores({
      todaySummary,
      weekDailySummaries,
      weekSessions: dedupedWeekSessions,
    });

    const weekSummariesWithOverall = weekDailySummaries.filter(
      (s) => hasRealSummaryData(s) && Number(s?.averageScores?.overall) > 0
    );
    const weekAvgScore =
      weekSummariesWithOverall.length > 0
        ? averageScores(
            weekSummariesWithOverall.map((s) => Number(s.averageScores?.overall))
          )
        : canonicalScores.overallScore;

    // Calculate trend
    const recentSessions = dedupedWeekSessions.slice(0, 3);
    const olderSessions = dedupedWeekSessions.slice(3, 6);
    const recentScores = recentSessions
      .map((s) => extractSessionScore(s, "overallScore"))
      .filter((v) => v > 0);
    const olderScores = olderSessions
      .map((s) => extractSessionScore(s, "overallScore"))
      .filter((v) => v > 0);
    const recentAvg =
      recentScores.length > 0
        ? averageScores(recentScores)
        : 0;
    const olderAvg =
      olderScores.length > 0
        ? averageScores(olderScores)
        : 0;

    const scoreTrend =
      recentAvg > olderAvg + 2
        ? "improving"
        : recentAvg < olderAvg - 2
        ? "declining"
        : "stable";

    // Get daily summaries for the week
    const dailySummaries = await DailySummary.find({
      userId,
      date: { $gte: weekStart },
    }).sort({ date: 1 });

    const componentScores = {
      ...canonicalScores,
      hipBalanceScore: 0, // Dynamic - no default values
      legPositionScore: 0, // Dynamic - no default values
    };

    // Get all daily summaries for cumulative time calculation
    const allDailySummaries = await DailySummary.find({ userId });

    // Calculate cumulative duration from the latest daily summary
    // This ensures we get the most up-to-date cumulative time
    let cumulativeSeconds = 0;
    if (allDailySummaries.length > 0) {
      // Sort by date to get the latest summary
      const sortedSummaries = [...allDailySummaries].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );

      // Get cumulative time from the most recent summary
      cumulativeSeconds = sortedSummaries[0].cumulativeDuration || 0;

      // Add today's active session time if any
      if (todaySessions.length > 0) {
        const activeSession = todaySessions.find((s) => s.status === "active");
        if (activeSession) {
          const activeSessionDuration = Math.floor(
            (now - activeSession.startTime) / 1000
          );
          cumulativeSeconds += activeSessionDuration;
        }
      }
    }

    // Format time for display
    const formatTime = (seconds) => {
      const total = Math.max(0, Math.floor(Number(seconds) || 0));
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const secs = total % 60;
      return `${hours}:${minutes.toString().padStart(2, "0")}:${secs
        .toString()
        .padStart(2, "0")}`;
    };

    // Get weekly trend data for charts
    const weeklySummaryByDate = new Map();
    weekDailySummaries.forEach((summary) => {
      if (!hasRealSummaryData(summary)) return;
      const key = toDateKey(summary?.date);
      if (!key) return;
      const score = Number(summary?.averageScores?.overall);
      if (!Number.isFinite(score) || score <= 0) return;
      weeklySummaryByDate.set(key, clampScore(score));
    });

    const weeklyTrendData = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });

      // Find sessions for this date
      const dayStart = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
      );
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const daySessions = dedupedWeekSessions.filter(
        (s) => s.startTime >= dayStart && s.startTime < dayEnd
      );

      const sessionScores = daySessions
        .map((s) => extractSessionScore(s, "overallScore"))
        .filter((v) => v > 0);

      const dayKey = toDateKey(dayStart);
      const summaryScore = dayKey ? weeklySummaryByDate.get(dayKey) || 0 : 0;

      const avgScore =
        summaryScore > 0
          ? Math.round(summaryScore)
          : sessionScores.length > 0
          ? Math.round(averageScores(sessionScores))
          : 0;

      weeklyTrendData.push({
        date: dateStr,
        score: avgScore,
      });
    }

    // Get daily session data
    const dailySessionData = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });

      const dayStart = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
      );
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const daySessionCount = dedupedWeekSessions.filter(
        (s) => s.startTime >= dayStart && s.startTime < dayEnd
      ).length;

      dailySessionData.push({
        date: dateStr,
        sessions: daySessionCount,
      });
    }

    // Response data
    const allTimeCorrections = allDailySummaries.reduce(
      (sum, summary) => sum + Number(summary?.totalCorrections?.total || 0),
      0
    );

    const summary = {
      currentScore: Math.round(canonicalScores.overallScore),
      timeTracked: Math.round(todayTimeTracked * 10) / 10, // TODAY'S time
      todayMinutes: Math.round(todayMinutes),
      todaySessions: todaySessionsCount,
      todayCorrections: todayFeedbackCount,
      totalSessions: allDailySummaries.reduce(
        (total, summary) => total + (summary.sessionsCount || 0),
        0
      ), // ALL-TIME session count
      totalCorrections: todayFeedbackCount, // TODAY'S corrections
      allTimeCorrections,
      totalBreaks: Math.floor(todayTimeTracked * 2), // legacy alias (today estimate)
      todayBreaks: Math.floor(todayTimeTracked * 2),
      averageScore: Math.round(weekAvgScore), // WEEKLY average
      scoreTrend,
      // Add cumulative time tracking
      cumulativeTime: cumulativeSeconds,
      cumulativeTimeFormatted: formatTime(cumulativeSeconds),
      bestScore: Math.max(
        ...allDailySummaries.map((summary) => summary.bestScore || 0),
        0
      ),
      // Weekly totals for Weekly Overview section
      weekTimeTracked: Math.round(weekTimeTracked * 10) / 10,
      weekCorrections: weekFeedbackCount,
      weekBreaks: Math.floor(weekTimeTracked * 2),
      // Additional today-specific metrics
      todayBestScore,
      todayAvgScore,
      // Component scores from recent sessions
      ...componentScores,
      // Chart data
      weeklyTrendData,
      dailySessionData,
    };

    res.json({
      success: true,
      summary,
      sessions: dedupedWeekSessions.map((session) => ({
        id: session._id,
        startTime: session.startTime,
        endTime: session.endTime,
        duration: session.duration,
        overallScore: extractSessionScore(session, "overallScore"),
        scores: session.scores,
      })),
      dailySummaries: dailySummaries.map((summary) => ({
        date: summary.date,
        totalSessions: summary.totalSessions,
        totalDuration: summary.totalDuration,
        averageScore: summary.averageScore,
        bestScore: summary.bestScore,
      })),
    });

    // Log analytics data for debugging
    logger.info(`Analytics data sent for user ${userId}:`, {
      todaySessions: summary.todaySessions,
      todayTimeTracked: summary.timeTracked,
      weekSessions: summary.totalSessions,
      weekTimeTracked: summary.weekTimeTracked,
    });
  } catch (error) {
    logger.error("Error fetching analytics data:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch analytics data",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

/**
 * @route   GET /api/reports/overview
 * @desc    Get user's posture overview statistics
 * @access  Private
 */
router.get(
  "/overview",
  [
    query("period")
      .optional()
      .isIn(["today", "week", "month", "year"])
      .withMessage("Period must be today, week, month, or year"),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const userId = req.userId;
      const period = req.query.period || "today";

      // Calculate date range based on period
      const now = new Date();
      let startDate = new Date();

      switch (period) {
        case "today":
          startDate.setHours(0, 0, 0, 0);
          break;
        case "week":
          startDate.setDate(now.getDate() - 7);
          break;
        case "month":
          startDate.setMonth(now.getMonth() - 1);
          break;
        case "year":
          startDate.setFullYear(now.getFullYear() - 1);
          break;
      }

      // Get sessions in the period
      const sessions = await PostureSession.find({
        userId,
        startTime: { $gte: startDate },
        status: "completed",
      }).lean();

      // Calculate overview statistics
      const totalSessions = sessions.length;
      const totalTimeTracked = sessions.reduce(
        (sum, session) => sum + (session.duration || 0),
        0
      );

      const totalCorrections = sessions.reduce(
        (sum, session) => sum + (session.postureMetrics?.totalCorrections || 0),
        0
      );

      const averageScore =
        totalSessions > 0
          ? sessions.reduce(
              (sum, session) => sum + (session.scores?.overallScore || 0),
              0
            ) / totalSessions
          : 0;

      // Get current active session
      const PostureService = require("../services/postureService");
      const activeSession = PostureService.getActiveSession(userId);

      res.json({
        success: true,
        data: {
          period,
          overview: {
            totalSessions,
            totalTimeTracked, // in minutes
            totalCorrections,
            averageScore: Math.round(averageScore),
            hasActiveSession: !!activeSession,
            activeSessionId: activeSession?.sessionId || null,
          },
          breakdown: {
            headTiltCorrections: sessions.reduce(
              (sum, s) => sum + (s.postureMetrics?.headTiltCount || 0),
              0
            ),
            shoulderCorrections: sessions.reduce(
              (sum, s) => sum + (s.postureMetrics?.shoulderBendingCount || 0),
              0
            ),
            backCorrections: sessions.reduce(
              (sum, s) => sum + (s.postureMetrics?.backBendingCount || 0),
              0
            ),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   GET /api/reports/daily-trends
 * @desc    Get daily posture trends for chart visualization
 * @access  Private
 */
router.get(
  "/daily-trends",
  [
    query("days")
      .optional()
      .isInt({ min: 1, max: 365 })
      .withMessage("Days must be between 1 and 365"),
    query("metric")
      .optional()
      .isIn(["overall", "headTilt", "shoulderAlignment", "spinalPosture"])
      .withMessage(
        "Metric must be overall, headTilt, shoulderAlignment, or spinalPosture"
      ),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const userId = req.userId;
      const days = parseInt(req.query.days) || 30;
      const metric = req.query.metric || "overall";

      // Calculate date range
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - days);
      startDate.setHours(0, 0, 0, 0);

      // Get daily summaries
      const dailySummaries = await DailySummary.find({
        userId,
        date: { $gte: startDate, $lte: endDate },
      })
        .sort({ date: 1 })
        .lean();

      // Create date range array
      const dateRange = [];
      for (
        let d = new Date(startDate);
        d <= endDate;
        d.setDate(d.getDate() + 1)
      ) {
        dateRange.push(new Date(d));
      }

      // Map summaries to chart data
      const chartData = dateRange.map((date) => {
        const dateStr = date.toDateString();
        const summary = dailySummaries.find(
          (s) => s.date.toDateString() === dateStr
        );

        let score = 0;
        if (summary) {
          switch (metric) {
            case "headTilt":
              score = summary.averageScores?.headTilt || 0;
              break;
            case "shoulderAlignment":
              score = summary.averageScores?.shoulderAlignment || 0;
              break;
            case "spinalPosture":
              score = summary.averageScores?.spinalPosture || 0;
              break;
            default:
              score = summary.averageScores?.overall || 0;
          }
        }

        return {
          date: date.toISOString().split("T")[0], // YYYY-MM-DD format
          score: Math.round(score),
          timeTracked: summary?.totalTimeTracked || 0,
          corrections: summary?.totalCorrections?.total || 0,
        };
      });

      res.json({
        success: true,
        data: {
          metric,
          period: `${days} days`,
          chartData,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   GET /api/reports/correction-breakdown
 * @desc    Get correction type breakdown for pie/bar charts
 * @access  Private
 */
router.get(
  "/correction-breakdown",
  [
    query("period")
      .optional()
      .isIn(["today", "week", "month"])
      .withMessage("Period must be today, week, or month"),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const userId = req.userId;
      const period = req.query.period || "week";

      // Calculate date range
      const now = new Date();
      let startDate = new Date();

      switch (period) {
        case "today":
          startDate.setHours(0, 0, 0, 0);
          break;
        case "week":
          startDate.setDate(now.getDate() - 7);
          break;
        case "month":
          startDate.setMonth(now.getMonth() - 1);
          break;
      }

      // Get sessions and aggregate corrections
      const sessions = await PostureSession.find({
        userId,
        startTime: { $gte: startDate },
        status: "completed",
      }).lean();

      const breakdown = sessions.reduce(
        (acc, session) => {
          acc.headTilt += session.postureMetrics?.headTiltCount || 0;
          acc.shoulderBending +=
            session.postureMetrics?.shoulderBendingCount || 0;
          acc.backBending += session.postureMetrics?.backBendingCount || 0;
          return acc;
        },
        {
          headTilt: 0,
          shoulderBending: 0,
          backBending: 0,
        }
      );

      const total =
        breakdown.headTilt + breakdown.shoulderBending + breakdown.backBending;

      res.json({
        success: true,
        data: {
          period,
          breakdown,
          total,
          percentages:
            total > 0
              ? {
                  headTilt: Math.round((breakdown.headTilt / total) * 100),
                  shoulderBending: Math.round(
                    (breakdown.shoulderBending / total) * 100
                  ),
                  backBending: Math.round(
                    (breakdown.backBending / total) * 100
                  ),
                }
              : { headTilt: 0, shoulderBending: 0, backBending: 0 },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   GET /api/reports/session-comparison
 * @desc    Get session-by-session comparison data
 * @access  Private
 */
router.get(
  "/session-comparison",
  [
    query("limit")
      .optional()
      .isInt({ min: 1, max: 50 })
      .withMessage("Limit must be between 1 and 50"),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const userId = req.userId;
      const limit = parseInt(req.query.limit) || 10;

      // Get recent completed sessions
      const sessions = await PostureSession.find({
        userId,
        status: "completed",
      })
        .sort({ startTime: -1 })
        .limit(limit)
        .lean();

      const sessionData = sessions.reverse().map((session, index) => ({
        sessionNumber: index + 1,
        sessionId: session._id,
        date: session.startTime.toISOString().split("T")[0],
        duration: session.duration,
        overallScore: session.scores?.overallScore || 0,
        headTiltScore: session.scores?.headTiltScore || 0,
        shoulderScore: session.scores?.shoulderAlignmentScore || 0,
        spinalScore: session.scores?.spinalPostureScore || 0,
        totalCorrections: session.postureMetrics?.totalCorrections || 0,
        corrections: {
          headTilt: session.postureMetrics?.headTiltCount || 0,
          shoulder: session.postureMetrics?.shoulderBendingCount || 0,
          back: session.postureMetrics?.backBendingCount || 0,
        },
      }));

      res.json({
        success: true,
        data: {
          sessions: sessionData,
          summary: {
            totalSessions: sessionData.length,
            averageScore:
              sessionData.length > 0
                ? Math.round(
                    sessionData.reduce((sum, s) => sum + s.overallScore, 0) /
                      sessionData.length
                  )
                : 0,
            averageDuration:
              sessionData.length > 0
                ? Math.round(
                    sessionData.reduce((sum, s) => sum + s.duration, 0) /
                      sessionData.length
                  )
                : 0,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   GET /api/reports/hourly-patterns
 * @desc    Get hourly posture patterns for heatmap visualization
 * @access  Private
 */
router.get(
  "/hourly-patterns",
  [
    query("days")
      .optional()
      .isInt({ min: 1, max: 30 })
      .withMessage("Days must be between 1 and 30"),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const userId = req.userId;
      const days = parseInt(req.query.days) || 7;

      // Calculate date range
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - days);

      // Get posture patterns
      const patterns = await PosturePattern.find({
        userId,
        timestamp: { $gte: startDate, $lte: endDate },
      }).lean();

      // Create hourly heatmap data
      const heatmapData = [];

      for (let hour = 0; hour < 24; hour++) {
        const hourData = {
          hour: hour,
          label: `${hour.toString().padStart(2, "0")}:00`,
          avgScore: 0,
          dataPoints: 0,
          scores: [],
        };

        patterns.forEach((pattern) => {
          const patternHour = pattern.timestamp.getHours();
          if (patternHour === hour) {
            hourData.scores.push(pattern.scores?.instantOverallScore || 0);
            hourData.dataPoints++;
          }
        });

        if (hourData.dataPoints > 0) {
          hourData.avgScore = Math.round(
            hourData.scores.reduce((sum, score) => sum + score, 0) /
              hourData.dataPoints
          );
        }

        heatmapData.push({
          hour: hourData.hour,
          label: hourData.label,
          score: hourData.avgScore,
          sessions: hourData.dataPoints,
        });
      }

      res.json({
        success: true,
        data: {
          period: `${days} days`,
          heatmapData,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   GET /api/reports/posture-patterns
 * @desc    Get detailed posture patterns for analysis
 * @access  Private
 */
router.get(
  "/posture-patterns",
  [
    query("sessionId")
      .optional()
      .isMongoId()
      .withMessage("Session ID must be a valid MongoDB ObjectId"),
    query("startDate")
      .optional()
      .isISO8601()
      .withMessage("Start date must be a valid ISO 8601 date"),
    query("endDate")
      .optional()
      .isISO8601()
      .withMessage("End date must be a valid ISO 8601 date"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 1000 })
      .withMessage("Limit must be between 1 and 1000"),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const userId = req.userId;
      const { sessionId, startDate, endDate } = req.query;
      const limit = parseInt(req.query.limit) || 500;

      // Build query filters
      const filters = { userId };

      if (sessionId) {
        filters.sessionId = sessionId;
      }

      if (startDate || endDate) {
        filters.timestamp = {};
        if (startDate) {
          filters.timestamp.$gte = new Date(startDate);
        }
        if (endDate) {
          filters.timestamp.$lte = new Date(endDate);
        }
      }

      // Get posture patterns
      const patterns = await PosturePattern.find(filters)
        .sort({ timestamp: -1 })
        .limit(limit)
        .lean();

      // Process patterns for frontend consumption
      const processedPatterns = patterns.map((pattern) => ({
        id: pattern._id,
        timestamp: pattern.timestamp,
        scores: pattern.scores,
        neckDeviation: pattern.postureData?.neckPosition?.deviation || 0,
        shoulderTilt: pattern.postureData?.shoulderAlignment?.tiltAngle || 0,
        spinalBending:
          pattern.postureData?.spinalCurvature?.overallBending || 0,
        proximity:
          pattern.postureData?.proximityToScreen?.distanceCategory || "optimal",
        issues: pattern.issues || [],
      }));

      res.json({
        success: true,
        data: {
          patterns: processedPatterns,
          count: patterns.length,
          filters: { sessionId, startDate, endDate },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   GET /api/reports/weekly-summary
 * @desc    Get weekly summary with improvement trends
 * @access  Private
 */
router.get("/weekly-summary", async (req, res, next) => {
  try {
    const userId = req.userId;

    // Get current week and previous week
    const today = new Date();
    const currentWeekStart = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() - today.getDay()
    );
    const currentWeekEnd = new Date(currentWeekStart);
    currentWeekEnd.setDate(currentWeekEnd.getDate() + 6);

    const previousWeekStart = new Date(currentWeekStart);
    previousWeekStart.setDate(previousWeekStart.getDate() - 7);
    const previousWeekEnd = new Date(currentWeekStart);
    previousWeekEnd.setDate(previousWeekEnd.getDate() - 1);

    // Get sessions for both weeks
    const [currentWeekSessions, previousWeekSessions] = await Promise.all([
      PostureSession.find({
        userId,
        startTime: { $gte: currentWeekStart, $lte: currentWeekEnd },
        status: "completed",
      }).lean(),
      PostureSession.find({
        userId,
        startTime: { $gte: previousWeekStart, $lte: previousWeekEnd },
        status: "completed",
      }).lean(),
    ]);

    // Calculate metrics for both weeks
    const calculateWeekMetrics = (sessions) => ({
      totalSessions: sessions.length,
      totalTime: sessions.reduce((sum, s) => sum + (s.duration || 0), 0),
      averageScore:
        sessions.length > 0
          ? sessions.reduce(
              (sum, s) => sum + (s.scores?.overallScore || 0),
              0
            ) / sessions.length
          : 0,
      totalCorrections: sessions.reduce(
        (sum, s) => sum + (s.postureMetrics?.totalCorrections || 0),
        0
      ),
    });

    const currentWeek = calculateWeekMetrics(currentWeekSessions);
    const previousWeek = calculateWeekMetrics(previousWeekSessions);

    // Calculate improvements
    const improvements = {
      sessions: currentWeek.totalSessions - previousWeek.totalSessions,
      time: currentWeek.totalTime - previousWeek.totalTime,
      score: currentWeek.averageScore - previousWeek.averageScore,
      corrections: currentWeek.totalCorrections - previousWeek.totalCorrections,
    };

    res.json({
      success: true,
      data: {
        currentWeek: {
          ...currentWeek,
          averageScore: Math.round(currentWeek.averageScore),
          period: {
            start: currentWeekStart.toISOString().split("T")[0],
            end: currentWeekEnd.toISOString().split("T")[0],
          },
        },
        previousWeek: {
          ...previousWeek,
          averageScore: Math.round(previousWeek.averageScore),
          period: {
            start: previousWeekStart.toISOString().split("T")[0],
            end: previousWeekEnd.toISOString().split("T")[0],
          },
        },
        improvements: {
          sessions: improvements.sessions,
          time: improvements.time,
          score: Math.round(improvements.score * 100) / 100,
          corrections: improvements.corrections,
          trend:
            improvements.score > 5
              ? "improving"
              : improvements.score < -5
              ? "declining"
              : "stable",
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/reports/generate-ai-report
 * @desc    Generate an AI-powered comprehensive posture health report
 * @access  Private
 */
router.post("/generate-ai-report", async (req, res) => {
  try {
    const userId = req.userId;
    logger.info(`AI report generation requested by user ${userId}`);

    // Check if Gemini API key is configured
    if (
      !process.env.GEMINI_API_KEY ||
      process.env.GEMINI_API_KEY === "your_gemini_api_key_here"
    ) {
      return res.status(503).json({
        success: false,
        message: "AI report generation is not available. Please configure GEMINI_API_KEY.",
      });
    }

    const result = await generatePostureReport(userId);

    return res.json({
      success: true,
      report: result.report,
      generatedAt: result.generatedAt || new Date().toISOString(),
    });
  } catch (err) {
    logger.error("AI report generation failed:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to generate AI report: " + (err.message || "Unknown error"),
    });
  }
});

/**
 * @route   POST /api/reports/email-ai-report
 * @desc    Generate AI report, embed it into daily email, and send
 * @access  Private
 */
router.post("/email-ai-report", async (req, res) => {
  try {
    const userId = req.userId;
    logger.info(`AI email report requested by user ${userId}`);

    // Check if Gemini API key is configured
    if (
      !process.env.GEMINI_API_KEY ||
      process.env.GEMINI_API_KEY === "your_gemini_api_key_here"
    ) {
      return res.status(503).json({
        success: false,
        message: "AI report generation is not available. Please configure GEMINI_API_KEY.",
      });
    }

    // Step 1: Generate the AI report
    const aiResult = await generatePostureReport(userId);
    const aiReportHtml = renderReportAsEmailHtml(aiResult.report);

    // Step 2: Build the standard daily email
    const { to, subject, html: baseHtml, text: baseText } = await buildDailyEmail(
      userId,
      new Date()
    );

    // Step 3: Inject AI report section into the email HTML
    // Insert the AI report section just before the closing </table> of the main email
    let enhancedHtml = baseHtml;
    const closingTableTag = "</table>\n           </td>\n         </tr>\n       </table>\n     </body>";
    const insertionPoint = enhancedHtml.lastIndexOf("</table>");
    if (insertionPoint > -1) {
      // Find the third-to-last </table> to insert before the footer area
      const tables = [...enhancedHtml.matchAll(/<\/table>/g)];
      // Insert before the second-to-last </table> (main content table)
      const insertIdx = tables.length >= 3 ? tables[tables.length - 3].index : insertionPoint;
      enhancedHtml =
        enhancedHtml.slice(0, insertIdx) +
        aiReportHtml +
        enhancedHtml.slice(insertIdx);
    }

    // Step 4: Enhance the text version
    let enhancedText = baseText;
    if (aiResult.report && aiResult.report.executiveSummary) {
      enhancedText += "\n\n--- AI POSTURE ANALYSIS ---\n";
      enhancedText += aiResult.report.executiveSummary + "\n";
      if (aiResult.report.exerciseRecommendations) {
        enhancedText += "\nRecommended Exercises:\n";
        for (const ex of aiResult.report.exerciseRecommendations) {
          enhancedText += `  - ${ex.name}: ${ex.description} (${ex.duration})\n`;
        }
      }
      if (aiResult.report.actionableInsights) {
        enhancedText += "\nPersonalized Tips:\n";
        for (const tip of aiResult.report.actionableInsights) {
          enhancedText += `  - ${tip}\n`;
        }
      }
    }

    // Step 5: Send the enhanced email
    const enhancedSubject = subject.replace(
      "Daily Posture Report",
      "AI-Enhanced Posture Report"
    );

    const info = await sendMail({
      to,
      subject: enhancedSubject,
      html: enhancedHtml,
      text: enhancedText,
    });

    if (info?.skipped) {
      return res.status(202).json({
        success: false,
        message: "Email skipped (SMTP not configured)",
      });
    }

    return res.json({
      success: true,
      messageId: info.messageId,
      reportGenerated: true,
    });
  } catch (err) {
    logger.error("AI email report failed:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to generate and send AI report: " + (err.message || "Unknown error"),
    });
  }
});

module.exports = router;
