/**
 * Posture API Routes
 * Handles posture tracking, session management, and Flask backend integration
 */

const express = require("express");
const mongoose = require("mongoose");
const { body, validationResult, query } = require("express-validator");
const { PostureSession, DailySummary, User, TrackedTime } = require("../models");
const PostureService = require("../services/postureService");
const logger = require("../utils/logger");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// Accept legacy client identifiers (ObjectId or username) while enforcing
// that all reads/writes stay scoped to the authenticated user.
const isCurrentUserIdentifier = (req, value) => {
  if (value === undefined || value === null || value === "") return true;
  const candidate = String(value);
  const authenticatedId = req.userId?.toString?.();
  const authenticatedUsername = req.user?.username;
  return candidate === authenticatedId || candidate === authenticatedUsername;
};

const normalizeDurationMinutes = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // Handle legacy records accidentally written in seconds.
  if (n > 1000) return n / 60;
  return n;
};

const formatSecondsAsHms = (seconds) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${m.toString().padStart(2, "0")}:${s
    .toString()
    .padStart(2, "0")}`;
};

/**
 * @route   POST /api/posture/track
 * @desc    Receive posture data from Flask backend
 * @access  Private
 */
router.post(
  "/track",
  authenticateToken,
  [
    body("user_id").notEmpty().withMessage("User ID is required"),
    body("session_id").notEmpty().withMessage("Session ID is required"),
    body("date").isISO8601().withMessage("Valid date is required"),
    body("time_tracked")
      .isInt({ min: 0 })
      .withMessage("Time tracked must be a positive integer"),
    body("head_tilt_score")
      .isNumeric()
      .withMessage("Head tilt score must be numeric"),
    body("shoulder_bend_score")
      .isNumeric()
      .withMessage("Shoulder bend score must be numeric"),
    body("back_bend_score")
      .isNumeric()
      .withMessage("Back bend score must be numeric"),
    body("too_close_score")
      .isNumeric()
      .withMessage("Too close score must be numeric"),
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

      const {
        user_id,
        session_id,
        date,
        time_tracked,
        head_tilt_score,
        shoulder_bend_score,
        back_bend_score,
        too_close_score,
        total_corrections = 0,
        correction_breakdown = {},
        total_frames = 0,
      } = req.body;

      if (!isCurrentUserIdentifier(req, user_id)) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: user_id does not match authenticated user",
        });
      }

      // Normalize incoming time_tracked to minutes
      // If looks like seconds (>=1000 and <=86400), convert to minutes. Clamp daily to 1440 minutes.
      const normalizeMinutes = (val) => {
        const n = Number(val);
        if (!Number.isFinite(n) || n < 0) return 0;
        let v = n;
        if (v >= 1000 && v <= 86400) v = Math.round(v / 60); // seconds -> minutes
        // clamp obvious outliers
        if (v > 43200) v = 1440; // >30 days worth of minutes
        return Math.min(v, 1440);
      };

      const timeTrackedMinutes = normalizeMinutes(time_tracked);

      logger.info(
        `Received posture data from Flask for user ${user_id}: ${timeTrackedMinutes} minutes (normalized)`
      );

      // Use the authenticated user
      const user = await User.findById(req.userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Calculate overall posture score
      const total_posture_issues =
        head_tilt_score +
        shoulder_bend_score +
        back_bend_score +
        too_close_score;
      const max_possible_score = 100; // 30 + 35 + 20 + 15
      const overall_score = Math.max(
        0,
        Math.round(100 - (total_posture_issues / max_possible_score) * 100)
      );

      // Find existing session or create new one
      let session = await PostureSession.findOne({
        userId: user._id,
        "deviceInfo.sessionId": session_id,
      });
      const previousSessionDurationMinutes = session
        ? Math.max(0, Number(session.duration) || 0)
        : 0;

      if (!session) {
        // Create new session
        session = new PostureSession({
          userId: user._id,
          startTime: new Date(date),
          status: "active",
          deviceInfo: {
            sessionId: session_id,
            platform: "Flask Backend Integration",
          },
        });
      }

      // Update session with posture data (minutes)
      session.duration = timeTrackedMinutes;
      session.scores = {
        headTiltScore: Math.max(0, 100 - head_tilt_score * 3.33), // Convert 0-30 to 100-0 scale
        shoulderAlignmentScore: Math.max(0, 100 - shoulder_bend_score * 2.86), // Convert 0-35 to 100-0 scale
        spinalPostureScore: Math.max(0, 100 - back_bend_score * 5), // Convert 0-20 to 100-0 scale
        proximityScore: Math.max(0, 100 - too_close_score * 6.67), // Convert 0-15 to 100-0 scale
        overallScore: overall_score,
      };

      session.postureMetrics = {
        headTiltCount: correction_breakdown.head_tilt || 0,
        shoulderBendingCount: correction_breakdown.shoulder_bend || 0,
        backBendingCount: correction_breakdown.back_bend || 0,
        proximityWarnings: correction_breakdown.too_close || 0,
        totalCorrections: total_corrections,
      };

      // Add timestamp to track when data was received
      session.lastUpdate = new Date();

      await session.save();

      // Accumulate only the incremental portion for this session to avoid double-counting
      // when the same session is reported multiple times with increasing duration.
      const trackedMinutesIncrement = Math.max(
        0,
        timeTrackedMinutes - previousSessionDurationMinutes
      );

      // Update or create daily summary
      const today = new Date(date);
      today.setHours(0, 0, 0, 0);

      let dailySummary = await DailySummary.findOne({
        userId: user._id,
        date: today,
      });

      if (!dailySummary) {
        dailySummary = new DailySummary({
          userId: user._id,
          date: today,
          totalTimeTracked: Math.min(trackedMinutesIncrement, 1440),
          sessionsCount: 1,
          averageScores: {
            headTilt: session.scores.headTiltScore,
            shoulderAlignment: session.scores.shoulderAlignmentScore,
            spinalPosture: session.scores.spinalPostureScore,
            overall: overall_score,
          },
          totalCorrections: {
            headTiltCorrections: correction_breakdown.head_tilt || 0,
            shoulderCorrections: correction_breakdown.shoulder_bend || 0,
            backCorrections: correction_breakdown.back_bend || 0,
            proximityWarnings: correction_breakdown.too_close || 0,
            total: total_corrections,
          },
        });
      } else {
        // Update existing summary
        const currentSessions = dailySummary.sessionsCount;
        // Accumulate tracked minutes today; hard-cap at 24h.
        dailySummary.totalTimeTracked = Math.min(
          (dailySummary.totalTimeTracked || 0) + trackedMinutesIncrement,
          1440
        );

        // Update average scores
        dailySummary.averageScores.headTilt = Math.round(
          (dailySummary.averageScores.headTilt * currentSessions +
            session.scores.headTiltScore) /
            (currentSessions + 1)
        );
        dailySummary.averageScores.shoulderAlignment = Math.round(
          (dailySummary.averageScores.shoulderAlignment * currentSessions +
            session.scores.shoulderAlignmentScore) /
            (currentSessions + 1)
        );
        dailySummary.averageScores.spinalPosture = Math.round(
          (dailySummary.averageScores.spinalPosture * currentSessions +
            session.scores.spinalPostureScore) /
            (currentSessions + 1)
        );
        dailySummary.averageScores.overall = Math.round(
          (dailySummary.averageScores.overall * currentSessions +
            overall_score) /
            (currentSessions + 1)
        );

        // Update correction counts
        dailySummary.totalCorrections.headTiltCorrections +=
          correction_breakdown.head_tilt || 0;
        dailySummary.totalCorrections.shoulderCorrections +=
          correction_breakdown.shoulder_bend || 0;
        dailySummary.totalCorrections.backCorrections +=
          correction_breakdown.back_bend || 0;
        dailySummary.totalCorrections.proximityWarnings +=
          correction_breakdown.too_close || 0;
        dailySummary.totalCorrections.total += total_corrections;

        dailySummary.sessionsCount = currentSessions + 1;
      }

      // Compute cumulativeDuration: sum of all prior days' totalTimeTracked (in seconds) + today
      const priorSummaries = await DailySummary.find({
        userId: user._id,
        date: { $lt: today },
      }).select('totalTimeTracked').lean();
      const priorSeconds = priorSummaries.reduce(
        (sum, s) => sum + (s.totalTimeTracked || 0) * 60, 0
      );
      dailySummary.cumulativeDuration = priorSeconds + (dailySummary.totalTimeTracked || 0) * 60;

      await dailySummary.save();

      logger.info(
        `Processed Flask posture data - User: ${user_id}, Score: ${overall_score}, Time: ${timeTrackedMinutes}min`
      );

      res.json({
        success: true,
        message: "Posture data received and processed successfully",
        data: {
          session_id: session._id,
          overall_score: overall_score,
          time_tracked: timeTrackedMinutes,
          total_corrections: total_corrections,
          processed_at: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error("Error processing Flask posture data:", error);
      next(error);
    }
  }
);

/**
 * @route   GET /api/posture/report/daily
 * @desc    Get daily posture report for authenticated user
 * @access  Private
 */
router.get("/report/daily", authenticateToken, async (req, res, next) => {
  try {
    const userId = req.userId;
    const date = req.query.date || new Date().toISOString().split("T")[0];

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Find user by ID (both Flask integration and authenticated user use ID)
    let user;
    user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Get daily summary using raw MongoDB query for better reliability
    const targetDate = new Date(date + "T00:00:00.000Z");

    // Use raw MongoDB collection access to bypass Mongoose issues
    const dailySummary = await mongoose.connection.db
      .collection("dailysummaries")
      .findOne({
        userId: user._id,
        date: targetDate,
      });

    if (!dailySummary) {
      return res.json({
        date: date,
        time_tracked: 0,
        scores: {
          head_tilt: 0,
          shoulder_bend: 0,
          back_bend: 0,
          too_close: 0,
          overall: 0,
        },
        corrections: {
          head_tilt: 0,
          shoulder_bend: 0,
          back_bend: 0,
          too_close: 0,
          total: 0,
        },
        sessions_count: 0,
      });
    }

    // Return summary for the day
    return res.json({
      date: date,
      time_tracked: dailySummary.totalTimeTracked,
      scores: {
        head_tilt: dailySummary.averageScores?.headTilt || 0,
        shoulder_bend: dailySummary.averageScores?.shoulderAlignment || 0,
        back_bend: dailySummary.averageScores?.spinalPosture || 0,
        too_close: dailySummary.averageScores?.proximityScore || 0,
        overall: dailySummary.averageScores?.overall || 0,
      },
      corrections: {
        head_tilt: dailySummary.totalCorrections?.headTiltCorrections || 0,
        shoulder_bend: dailySummary.totalCorrections?.shoulderCorrections || 0,
        back_bend: dailySummary.totalCorrections?.backCorrections || 0,
        too_close: dailySummary.totalCorrections?.proximityWarnings || 0,
        total: dailySummary.totalCorrections?.total || 0,
      },
      sessions_count: dailySummary.sessionsCount || 0,
    });
  } catch (error) {
    logger.error("Error fetching daily report:", error);
    next(error);
  }
});

/**
 * @route   GET /api/posture/report/weekly
 * @desc    Get weekly posture report for authenticated user
 * @access  Private
 */
router.get("/report/weekly", authenticateToken, async (req, res, next) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Find user by ID (both Flask integration and authenticated user use ID)
    let user;
    user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Get last 7 days of data
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 7);

    const weeklySummaries = await DailySummary.find({
      userId: user._id,
      date: { $gte: startDate, $lte: endDate },
    }).sort({ date: 1 });

    // Calculate weekly aggregates
    let totalTime = 0;
    let totalSessions = 0;
    let avgScores = {
      head_tilt: 0,
      shoulder_bend: 0,
      back_bend: 0,
      too_close: 0,
      overall: 0,
    };
    let totalCorrections = {
      head_tilt: 0,
      shoulder_bend: 0,
      back_bend: 0,
      too_close: 0,
      total: 0,
    };

    weeklySummaries.forEach((summary) => {
      totalTime += summary.totalTimeTracked;
      totalSessions += summary.sessionsCount;

      avgScores.head_tilt += summary.averageScores.headTilt;
      avgScores.shoulder_bend += summary.averageScores.shoulderAlignment;
      avgScores.back_bend += summary.averageScores.spinalPosture;
      avgScores.too_close += summary.averageScores.proximityScore || 0;
      avgScores.overall += summary.averageScores.overall;

      totalCorrections.head_tilt +=
        summary.totalCorrections.headTiltCorrections;
      totalCorrections.shoulder_bend +=
        summary.totalCorrections.shoulderCorrections;
      totalCorrections.back_bend += summary.totalCorrections.backCorrections;
      totalCorrections.too_close +=
        summary.totalCorrections.proximityWarnings || 0;
      totalCorrections.total += summary.totalCorrections.total;
    });

    const daysWithData = weeklySummaries.length;
    if (daysWithData > 0) {
      avgScores.head_tilt = Math.round(avgScores.head_tilt / daysWithData);
      avgScores.shoulder_bend = Math.round(
        avgScores.shoulder_bend / daysWithData
      );
      avgScores.back_bend = Math.round(avgScores.back_bend / daysWithData);
      avgScores.too_close = Math.round(avgScores.too_close / daysWithData);
      avgScores.overall = Math.round(avgScores.overall / daysWithData);
    }

    res.json({
      week_start: startDate.toISOString().split("T")[0],
      week_end: endDate.toISOString().split("T")[0],
      total_time_tracked: totalTime,
      total_sessions: totalSessions,
      days_active: daysWithData,
      average_scores: avgScores,
      total_corrections: totalCorrections,
      daily_breakdown: weeklySummaries.map((summary) => ({
        date: summary.date.toISOString().split("T")[0],
        time_tracked: summary.totalTimeTracked,
        sessions: summary.sessionsCount,
        overall_score: summary.averageScores.overall,
      })),
    });
  } catch (error) {
    logger.error("Error fetching weekly report:", error);
    next(error);
  }
});

/**
 * @route   GET /api/posture/report/monthly
 * @desc    Get monthly posture report for authenticated user
 * @access  Private
 */
router.get("/report/monthly", authenticateToken, async (req, res, next) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Find user by ID (both Flask integration and authenticated user use ID)
    let user;
    user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Get last 30 days of data
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 30);

    const monthlySummaries = await DailySummary.find({
      userId: user._id,
      date: { $gte: startDate, $lte: endDate },
    }).sort({ date: 1 });

    // Calculate monthly aggregates
    let totalTime = 0;
    let totalSessions = 0;
    let avgScores = {
      head_tilt: 0,
      shoulder_bend: 0,
      back_bend: 0,
      too_close: 0,
      overall: 0,
    };
    let totalCorrections = {
      head_tilt: 0,
      shoulder_bend: 0,
      back_bend: 0,
      too_close: 0,
      total: 0,
    };

    monthlySummaries.forEach((summary) => {
      totalTime += summary.totalTimeTracked;
      totalSessions += summary.sessionsCount;

      avgScores.head_tilt += summary.averageScores.headTilt;
      avgScores.shoulder_bend += summary.averageScores.shoulderAlignment;
      avgScores.back_bend += summary.averageScores.spinalPosture;
      avgScores.too_close += summary.averageScores.proximityScore || 0;
      avgScores.overall += summary.averageScores.overall;

      totalCorrections.head_tilt +=
        summary.totalCorrections.headTiltCorrections;
      totalCorrections.shoulder_bend +=
        summary.totalCorrections.shoulderCorrections;
      totalCorrections.back_bend += summary.totalCorrections.backCorrections;
      totalCorrections.too_close +=
        summary.totalCorrections.proximityWarnings || 0;
      totalCorrections.total += summary.totalCorrections.total;
    });

    const daysWithData = monthlySummaries.length;
    if (daysWithData > 0) {
      avgScores.head_tilt = Math.round(avgScores.head_tilt / daysWithData);
      avgScores.shoulder_bend = Math.round(
        avgScores.shoulder_bend / daysWithData
      );
      avgScores.back_bend = Math.round(avgScores.back_bend / daysWithData);
      avgScores.too_close = Math.round(avgScores.too_close / daysWithData);
      avgScores.overall = Math.round(avgScores.overall / daysWithData);
    }

    res.json({
      month_start: startDate.toISOString().split("T")[0],
      month_end: endDate.toISOString().split("T")[0],
      total_time_tracked: totalTime,
      total_sessions: totalSessions,
      days_active: daysWithData,
      average_scores: avgScores,
      total_corrections: totalCorrections,
      weekly_breakdown: getWeeklyBreakdown(monthlySummaries),
    });
  } catch (error) {
    logger.error("Error fetching monthly report:", error);
    next(error);
  }
});

/**
 * @route   GET /api/posture/heatmap/:year
 * @desc    Get heatmap data for GitHub-style activity grid (UNIFIED ENDPOINT)
 * @access  Private
 */
router.get("/heatmap/:year", authenticateToken, async (req, res, next) => {
  try {
    const userId = req.userId;
    const year = parseInt(req.params.year) || new Date().getFullYear();

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Find user by ID
    let user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Get year range
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31, 23, 59, 59);

    // Get daily summaries for the year
    const heatmapSummaries = await DailySummary.find({
      userId: user._id,
      date: { $gte: startDate, $lte: endDate },
    }).sort({ date: 1 });

    // Create heatmap data array with proper structure
    const heatmap_data = heatmapSummaries.map((summary) => ({
      // Support both canonical camelCase fields and legacy snake_case fields in stored docs.
      date: summary.date.toISOString().split("T")[0],
      total_time_tracked: summary.totalTimeTracked || summary.total_time_tracked || 0,
      session_count: summary.sessionsCount || summary.session_count || 0,
      average_scores: {
        overall:
          summary.averageScores?.overall || summary.average_scores?.overall || 0,
        head_tilt:
          summary.averageScores?.headTilt || summary.average_scores?.head_tilt || 0,
        shoulder_bend:
          summary.averageScores?.shoulderAlignment ||
          summary.average_scores?.shoulder_bend ||
          0,
        back_bend:
          summary.averageScores?.spinalPosture || summary.average_scores?.back_bend || 0,
        too_close:
          summary.averageScores?.proximityScore || summary.average_scores?.too_close || 0,
      },
      total_corrections: {
        head_tilt:
          summary.totalCorrections?.headTiltCorrections ||
          summary.total_corrections?.head_tilt ||
          0,
        shoulder_bend:
          summary.totalCorrections?.shoulderCorrections ||
          summary.total_corrections?.shoulder_bend ||
          0,
        back_bend:
          summary.totalCorrections?.backCorrections ||
          summary.total_corrections?.back_bend ||
          0,
        too_close:
          summary.totalCorrections?.proximityWarnings ||
          summary.total_corrections?.too_close ||
          0,
        total: summary.totalCorrections?.total || summary.total_corrections?.total || 0,
      },
    }));

    res.json({
      success: true,
      heatmap_data: heatmap_data,
      year: year,
      user_id: userId,
      active_days: heatmap_data.length,
      date_range: {
        start: startDate.toISOString().split("T")[0],
        end: endDate.toISOString().split("T")[0],
      },
    });
  } catch (error) {
    logger.error("Error fetching heatmap data:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch heatmap data",
      error: error.message,
    });
  }
});

/**
 * @route   GET /api/posture/hourly-activity
 * @desc    Get hourly activity heatmap data for the user
 * @access  Private
 */
router.get("/hourly-activity", authenticateToken, async (req, res, next) => {
  try {
    const userId = req.userId;
    const days = parseInt(req.query.days) || 7;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - days);

    // Get all sessions in the period
    const sessions = await PostureSession.find({
      userId,
      startTime: { $gte: startDate, $lte: endDate },
      status: "completed",
    }).lean();

    // Aggregate by hour
    const heatmap = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      count: 0,
      avgScore: 0,
    }));

    sessions.forEach((session) => {
      const hour = new Date(session.startTime).getHours();
      heatmap[hour].count += 1;
      heatmap[hour].avgScore += session.scores?.overallScore || 0;
    });

    heatmap.forEach((h) => {
      if (h.count > 0) h.avgScore = Math.round(h.avgScore / h.count);
    });

    res.json({
      success: true,
      data: heatmap,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/posture/today-overview
 * @desc    Get today's posture overview
 * @access  Private
 */
router.get("/today-overview", authenticateToken, async (req, res, next) => {
  try {
    const userId = req.userId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get today's sessions
    const todaysSessions = await PostureSession.find({
      userId,
      startTime: { $gte: today, $lt: tomorrow },
    }).lean();

    const dailySummary = await DailySummary.findOne({
      userId,
      date: today,
    }).lean();

    const tracked = await TrackedTime.findOne({ userId, date: today }).lean();

    // Get active session
    const activeSession = PostureService.getActiveSession(userId);

    // Fallback active session from DB when runtime cache is empty.
    const activeDbSession = await PostureSession.findOne({
      userId,
      status: "active",
      startTime: { $gte: today, $lt: tomorrow },
    })
      .sort({ startTime: -1 })
      .lean();

    const activeSessionStart =
      activeSession?.startTime || activeDbSession?.startTime || null;
    const activeSessionSeconds = activeSessionStart
      ? Math.max(0, Math.floor((Date.now() - new Date(activeSessionStart).getTime()) / 1000))
      : 0;

    // Calculate totals
    const totalSessions = todaysSessions.length;
    const sessionsMinutes = todaysSessions.reduce(
      (sum, session) => sum + (session.duration || 0),
      0
    );
    const normalizedSessionsMinutes = normalizeDurationMinutes(sessionsMinutes);

    const summaryMinutes = normalizeDurationMinutes(dailySummary?.totalTimeTracked || 0);
    const summarySeconds = Math.round(summaryMinutes * 60);
    const trackedTodaySeconds = Math.max(
      0,
      Number(tracked?.todaysTimeTrackedSeconds || 0)
    );
    const trackedSessionSeconds = Math.max(
      0,
      Number(tracked?.currentSessionTimeSeconds || 0)
    );

    const currentSessionTimeSeconds = Math.max(
      trackedSessionSeconds,
      activeSessionSeconds
    );
    const todaysTimeTrackedSeconds = Math.max(
      trackedTodaySeconds,
      summarySeconds,
      Math.round(normalizedSessionsMinutes * 60),
      currentSessionTimeSeconds
    );
    const totalTimeTracked = todaysTimeTrackedSeconds / 60;

    const totalCorrections = todaysSessions.reduce(
      (sum, session) => sum + (session.postureMetrics?.totalCorrections || 0),
      0
    );
    const correctionsFromSummary = Number(dailySummary?.totalCorrections?.total || 0);

    // Calculate average score
    const averageScore =
      totalSessions > 0
        ? Math.round(
            todaysSessions.reduce(
              (sum, session) => sum + (session.scores?.overallScore || 0),
              0
            ) / totalSessions
          )
        : 0;
    const averageScoreFromSummary = Math.round(Number(dailySummary?.averageScores?.overall || 0));

    // Compute cumulative duration as prior days + today's tracked seconds.
    const priorSummaries = await DailySummary.find({
      userId,
      date: { $lt: today },
    })
      .select("totalTimeTracked")
      .lean();
    const priorSeconds = priorSummaries.reduce(
      (sum, s) => sum + Math.round(normalizeDurationMinutes(s.totalTimeTracked || 0) * 60),
      0
    );
    const cumulativeTimeSeconds = priorSeconds + Math.round(todaysTimeTrackedSeconds);
    const hasActiveSession =
      !!activeSession || !!activeDbSession || currentSessionTimeSeconds > 0;

    res.json({
      success: true,
      data: {
        totalSessions,
        totalTimeTracked,
        totalTimeTrackedSeconds: Math.round(todaysTimeTrackedSeconds),
        todaysTimeTrackedSeconds: Math.round(todaysTimeTrackedSeconds),
        currentSessionTimeSeconds: Math.round(currentSessionTimeSeconds),
        totalCorrections: Math.max(totalCorrections, correctionsFromSummary),
        averageScore: Math.max(averageScore, averageScoreFromSummary),
        hasActiveSession,
        activeSessionId:
          activeSession?.sessionId || activeDbSession?.deviceInfo?.sessionId || null,
        cumulativeTime: formatSecondsAsHms(cumulativeTimeSeconds),
        cumulativeTimeSeconds,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Helper function for weekly breakdown
function getWeeklyBreakdown(monthlySummaries) {
  const weeks = [];
  let currentWeek = [];
  let weekStart = null;

  monthlySummaries.forEach((summary, index) => {
    const summaryDate = new Date(summary.date);
    const dayOfWeek = summaryDate.getDay(); // 0 = Sunday

    if (dayOfWeek === 0 || currentWeek.length === 0) {
      // Start new week on Sunday
      if (currentWeek.length > 0) {
        weeks.push({
          week_start: weekStart.toISOString().split("T")[0],
          week_end: currentWeek[currentWeek.length - 1].date
            .toISOString()
            .split("T")[0],
          days: currentWeek.length,
          total_time: currentWeek.reduce(
            (sum, day) => sum + day.totalTimeTracked,
            0
          ),
          total_sessions: currentWeek.reduce(
            (sum, day) => sum + day.sessionsCount,
            0
          ),
          avg_score: Math.round(
            currentWeek.reduce(
              (sum, day) => sum + day.averageScores.overall,
              0
            ) / currentWeek.length
          ),
        });
      }
      currentWeek = [summary];
      weekStart = summaryDate;
    } else {
      currentWeek.push(summary);
    }
  });

  // Add the last week if it exists
  if (currentWeek.length > 0) {
    weeks.push({
      week_start: weekStart.toISOString().split("T")[0],
      week_end: currentWeek[currentWeek.length - 1].date
        .toISOString()
        .split("T")[0],
      days: currentWeek.length,
      total_time: currentWeek.reduce(
        (sum, day) => sum + day.totalTimeTracked,
        0
      ),
      total_sessions: currentWeek.reduce(
        (sum, day) => sum + day.sessionsCount,
        0
      ),
      avg_score: Math.round(
        currentWeek.reduce((sum, day) => sum + day.averageScores.overall, 0) /
          currentWeek.length
      ),
    });
  }

  return weeks;
}

// Get trend data for progress charts
router.get("/trend/:timeRange", authenticateToken, async (req, res) => {
  try {
    const { timeRange } = req.params;
    const targetUserId = req.userId;
    const targetUserObjectId = mongoose.Types.ObjectId.isValid(targetUserId)
      ? new mongoose.Types.ObjectId(targetUserId)
      : null;

    // Calculate date range based on timeRange
    const now = new Date();
    let startDate;
    let groupBy;

    switch (timeRange) {
      case "daily":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // Last 7 days
        groupBy = "$dayOfYear";
        break;
      case "weekly":
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // Last 30 days
        groupBy = "$week";
        break;
      case "monthly":
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000); // Last year
        groupBy = "$month";
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        groupBy = "$dayOfYear";
    }

    const trendData = await PostureSession.aggregate([
      {
        $addFields: {
          normalizedUserId: { $ifNull: ["$userId", "$user_id"] },
          normalizedStartTime: { $ifNull: ["$startTime", "$start_time"] },
          normalizedCorrections: { $ifNull: ["$postureMetrics", "$corrections"] },
          normalizedScores: "$scores",
        },
      },
      {
        $match: {
          normalizedStartTime: { $gte: startDate },
          $or: [
            { normalizedUserId: targetUserId },
            ...(targetUserObjectId
              ? [{ normalizedUserId: targetUserObjectId }]
              : []),
          ],
        },
      },
      {
        $group: {
          _id: {
            date: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$normalizedStartTime",
              },
            },
          },
          total_time_tracked: { $sum: "$duration" },
          session_count: { $sum: 1 },
          total_corrections: {
            $push: "$normalizedCorrections",
          },
          average_scores: {
            $push: "$normalizedScores",
          },
        },
      },
      {
        $project: {
          _id: 0,
          date: "$_id.date",
          total_time_tracked: 1,
          session_count: 1,
          total_corrections: {
            head_tilt: {
              $sum: {
                $map: {
                  input: "$total_corrections",
                  as: "correction",
                  in: {
                    $ifNull: ["$$correction.head_tilt", "$$correction.headTiltCount"],
                  },
                },
              },
            },
            shoulder_bend: {
              $sum: {
                $map: {
                  input: "$total_corrections",
                  as: "correction",
                  in: {
                    $ifNull: [
                      "$$correction.shoulder_bend",
                      "$$correction.shoulderBendingCount",
                    ],
                  },
                },
              },
            },
            back_bend: {
              $sum: {
                $map: {
                  input: "$total_corrections",
                  as: "correction",
                  in: {
                    $ifNull: ["$$correction.back_bend", "$$correction.backBendingCount"],
                  },
                },
              },
            },
            too_close: {
              $sum: {
                $map: {
                  input: "$total_corrections",
                  as: "correction",
                  in: {
                    $ifNull: ["$$correction.too_close", "$$correction.proximityWarnings"],
                  },
                },
              },
            },
          },
          average_scores: {
            overall: {
              $avg: {
                $map: {
                  input: "$average_scores",
                  as: "score",
                  in: { $ifNull: ["$$score.overall", "$$score.overallScore"] },
                },
              },
            },
            head_tilt: {
              $avg: {
                $map: {
                  input: "$average_scores",
                  as: "score",
                  in: {
                    $ifNull: ["$$score.head_tilt", "$$score.headTiltScore"],
                  },
                },
              },
            },
            shoulder_bend: {
              $avg: {
                $map: {
                  input: "$average_scores",
                  as: "score",
                  in: {
                    $ifNull: [
                      "$$score.shoulder_bend",
                      "$$score.shoulderAlignmentScore",
                    ],
                  },
                },
              },
            },
            back_bend: {
              $avg: {
                $map: {
                  input: "$average_scores",
                  as: "score",
                  in: {
                    $ifNull: ["$$score.back_bend", "$$score.spinalPostureScore"],
                  },
                },
              },
            },
          },
        },
      },
      {
        $sort: { date: 1 },
      },
    ]);

    res.json({
      success: true,
      trend_data: trendData,
      time_range: timeRange,
      user_id: targetUserId,
    });
  } catch (error) {
    logger.error("Error fetching trend data:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch trend data",
      error: error.message,
    });
  }
});

// Trend data endpoint continues here...

/**
 * @route   POST /api/posture/update-realtime
 * @desc    Update realtime posture data from Flask backend (ENHANCED FOR DYNAMIC STORAGE)
 * @access  Private
 */
router.post("/update-realtime", authenticateToken, async (req, res, next) => {
  try {
    const {
      user_id,
      session_id,
      scores,
      feedback,
      blink_rate,
      timestamp,
      duration_seconds,
    } = req.body;
    const feedbackList = Array.isArray(feedback) ? feedback : [];
    const correctionIncrement = Array.isArray(feedback)
      ? feedback.length
      : Math.max(0, Number(feedback) || 0);

    const authenticatedUserId = req.userId?.toString?.();

    if (!authenticatedUserId || !session_id) {
      return res.status(400).json({
        success: false,
        message: "Authentication and session ID are required",
      });
    }

    if (!isCurrentUserIdentifier(req, user_id)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: user_id does not match authenticated user",
      });
    }

    logger.info(
      `Real-time update for user: ${authenticatedUserId}, session: ${session_id}`
    );

    // Find user by ID first to ensure proper data association
    const user = await User.findById(authenticatedUserId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Find or create today's session with better session management
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let session = await PostureSession.findOne({
      userId: authenticatedUserId,
      "deviceInfo.sessionId": session_id,
      startTime: { $gte: today },
    });
    const previousSessionDuration = session
      ? Math.max(0, Number(session.duration) || 0)
      : 0;

    if (!session) {
      // Create new session with comprehensive data structure
      session = new PostureSession({
        userId: authenticatedUserId,
        startTime: new Date(timestamp || Date.now()),
        scores: {
          headTiltScore: scores?.headTilt || 0,
          shoulderAlignmentScore: scores?.shoulderAlignment || 0,
          spinalPostureScore: scores?.spinalPosture || 0,
          hipBalance: scores?.hipBalance || 0,
          legPosition: scores?.legPosition || 0,
          overallScore: scores?.overallScore || 0,
        },
        postureMetrics: {
          totalCorrections: correctionIncrement,
          headTiltCount: 0,
          shoulderBendingCount: 0,
          backBendingCount: 0,
          proximityWarnings: 0,
          averagePostureScore: scores?.overallScore || 0,
          blinkRate: blink_rate || 0,
        },
        deviceInfo: {
          sessionId: session_id,
          platform: "Real-time Analysis",
        },
        feedback: feedbackList,
        status: "active",
      });
      session.duration = Math.max(0, Number(duration_seconds) || 0) / 60;

      logger.info(`Created new session for user ${authenticatedUserId}`);
    } else {
      // Update existing session with incremental data
      session.scores = {
        headTiltScore: scores?.headTilt || session.scores?.headTiltScore || 0,
        shoulderAlignmentScore:
          scores?.shoulderAlignment ||
          session.scores?.shoulderAlignmentScore ||
          0,
        spinalPostureScore:
          scores?.spinalPosture || session.scores?.spinalPostureScore || 0,
        hipBalance: scores?.hipBalance || session.scores?.hipBalance || 0,
        legPosition: scores?.legPosition || session.scores?.legPosition || 0,
        overallScore: scores?.overallScore || session.scores?.overallScore || 0,
      };

      session.postureMetrics = {
        ...session.postureMetrics,
        totalCorrections:
          (session.postureMetrics?.totalCorrections || 0) + correctionIncrement,
        averagePostureScore:
          scores?.overallScore ||
          session.postureMetrics?.averagePostureScore ||
          0,
        blinkRate: blink_rate || session.postureMetrics?.blinkRate || 0,
      };

      if (feedbackList.length > 0) {
        session.feedback = [...(session.feedback || []), ...feedbackList];
      }

      session.endTime = new Date(timestamp || Date.now());
      session.duration =
        duration_seconds !== undefined && duration_seconds !== null
          ? Math.max(0, Number(duration_seconds) || 0) / 60
          : Math.floor((session.endTime - session.startTime) / (1000 * 60));
      session.lastUpdate = new Date();

      logger.info(`Updated existing session for user ${authenticatedUserId}`);
    }

    await session.save();

    // Accumulate only newly added duration for this session update.
    const sessionDurationIncrement = Math.max(
      0,
      (Number(session.duration) || 0) - previousSessionDuration
    );

    // Update or create daily summary with REAL-TIME DATA PERSISTENCE
    const dateStr = today.toISOString().split("T")[0];
    let dailySummary = await DailySummary.findOne({
      userId: authenticatedUserId,
      date: today,
    });

    if (!dailySummary) {
      // Create new daily summary
      dailySummary = new DailySummary({
        userId: authenticatedUserId,
        date: today,
        totalTimeTracked: sessionDurationIncrement,
        averageScores: {
          headTilt: scores?.headTilt || 0,
          shoulderAlignment: scores?.shoulderAlignment || 0,
          spinalPosture: scores?.spinalPosture || 0,
          hipBalance: scores?.hipBalance || 0,
          legPosition: scores?.legPosition || 0,
          overall: scores?.overallScore || 0,
        },
        totalCorrections: {
          headTiltCorrections: 0,
          shoulderCorrections: 0,
          backCorrections: 0,
          proximityWarnings: 0,
          total: correctionIncrement,
        },
        sessionsCount: 1,
      });

      logger.info(
        `Created new daily summary for user ${authenticatedUserId} on ${dateStr}`
      );
    } else {
      // Update existing daily summary with weighted averages
      const currentSessions = dailySummary.sessionsCount;
      dailySummary.totalTimeTracked =
        (dailySummary.totalTimeTracked || 0) + sessionDurationIncrement;

      // Calculate weighted averages for scores
      if (scores) {
        dailySummary.averageScores = {
          headTilt:
            scores.headTilt !== undefined
              ? Math.round(
                  ((dailySummary.averageScores?.headTilt || 0) *
                    currentSessions +
                    scores.headTilt) /
                    (currentSessions + 1)
                )
              : dailySummary.averageScores?.headTilt || 0,
          shoulderAlignment:
            scores.shoulderAlignment !== undefined
              ? Math.round(
                  ((dailySummary.averageScores?.shoulderAlignment || 0) *
                    currentSessions +
                    scores.shoulderAlignment) /
                    (currentSessions + 1)
                )
              : dailySummary.averageScores?.shoulderAlignment || 0,
          spinalPosture:
            scores.spinalPosture !== undefined
              ? Math.round(
                  ((dailySummary.averageScores?.spinalPosture || 0) *
                    currentSessions +
                    scores.spinalPosture) /
                    (currentSessions + 1)
                )
              : dailySummary.averageScores?.spinalPosture || 0,
          hipBalance:
            scores.hipBalance !== undefined
              ? Math.round(
                  ((dailySummary.averageScores?.hipBalance || 0) *
                    currentSessions +
                    scores.hipBalance) /
                    (currentSessions + 1)
                )
              : dailySummary.averageScores?.hipBalance || 0,
          legPosition:
            scores.legPosition !== undefined
              ? Math.round(
                  ((dailySummary.averageScores?.legPosition || 0) *
                    currentSessions +
                    scores.legPosition) /
                    (currentSessions + 1)
                )
              : dailySummary.averageScores?.legPosition || 0,
          overall:
            scores.overallScore !== undefined
              ? Math.round(
                  ((dailySummary.averageScores?.overall || 0) *
                    currentSessions +
                    scores.overallScore) /
                    (currentSessions + 1)
                )
              : dailySummary.averageScores?.overall || 0,
        };
      }

      // Increment correction counts
      dailySummary.totalCorrections = {
        headTiltCorrections:
          dailySummary.totalCorrections?.headTiltCorrections || 0,
        shoulderCorrections:
          dailySummary.totalCorrections?.shoulderCorrections || 0,
        backCorrections: dailySummary.totalCorrections?.backCorrections || 0,
        proximityWarnings:
          dailySummary.totalCorrections?.proximityWarnings || 0,
        total:
          (dailySummary.totalCorrections?.total || 0) + correctionIncrement,
      };

      dailySummary.sessionsCount = currentSessions + 1;

      logger.info(
        `Updated daily summary for user ${authenticatedUserId} on ${dateStr}`
      );
    }

    // Compute cumulativeDuration: sum of all prior days' totalTimeTracked (in seconds) + today
    const priorSummaries = await DailySummary.find({
      userId: authenticatedUserId,
      date: { $lt: today },
    }).select('totalTimeTracked').lean();
    const priorSeconds = priorSummaries.reduce(
      (sum, s) => sum + (s.totalTimeTracked || 0) * 60, 0
    );
    dailySummary.cumulativeDuration = priorSeconds + (dailySummary.totalTimeTracked || 0) * 60;

    await dailySummary.save();

    // --- Persist tracked time to TrackedTime collection ---
    // This ensures the today-overview endpoint reads accurate
    // todaysTimeTrackedSeconds / currentSessionTimeSeconds values
    // instead of relying solely on the fallback activeSessionSeconds
    // calculation, which can lag behind the real ticking timer.
    const currentSessionSec = Math.max(0, Math.round(Number(duration_seconds) || 0));
    const todayTotalSec = Math.max(
      currentSessionSec,
      Math.round((dailySummary.totalTimeTracked || 0) * 60)
    );
    await TrackedTime.findOneAndUpdate(
      { userId: authenticatedUserId, date: today },
      {
        $max: {
          todaysTimeTrackedSeconds: todayTotalSec,
          currentSessionTimeSeconds: currentSessionSec,
        },
      },
      { upsert: true }
    );

    // Return comprehensive response for frontend
    res.json({
      success: true,
      message: "Realtime data updated successfully",
      data: {
        sessionId: session.deviceInfo?.sessionId || session_id,
        userId: authenticatedUserId,
        currentScores: session.scores,
        totalCorrections: dailySummary.totalCorrections.total,
        sessionDuration: session.duration || 0,
        dailyStats: {
          totalTime: dailySummary.totalTimeTracked,
          averageScore: dailySummary.averageScores.overall,
          totalSessions: dailySummary.sessionsCount,
        },
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error("Error updating realtime posture data:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update realtime data",
      error: error.message,
    });
  }
});

// Get hourly trends for real-time charts
router.get("/hourly-trends", authenticateToken, async (req, res) => {
  try {
    const userId = req.userId || req.user?._id;
    console.log(`📊 Fetching hourly trends for user: ${userId}`);

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Get today's hourly data for real-time trends
    const todaySessions = await PostureSession.find({
      userId,
      createdAt: {
        $gte: today,
        $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
      },
    }).sort({ createdAt: 1 });

    // Generate hourly data for today (0-23 hours)
    const hourlyData = [];
    for (let hour = 0; hour < 24; hour++) {
      const hourStart = new Date(today.getTime() + hour * 60 * 60 * 1000);
      const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);

      const hourSessions = todaySessions.filter((session) => {
        const sessionHour = session.createdAt.getHours();
        return sessionHour === hour;
      });

      if (hourSessions.length > 0) {
        const avgOverall =
          hourSessions.reduce((sum, s) => sum + (s.overallScore || 0), 0) /
          hourSessions.length;
        const avgHead =
          hourSessions.reduce((sum, s) => sum + (s.headTiltScore || 0), 0) /
          hourSessions.length;
        const avgShoulder =
          hourSessions.reduce(
            (sum, s) => sum + (s.shoulderAlignmentScore || 0),
            0
          ) / hourSessions.length;
        const avgSpinal =
          hourSessions.reduce(
            (sum, s) => sum + (s.spinalPostureScore || 0),
            0
          ) / hourSessions.length;

        hourlyData.push({
          hour,
          overallScore: Math.round(avgOverall * 10) / 10,
          headTiltScore: Math.round(avgHead * 10) / 10,
          shoulderScore: Math.round(avgShoulder * 10) / 10,
          spinalScore: Math.round(avgSpinal * 10) / 10,
          sessionCount: hourSessions.length,
        });
      } else if (hour <= now.getHours()) {
        // Show 0 scores for hours that have passed but have no data
        hourlyData.push({
          hour,
          overallScore: 0,
          headTiltScore: 0,
          shoulderScore: 0,
          spinalScore: 0,
          sessionCount: 0,
        });
      }
    }

    // Get daily trends for the past 7 days
    const dailyTrends = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date(
        sevenDaysAgo.getTime() + i * 24 * 60 * 60 * 1000
      );
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

      const daySessions = await PostureSession.find({
        userId,
        createdAt: { $gte: dayStart, $lt: dayEnd },
      });

      if (daySessions.length > 0) {
        const avgScore =
          daySessions.reduce((sum, s) => sum + (s.overallScore || 0), 0) /
          daySessions.length;
        const totalTime = daySessions.reduce(
          (sum, s) => sum + (s.duration || 0),
          0
        );

        dailyTrends.push({
          date: dayStart.toISOString().split("T")[0],
          averageScore: Math.round(avgScore * 10) / 10,
          totalTime: Math.round(totalTime / 60), // Convert to minutes
          sessionCount: daySessions.length,
        });
      } else {
        dailyTrends.push({
          date: dayStart.toISOString().split("T")[0],
          averageScore: 0,
          totalTime: 0,
          sessionCount: 0,
        });
      }
    }

    console.log(
      `📊 Generated ${hourlyData.length} hourly data points and ${dailyTrends.length} daily trends`
    );

    res.json({
      success: true,
      hourlyData,
      dailyTrends,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error fetching hourly trends:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch hourly trends",
      error: error.message,
    });
  }
});

// Live dashboard endpoint for real-time stats
router.get("/live-dashboard", authenticateToken, async (req, res) => {
  try {
    const userId = req.userId || req.user?._id;
    console.log(`📊 Fetching live dashboard stats for user: ${userId}`);

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Get today's sessions
    const todaySessions = await PostureSession.find({
      userId,
      createdAt: { $gte: today },
    });

    // Get today's daily summary
    const todaySummary = await DailySummary.findOne({
      userId,
      date: today,
    });

    // Calculate live stats
    const currentScore =
      todaySessions.length > 0
        ? todaySessions[todaySessions.length - 1].overallScore || 0
        : 0;

    const sessionsToday = todaySessions.length;
    const timeToday = todaySummary ? todaySummary.totalTimeTracked : 0;
    const averageScore =
      todaySessions.length > 0
        ? todaySessions.reduce((sum, s) => sum + (s.overallScore || 0), 0) /
          todaySessions.length
        : 0;
    const totalCorrections = todaySummary
      ? todaySummary.totalCorrections.total
      : 0;

    console.log(
      `📊 Live stats: Score: ${currentScore}%, Sessions: ${sessionsToday}, Time: ${timeToday}s`
    );

    res.json({
      currentScore: Math.round(currentScore),
      sessionsToday,
      timeToday,
      averageScore: Math.round(averageScore * 10) / 10,
      totalCorrections,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error fetching live dashboard stats:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch live dashboard stats",
      error: error.message,
    });
  }
});

module.exports = router;

// --- Appended: Tracked Time Integration Endpoints ---
// Minimal endpoints for Flask and Frontend to sync and fetch tracked time

/**
 * @route POST /api/posture/tracked-time
 * @desc  Upsert tracked time for a user/date (from Flask or Frontend)
 * @access Private
 */
router.post("/tracked-time", authenticateToken, async (req, res) => {
  try {
    const {
      user_id,
      date,
      todays_time_tracked_seconds,
      current_session_time_seconds,
    } = req.body || {};
    if (!req.userId || !date) {
      return res
        .status(400)
        .json({ success: false, message: "Authentication and date are required" });
    }

    if (!isCurrentUserIdentifier(req, user_id)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: user_id does not match authenticated user",
      });
    }

    // Use the authenticated user
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Normalize date to midnight
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);

    const update = {
      todaysTimeTrackedSeconds: Math.max(
        0,
        Number(todays_time_tracked_seconds || 0)
      ),
      currentSessionTimeSeconds: Math.max(
        0,
        Number(current_session_time_seconds || 0)
      ),
    };

    const doc = await TrackedTime.findOneAndUpdate(
      { userId: user._id, date: d },
      { $set: update },
      { new: true, upsert: true }
    );

    return res.json({ success: true, data: doc });
  } catch (err) {
    logger.error("Error upserting tracked time", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/**
 * @route GET /api/posture/tracked-time
 * @desc  Get tracked time for a user/date (for Frontend display)
 * @access Private
 */
router.get("/tracked-time", authenticateToken, async (req, res) => {
  try {
    const userId = req.query.user_id || req.userId;
    const date = req.query.date;
    if (!req.userId || !date) {
      return res
        .status(400)
        .json({ success: false, message: "Authentication and date are required" });
    }

    if (!isCurrentUserIdentifier(req, userId)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: user_id does not match authenticated user",
      });
    }

    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const doc = await TrackedTime.findOne({ userId: req.userId, date: d });
    return res.json({ success: true, data: doc });
  } catch (err) {
    logger.error("Error fetching tracked time", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// --- Appended: Normalized variants to avoid date parsing issues ---
function toLocalMidnight(jsDateLike) {
  try {
    if (typeof jsDateLike === "string") {
      // Support 'YYYY-MM-DD' and ISO timestamps
      if (/^\d{4}-\d{2}-\d{2}$/.test(jsDateLike)) {
        const [y, m, d] = jsDateLike.split("-").map((v) => parseInt(v, 10));
        return new Date(y, m - 1, d, 0, 0, 0, 0);
      }
      const d = new Date(jsDateLike);
      return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    }
    const d = new Date(jsDateLike);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  } catch {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  }
}

/**
 * @route POST /api/posture/tracked-time-normalized
 * @desc  Upsert tracked time with robust local-midnight normalization
 * @access Private
 */
router.post("/tracked-time-normalized", authenticateToken, async (req, res) => {
  try {
    const {
      user_id,
      date,
      todays_time_tracked_seconds,
      current_session_time_seconds,
    } = req.body || {};
    if (!req.userId || !date) {
      return res
        .status(400)
        .json({ success: false, message: "Authentication and date are required" });
    }

    if (!isCurrentUserIdentifier(req, user_id)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: user_id does not match authenticated user",
      });
    }
    // Use the authenticated user
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    const d = toLocalMidnight(date);
    const update = {
      todaysTimeTrackedSeconds: Math.max(
        0,
        Number(todays_time_tracked_seconds || 0)
      ),
      currentSessionTimeSeconds: Math.max(
        0,
        Number(current_session_time_seconds || 0)
      ),
    };
    const doc = await TrackedTime.findOneAndUpdate(
      { userId: user._id, date: d },
      { $set: update },
      { new: true, upsert: true }
    );
    return res.json({ success: true, data: doc });
  } catch (err) {
    logger.error("Error upserting tracked time (normalized)", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/**
 * @route GET /api/posture/tracked-time-normalized
 * @desc  Fetch tracked time using robust date normalization
 * @access Private
 */
router.get("/tracked-time-normalized", authenticateToken, async (req, res) => {
  try {
    const userId = req.query.user_id || req.userId;
    const date = req.query.date;
    if (!req.userId || !date) {
      return res
        .status(400)
        .json({ success: false, message: "Authentication and date are required" });
    }

    if (!isCurrentUserIdentifier(req, userId)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: user_id does not match authenticated user",
      });
    }

    const d = toLocalMidnight(date);
    const doc = await TrackedTime.findOne({ userId: req.userId, date: d });
    return res.json({ success: true, data: doc });
  } catch (err) {
    logger.error("Error fetching tracked time (normalized)", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});
