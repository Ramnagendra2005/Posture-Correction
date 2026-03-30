const express = require("express");
const { query, validationResult } = require("express-validator");
const { PostureSession, PosturePattern, DailySummary } = require("../models");
const { buildDailyEmail } = require("../services/dailyReportService");
const { sendMail } = require("../services/emailService");
const logger = require("../utils/logger");

const router = express.Router();

// Send today's daily email to the authenticated user
router.post("/send-daily-email", async (req, res) => {
  try {
    const { to, subject, html } = await buildDailyEmail(req.userId, new Date());

    const info = await sendMail({ to, subject, html });
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

    // Calculate today's metrics (hours)
    const todayTimeTracked = (todaySummary?.totalTimeTracked || 0) / 60; // minutes -> hours

    // Prefer corrections from DailySummary; fall back to sessions sum
    const todayFeedbackCount =
      todaySummary?.totalCorrections?.total ??
      todaySessions.reduce(
        (total, session) =>
          total + (session.postureMetrics?.totalCorrections || 0),
        0
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

    const weekFeedbackCount = weekSessions.reduce(
      (total, session) =>
        total + (session.postureMetrics?.totalCorrections || 0),
      0
    );

    // Calculate current score (latest session)
    const latestSession = todaySessions[0];
    const currentScore = latestSession
      ? latestSession.scores?.overallScore || 0
      : 0;

    // Calculate week average
    const weekAvgScore =
      weekSessions.length > 0
        ? weekSessions.reduce(
            (sum, session) => sum + (session.scores?.overallScore || 0),
            0
          ) / weekSessions.length
        : 0;

    // Calculate trend
    const recentSessions = weekSessions.slice(0, 3);
    const olderSessions = weekSessions.slice(3, 6);
    const recentAvg =
      recentSessions.length > 0
        ? recentSessions.reduce(
            (sum, s) => sum + (s.scores?.overallScore || 0),
            0
          ) / recentSessions.length
        : 0;
    const olderAvg =
      olderSessions.length > 0
        ? olderSessions.reduce(
            (sum, s) => sum + (s.scores?.overallScore || 0),
            0
          ) / olderSessions.length
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

    // Calculate component scores from recent sessions
    const componentScores = {
      headTiltScore: 0,
      shoulderAlignmentScore: 0,
      spinalPostureScore: 0,
      hipBalanceScore: 0, // Dynamic - no default values
      legPositionScore: 0, // Dynamic - no default values
    };

    if (recentSessions.length > 0) {
      componentScores.headTiltScore = Math.round(
        recentSessions.reduce(
          (sum, s) => sum + (s.scores?.headTiltScore || 0),
          0
        ) / recentSessions.length
      );
      componentScores.shoulderAlignmentScore = Math.round(
        recentSessions.reduce(
          (sum, s) => sum + (s.scores?.shoulderAlignmentScore || 0),
          0
        ) / recentSessions.length
      );
      componentScores.spinalPostureScore = Math.round(
        recentSessions.reduce(
          (sum, s) => sum + (s.scores?.spinalPostureScore || 0),
          0
        ) / recentSessions.length
      );
    }

    // Get all daily summaries for cumulative time calculation
    const allDailySummaries = await DailySummary.find({ userId });

    // Get today's daily summary for today's time in consistent format
    const todayDailySummary = await DailySummary.findOne({
      userId,
      date: {
        $gte: todayStart,
        $lt: new Date(todayStart.getTime() + 24 * 60 * 60 * 1000),
      },
    });

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
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = seconds % 60;
      return `${hours}:${minutes.toString().padStart(2, "0")}:${secs
        .toString()
        .padStart(2, "0")}`;
    };

    // Get weekly trend data for charts
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
      const daySessions = weekSessions.filter(
        (s) => s.startTime >= dayStart && s.startTime < dayEnd
      );

      const avgScore =
        daySessions.length > 0
          ? Math.round(
              daySessions.reduce(
                (sum, s) => sum + (s.scores?.overallScore || 0),
                0
              ) / daySessions.length
            )
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
      const daySessionCount = weekSessions.filter(
        (s) => s.startTime >= dayStart && s.startTime < dayEnd
      ).length;

      dailySessionData.push({
        date: dateStr,
        sessions: daySessionCount,
      });
    }

    // Response data
    const summary = {
      currentScore: Math.round(currentScore),
      timeTracked: Math.round(todayTimeTracked * 10) / 10, // TODAY'S time
      todayMinutes: todaySummary?.totalTimeTracked || 0, // precise minutes for today
      todaySessions: todaySessions.length, // TODAY'S session count
      totalSessions: allDailySummaries.reduce(
        (total, summary) => total + (summary.sessionsCount || 0),
        0
      ), // ALL-TIME session count
      totalCorrections: todayFeedbackCount, // TODAY'S corrections
      totalBreaks: Math.floor(todayTimeTracked * 2), // TODAY'S breaks estimate
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
      todayBestScore:
        todaySessions.length > 0
          ? Math.max(...todaySessions.map((s) => s.scores?.overallScore || 0))
          : 0,
      todayAvgScore:
        todaySessions.length > 0
          ? Math.round(
              todaySessions.reduce(
                (sum, s) => sum + (s.scores?.overallScore || 0),
                0
              ) / todaySessions.length
            )
          : 0,
      // Component scores from recent sessions
      ...componentScores,
      // Chart data
      weeklyTrendData,
      dailySessionData,
    };

    res.json({
      success: true,
      summary,
      sessions: weekSessions.map((session) => ({
        id: session._id,
        startTime: session.startTime,
        endTime: session.endTime,
        duration: session.duration,
        overallScore: session.scores?.overallScore || 0,
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

module.exports = router;
