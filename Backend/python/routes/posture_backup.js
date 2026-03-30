/**
 * Posture API Routes
 * Handles posture tracking, session management, and Flask backend integration
 */

const express = require("express");
const { body, validationResult } = require("express-validator");
const { PostureSession, DailySummary, User } = require("../models");
const PostureService = require("../services/postureService");
const logger = require("../utils/logger");

const router = express.Router();

/**
 * @route   POST /api/posture/track
 * @desc    Receive posture data from Flask backend
 * @access  Public (Flask backend integration)
 */
router.post(
  "/track",
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

      logger.info(
        `Received posture data from Flask for user ${user_id}: ${time_tracked} minutes`
      );

      // Find or create user (for Flask integration)
      let user = await User.findOne({ username: user_id });
      if (!user) {
        // Create a basic user record for Flask integration
        user = new User({
          username: user_id,
          email: `${user_id}@posture-tracking.local`,
          password: "flask-integration-user", // This will be hashed
          firstName: user_id,
        });
        await user.save();
        logger.info(`Created new user for Flask integration: ${user_id}`);
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

      // Update session with posture data
      session.duration = time_tracked;
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
          totalTimeTracked: time_tracked,
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
        dailySummary.totalTimeTracked = Math.max(
          dailySummary.totalTimeTracked,
          time_tracked
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

      await dailySummary.save();

      logger.info(
        `Processed Flask posture data - User: ${user_id}, Score: ${overall_score}, Time: ${time_tracked}min`
      );

      res.json({
        success: true,
        message: "Posture data received and processed successfully",
        data: {
          session_id: session._id,
          overall_score: overall_score,
          time_tracked: time_tracked,
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
 * @route   GET /api/posture/hourly-activity
 * @desc    Get hourly activity heatmap data for the user
 * @access  Private
 */
router.get("/hourly-activity", async (req, res, next) => {
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

    res.json({ success: true, data: heatmap });
  } catch (error) {
    logger.error("Error fetching hourly activity heatmap:", error);
    next(error);
  }
});
/**
 * Posture Routes
 *
 * Handles real-time posture data streaming, auto-framing controls, and session storage.
 */

/**
 * @route   POST /api/posture/save-session
 * @desc    Save posture session data from Python service
 * @access  Private
 */
router.post(
  "/save-session",
  [
    body("sessionId").notEmpty().withMessage("Session ID is required"),
    body("duration").isNumeric().withMessage("Duration must be a number"),
    body("averageScores")
      .isObject()
      .withMessage("Average scores must be an object"),
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
      const {
        sessionId,
        duration,
        durationMinutes,
        averageScores,
        totalFeedbackCount,
        blinkRate,
        scoresHistory,
        feedbackHistory,
      } = req.body;

      const now = new Date();
      const startTime = new Date(now.getTime() - duration * 1000); // Calculate start time

      // Create new posture session
      const postureSession = new PostureSession({
        userId,
        startTime,
        endTime: now,
        duration: Math.round(duration), // in seconds
        status: "completed",
        postureMetrics: {
          totalCorrections: totalFeedbackCount || 0,
        },
        scores: {
          headTiltScore: averageScores.headTilt || 0,
          shoulderAlignmentScore: averageScores.shoulderAlignment || 0,
          spinalPostureScore: averageScores.spinalPosture || 0,
          overallScore: averageScores.overallScore || 0,
        },
        eyeHealth: {
          blinkCount: blinkRate || 0,
          averageBlinkRate: blinkRate ? blinkRate / (durationMinutes || 1) : 0,
        },
        autoFramingStats: {
          enabled: true,
          adjustmentCount: 0,
        },
      });

      const savedSession = await postureSession.save();

      // Update or create daily summary
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let dailySummary = await DailySummary.findOne({
        userId,
        date: today,
      });

      // Check if we need to update cumulative time
      const updateCumulativeTime = req.body.updateCumulativeTime || false;
      const sessionTimeSeconds = req.body.sessionTimeSeconds || duration;

      if (!dailySummary) {
        // Get the most recent daily summary to preserve cumulative time
        let previousCumulativeTime = 0;
        const lastSummary = await DailySummary.findOne({ userId })
          .sort({ date: -1 })
          .limit(1);

        if (lastSummary) {
          previousCumulativeTime = lastSummary.cumulativeDuration || 0;
        }

        // Create new daily summary with preserved cumulative time
        dailySummary = new DailySummary({
          userId,
          date: today,
          totalSessions: 0,
          totalDuration: 0,
          // Preserve cumulative time and add new session time if needed
          cumulativeDuration:
            previousCumulativeTime +
            (updateCumulativeTime ? sessionTimeSeconds : 0),
          averageScore: 0,
          bestScore: 0,
          totalCorrections: 0,
          postureBreakdown: {
            headTilt: 0,
            shoulderAlignment: 0,
            spinalPosture: 0,
            hipBalance: 0,
            legPosition: 0,
          },
          eyeHealthMetrics: {
            totalBlinks: 0,
            averageBlinkRate: 0,
          },
        });
      }

      // Update daily summary
      dailySummary.totalSessions += 1;
      dailySummary.totalDuration += durationMinutes || duration / 60;
      dailySummary.totalCorrections += totalFeedbackCount || 0;

      // Update cumulative time tracking if requested
      if (updateCumulativeTime) {
        // Increment the cumulative duration with session time
        dailySummary.cumulativeDuration =
          (dailySummary.cumulativeDuration || 0) + sessionTimeSeconds;
      }

      // Update best score
      if (averageScores.overallScore > dailySummary.bestScore) {
        dailySummary.bestScore = averageScores.overallScore;
      }

      // Recalculate average score for the day
      const todaySessions = await PostureSession.find({
        userId,
        startTime: { $gte: today },
      });

      if (todaySessions.length > 0) {
        const totalScore = todaySessions.reduce(
          (sum, session) => sum + (session.scores?.overallScore || 0),
          0
        );
        dailySummary.averageScore = Math.round(
          totalScore / todaySessions.length
        );

        // Update posture breakdown averages
        const avgHeadTilt =
          todaySessions.reduce(
            (sum, session) => sum + (session.scores?.headTiltScore || 0),
            0
          ) / todaySessions.length;
        const avgShoulder =
          todaySessions.reduce(
            (sum, session) =>
              sum + (session.scores?.shoulderAlignmentScore || 0),
            0
          ) / todaySessions.length;
        const avgSpinal =
          todaySessions.reduce(
            (sum, session) => sum + (session.scores?.spinalPostureScore || 0),
            0
          ) / todaySessions.length;

        dailySummary.postureBreakdown.headTilt = Math.round(avgHeadTilt);
        dailySummary.postureBreakdown.shoulderAlignment =
          Math.round(avgShoulder);
        dailySummary.postureBreakdown.spinalPosture = Math.round(avgSpinal);
      }

      // Update eye health metrics
      dailySummary.eyeHealthMetrics.totalBlinks += blinkRate || 0;
      if (dailySummary.totalSessions > 0) {
        dailySummary.eyeHealthMetrics.averageBlinkRate =
          dailySummary.eyeHealthMetrics.totalBlinks /
          dailySummary.totalSessions;
      }

      await dailySummary.save();

      logger.info(`Posture session saved for user ${userId}: ${sessionId}`);

      res.json({
        success: true,
        message: "Session saved successfully",
        data: {
          sessionId: savedSession._id,
          summary: {
            duration: savedSession.duration,
            overallScore: savedSession.scores?.overallScore || 0,
            totalCorrections:
              savedSession.postureMetrics?.totalCorrections || 0,
          },
        },
      });
    } catch (error) {
      logger.error("Error saving posture session:", error);
      next(error);
    }
  }
);

/**
 * @route   GET /api/posture/today-stats
 * @desc    Get today's posture statistics
 * @access  Private
 */
router.get("/today-stats", async (req, res, next) => {
  try {
    const userId = req.userId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get today's sessions
    const todaySessions = await PostureSession.find({
      userId,
      startTime: { $gte: today },
    }).sort({ startTime: -1 });

    // Get daily summary
    const dailySummary = await DailySummary.findOne({
      userId,
      date: today,
    });

    // Calculate current statistics
    const stats = {
      sessionsToday: todaySessions.length,
      timeTrackedToday: dailySummary ? dailySummary.totalDuration : 0,
      currentScore:
        todaySessions.length > 0
          ? todaySessions[0].scores?.overallScore || 0
          : 0,
      averageScore: dailySummary ? dailySummary.averageScore : 0,
      totalCorrections: dailySummary ? dailySummary.totalCorrections : 0,
      bestScore: dailySummary ? dailySummary.bestScore : 0,
      lastSessionTime:
        todaySessions.length > 0 ? todaySessions[0].startTime : null,
    };

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error("Error fetching today's stats:", error);
    next(error);
  }
});

/**
 * @route   GET /api/posture/today-overview
 * @desc    Get today's posture overview with real-time session tracking
 * @access  Private
 */
router.get("/today-overview", async (req, res, next) => {
  try {
    const userId = req.userId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const now = new Date();

    // Get today's sessions
    const todaySessions = await PostureSession.find({
      userId,
      startTime: { $gte: today },
    }).sort({ startTime: -1 });

    // Get active session if any
    const activeSession = await PostureSession.findOne({
      userId,
      status: "active",
      startTime: { $gte: today },
    });

    // Get daily summary
    let dailySummary = await DailySummary.findOne({
      userId,
      date: today,
    });

    // Get the most recent daily summary for cumulative time tracking
    let previousCumulativeTime = 0;
    if (!dailySummary) {
      // If there's no summary for today, find the most recent one to get cumulative time
      const lastSummary = await DailySummary.findOne({ userId })
        .sort({ date: -1 })
        .limit(1);

      previousCumulativeTime = lastSummary
        ? lastSummary.cumulativeDuration || 0
        : 0;

      // Create daily summary with preserved cumulative time
      dailySummary = new DailySummary({
        userId,
        date: today,
        totalTimeTracked: 0,
        cumulativeDuration: previousCumulativeTime, // Preserve the cumulative time
        sessionsCount: 0,
        averageScores: {
          headTilt: 100,
          shoulderAlignment: 100,
          spinalPosture: 100,
          overall: 100,
        },
        totalCorrections: {
          headTiltCorrections: 0,
          shoulderCorrections: 0,
          backCorrections: 0,
          total: 0,
        },
        eyeHealthMetrics: {
          totalBlinks: 0,
          averageBlinkRate: 0,
          lowBlinkPeriods: 0,
        },
      });
      await dailySummary.save();
    }

    // Calculate today's total time (including active session)
    let totalTimeToday = dailySummary.totalTimeTracked;
    let currentSessionTime = 0;

    if (activeSession) {
      currentSessionTime = Math.floor((now - activeSession.startTime) / 1000); // in seconds
      totalTimeToday += currentSessionTime / 60; // add current session time in minutes
    }

    // Format time in hr:min:sec
    const formatTime = (seconds) => {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = seconds % 60;
      return `${hours}:${minutes.toString().padStart(2, "0")}:${secs
        .toString()
        .padStart(2, "0")}`;
    };

    // Get current score from latest session or default
    let currentScore = 100;
    if (todaySessions.length > 0) {
      currentScore = todaySessions[0].scores?.overallScore || 100;
    }

    // Get all daily summaries for cumulative time
    const allDailySummaries = await DailySummary.find({ userId });

    // Calculate cumulative duration across all days
    const cumulativeSeconds = allDailySummaries.reduce((total, summary) => {
      return total + (summary.cumulativeDuration || 0);
    }, 0);

    const overview = {
      // Current session time in hr:min:sec format
      timeTracked: formatTime(Math.floor(totalTimeToday * 60)), // convert minutes to seconds for formatting

      // Cumulative time across all sessions
      cumulativeTime: cumulativeSeconds,
      cumulativeTimeFormatted: formatTime(cumulativeSeconds),

      // Dynamic score from latest session
      postureScore: Math.round(currentScore),

      // Total corrections for today
      corrections: dailySummary.totalCorrections.total,

      // Session info
      sessionsToday: dailySummary.sessionsCount,
      isActiveSession: !!activeSession,
      currentSessionTime: formatTime(currentSessionTime),

      // Additional stats
      averageScore: Math.round(dailySummary.averageScores.overall),
      bestScore: Math.round(
        dailySummary.qualityMetrics?.bestSessionScore || currentScore
      ),

      // Reset indicator (for frontend to know if this is a new day)
      lastReset: today.toISOString(),
    };

    res.json({
      success: true,
      data: overview,
    });
  } catch (error) {
    logger.error("Error fetching today's overview:", error);
    next(error);
  }
});

/**
 * @route   POST /api/posture/update-realtime
 * @desc    Update real-time posture data (called by Python service)
 * @access  Private
 */
router.post("/update-realtime", async (req, res, next) => {
  try {
    const userId = req.userId;
    const { scores, corrections, sessionTime } = req.body;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Update or create daily summary
    let dailySummary = await DailySummary.findOne({
      userId,
      date: today,
    });

    if (dailySummary) {
      // Update corrections count
      if (corrections !== undefined) {
        dailySummary.totalCorrections.total = corrections;
      }

      // Update current scores
      if (scores) {
        dailySummary.averageScores = {
          headTilt: scores.headTilt || dailySummary.averageScores.headTilt,
          shoulderAlignment:
            scores.shoulderAlignment ||
            dailySummary.averageScores.shoulderAlignment,
          spinalPosture:
            scores.spinalPosture || dailySummary.averageScores.spinalPosture,
          overall: scores.overallScore || dailySummary.averageScores.overall,
        };

        // Update best score if current is better
        if (
          scores.overallScore > dailySummary.qualityMetrics.bestSessionScore
        ) {
          dailySummary.qualityMetrics.bestSessionScore = scores.overallScore;
        }
      }

      await dailySummary.save();
    }

    res.json({
      success: true,
      message: "Real-time data updated successfully",
    });
  } catch (error) {
    logger.error("Error updating real-time data:", error);
    next(error);
  }
});

/**
 * @route   GET /api/posture/stream
 * @desc    Get video stream endpoint (handled by Python service)
 * @access  Private
 */
router.get("/stream", (req, res) => {
  // This endpoint would typically stream video data
  // For now, we'll return streaming instructions
  res.json({
    success: true,
    message: "Video streaming is handled via Socket.IO and Python microservice",
    instructions: {
      step1: "Connect to Socket.IO with authentication token",
      step2: 'Emit "start_posture_monitoring" event',
      step3:
        'Listen for "posture_data", "posture_feedback", and "score_update" events',
    },
  });
});

/**
 * @route   POST /api/posture/toggle-auto-frame
 * @desc    Toggle auto-framing feature
 * @access  Private
 */
router.post("/toggle-auto-frame", async (req, res, next) => {
  try {
    const userId = req.userId;
    const { User } = require("../models");

    // Get current user preferences
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Toggle auto-framing
    user.preferences.autoFraming.enabled =
      !user.preferences.autoFraming.enabled;
    await user.save();

    // Update active session if exists
    const activeSession = PostureService.getActiveSession(userId);
    if (activeSession) {
      await PostureService.updateSessionPreferences(userId, user.preferences);
    }

    logger.info(
      `Auto-framing toggled for user ${userId}: ${user.preferences.autoFraming.enabled}`
    );

    res.json({
      success: true,
      message: `Auto-framing ${
        user.preferences.autoFraming.enabled ? "enabled" : "disabled"
      }`,
      data: {
        autoFrameEnabled: user.preferences.autoFraming.enabled,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/posture/auto-frame-settings
 * @desc    Update auto-framing settings
 * @access  Private
 */
router.post(
  "/auto-frame-settings",
  [
    body("margin")
      .optional()
      .isInt({ min: 10, max: 200 })
      .withMessage("Margin must be between 10 and 200"),
    body("smoothing")
      .optional()
      .isFloat({ min: 0.1, max: 1.0 })
      .withMessage("Smoothing must be between 0.1 and 1.0"),
  ],
  async (req, res, next) => {
    try {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const userId = req.userId;
      const { margin, smoothing } = req.body;
      const { User } = require("../models");

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Update auto-framing settings
      if (margin !== undefined) {
        user.preferences.autoFraming.margin = margin;
      }
      if (smoothing !== undefined) {
        user.preferences.autoFraming.smoothing = smoothing;
      }

      await user.save();

      // Update active session if exists
      const activeSession = PostureService.getActiveSession(userId);
      if (activeSession) {
        await PostureService.updateSessionPreferences(userId, user.preferences);
      }

      logger.info(`Auto-framing settings updated for user ${userId}`);

      res.json({
        success: true,
        message: "Auto-framing settings updated successfully",
        data: {
          autoFraming: user.preferences.autoFraming,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   GET /api/posture/settings
 * @desc    Get current posture detection settings
 * @access  Private
 */
router.get("/settings", async (req, res, next) => {
  try {
    const userId = req.userId;
    const { User } = require("../models");

    const user = await User.findById(userId).select("preferences");
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      data: {
        autoFraming: user.preferences.autoFraming,
        thresholds: user.preferences.thresholds,
        notifications: user.preferences.notifications,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/posture/calibrate
 * @desc    Calibrate posture detection thresholds
 * @access  Private
 */
router.post(
  "/calibrate",
  [
    body("neckDeviation")
      .optional()
      .isFloat({ min: 0.01, max: 0.2 })
      .withMessage("Neck deviation threshold must be between 0.01 and 0.2"),
    body("shoulderTilt")
      .optional()
      .isFloat({ min: 0.01, max: 0.15 })
      .withMessage("Shoulder tilt threshold must be between 0.01 and 0.15"),
    body("backBending")
      .optional()
      .isFloat({ min: 0.01, max: 0.25 })
      .withMessage("Back bending threshold must be between 0.01 and 0.25"),
  ],
  async (req, res, next) => {
    try {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const userId = req.userId;
      const { neckDeviation, shoulderTilt, backBending } = req.body;
      const { User } = require("../models");

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Update thresholds
      if (neckDeviation !== undefined) {
        user.preferences.thresholds.neckDeviation = neckDeviation;
      }
      if (shoulderTilt !== undefined) {
        user.preferences.thresholds.shoulderTilt = shoulderTilt;
      }
      if (backBending !== undefined) {
        user.preferences.thresholds.backBending = backBending;
      }

      await user.save();

      // Update active session if exists
      const activeSession = PostureService.getActiveSession(userId);
      if (activeSession) {
        await PostureService.updateSessionPreferences(userId, user.preferences);
      }

      logger.info(`Posture thresholds calibrated for user ${userId}`);

      res.json({
        success: true,
        message: "Posture detection calibrated successfully",
        data: {
          thresholds: user.preferences.thresholds,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   GET /api/posture/status
 * @desc    Get current posture monitoring status
 * @access  Private
 */
router.get("/status", async (req, res, next) => {
  try {
    const userId = req.userId;
    const activeSession = PostureService.getActiveSession(userId);

    if (!activeSession) {
      return res.json({
        success: true,
        data: {
          isMonitoring: false,
          session: null,
        },
      });
    }

    res.json({
      success: true,
      data: {
        isMonitoring: true,
        session: {
          sessionId: activeSession.sessionId,
          startTime: activeSession.startTime,
          currentScores: activeSession.scores,
          metrics: activeSession.metrics,
          eyeHealth: activeSession.eyeHealth,
          lastUpdate: activeSession.lastUpdate,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/posture/feedback
 * @desc    Submit manual feedback or correction
 * @access  Private
 */
router.post(
  "/feedback",
  [
    body("message")
      .notEmpty()
      .isLength({ max: 500 })
      .withMessage(
        "Feedback message is required and cannot exceed 500 characters"
      ),
    body("category")
      .isIn(["posture", "comfort", "technical", "suggestion"])
      .withMessage(
        "Category must be posture, comfort, technical, or suggestion"
      ),
  ],
  async (req, res, next) => {
    try {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const userId = req.userId;
      const { message, category } = req.body;
      const { PostureSession } = require("../models");

      const activeSession = PostureService.getActiveSession(userId);
      if (!activeSession) {
        return res.status(400).json({
          success: false,
          message: "No active monitoring session found",
        });
      }

      // Add feedback to session
      const session = await PostureSession.findById(activeSession.sessionId);
      if (session) {
        session.feedbackMessages.push({
          timestamp: new Date(),
          message,
          category,
          severity: "info",
        });
        await session.save();
      }

      logger.info(`Manual feedback submitted by user ${userId}: ${category}`);

      res.json({
        success: true,
        message: "Feedback submitted successfully",
        data: {
          feedbackId:
            session.feedbackMessages[session.feedbackMessages.length - 1]._id,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   POST /api/posture/create-test-data
 * @desc    Create test session data for development (remove in production)
 * @access  Private
 */
router.post("/create-test-data", async (req, res, next) => {
  try {
    const userId = req.userId;
    const now = new Date();

    // Create multiple test sessions for today
    const testSessions = [];
    for (let i = 0; i < 3; i++) {
      const sessionStart = new Date(
        now.getTime() - (i + 1) * 2 * 60 * 60 * 1000
      ); // 2, 4, 6 hours ago
      const duration = (30 + i * 15) * 60; // 30, 45, 60 minutes in seconds

      const testSession = new PostureSession({
        userId,
        startTime: sessionStart,
        endTime: new Date(sessionStart.getTime() + duration * 1000),
        duration,
        status: "completed",
        postureMetrics: {
          totalCorrections: Math.floor(Math.random() * 20) + 5,
        },
        scores: {
          headTiltScore: Math.floor(Math.random() * 30) + 70,
          shoulderAlignmentScore: Math.floor(Math.random() * 30) + 65,
          spinalPostureScore: Math.floor(Math.random() * 30) + 60,
          overallScore: Math.floor(Math.random() * 25) + 70,
        },
        eyeHealth: {
          blinkCount: Math.floor(Math.random() * 100) + 50,
          averageBlinkRate: Math.random() * 2 + 1,
        },
      });

      testSessions.push(await testSession.save());
    }

    // Update daily summary
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const totalDuration =
      testSessions.reduce((sum, s) => sum + s.duration, 0) / 60; // in minutes
    const totalCorrections = testSessions.reduce(
      (sum, s) => sum + s.postureMetrics.totalCorrections,
      0
    );
    const averageScore = Math.round(
      testSessions.reduce((sum, s) => sum + s.scores.overallScore, 0) /
        testSessions.length
    );
    const bestScore = Math.max(
      ...testSessions.map((s) => s.scores.overallScore)
    );

    await DailySummary.findOneAndUpdate(
      { userId, date: today },
      {
        $inc: {
          totalSessions: testSessions.length,
          totalDuration: totalDuration,
          totalCorrections: totalCorrections,
        },
        $max: { bestScore: bestScore },
        $set: { averageScore: averageScore },
      },
      { upsert: true, new: true }
    );

    logger.info(
      `Created ${testSessions.length} test sessions for user ${userId}`
    );

    res.json({
      success: true,
      message: `Created ${testSessions.length} test sessions`,
      data: {
        sessions: testSessions.length,
        totalDuration: Math.round(totalDuration),
        averageScore,
      },
    });
  } catch (error) {
    logger.error("Error creating test data:", error);
    next(error);
  }
});

module.exports = router;
