/**
 * Session Routes
 *
 * Handles posture monitoring session management, including starting/stopping sessions
 * and retrieving session data for authenticated users.
 */

const express = require("express");
const { body, query, validationResult } = require("express-validator");
const { PostureSession, PosturePattern } = require("../models");
const PostureService = require("../services/postureService");
const logger = require("../utils/logger");

const router = express.Router();

/**
 * @route   POST /api/sessions/start
 * @desc    Start a new posture monitoring session
 * @access  Private
 */
router.post(
  "/start",
  [
    body("cameraResolution")
      .optional()
      .isString()
      .withMessage("Camera resolution must be a string"),
    body("userAgent")
      .optional()
      .isString()
      .withMessage("User agent must be a string"),
    body("platform")
      .optional()
      .isString()
      .withMessage("Platform must be a string"),
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
      const { cameraResolution, userAgent, platform } = req.body;

      // Check if user already has an active session
      const activeSession = PostureService.getActiveSession(userId);
      if (activeSession) {
        return res.status(400).json({
          success: false,
          message: "A monitoring session is already active",
          data: {
            sessionId: activeSession.sessionId,
            startTime: activeSession.startTime,
          },
        });
      }

      // Start monitoring session
      const session = await PostureService.startMonitoring(userId, {
        cameraResolution,
        userAgent,
        platform,
      });

      logger.info(`Session started for user ${userId}: ${session._id}`);

      res.status(201).json({
        success: true,
        message: "Monitoring session started successfully",
        data: {
          sessionId: session._id,
          startTime: session.startTime,
          status: session.status,
          preferences: req.user.preferences,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   POST /api/sessions/stop
 * @desc    Stop the active posture monitoring session
 * @access  Private
 */
router.post("/stop", async (req, res, next) => {
  try {
    const userId = req.userId;

    // Check if user has an active session
    const activeSession = PostureService.getActiveSession(userId);
    if (!activeSession) {
      return res.status(400).json({
        success: false,
        message: "No active monitoring session found",
      });
    }

    // Stop monitoring session
    await PostureService.stopMonitoring(userId);

    // Get the completed session from database
    const session = await PostureSession.findById(activeSession.sessionId);

    logger.info(
      `Session stopped for user ${userId}: ${activeSession.sessionId}`
    );

    res.json({
      success: true,
      message: "Monitoring session stopped successfully",
      data: {
        sessionId: session._id,
        startTime: session.startTime,
        endTime: session.endTime,
        duration: session.duration,
        finalScores: session.scores,
        totalCorrections: session.postureMetrics.totalCorrections,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/sessions/active
 * @desc    Get active session information
 * @access  Private
 */
router.get("/active", async (req, res, next) => {
  try {
    const userId = req.userId;
    const activeSession = PostureService.getActiveSession(userId);

    if (!activeSession) {
      return res.json({
        success: true,
        message: "No active session",
        data: null,
      });
    }

    // Get current session from database for latest data
    const session = await PostureSession.findById(activeSession.sessionId);

    res.json({
      success: true,
      data: {
        sessionId: session._id,
        startTime: session.startTime,
        status: session.status,
        currentScores: activeSession.scores,
        metrics: activeSession.metrics,
        eyeHealth: activeSession.eyeHealth,
        duration: Math.floor((new Date() - session.startTime) / (1000 * 60)), // minutes
        lastUpdate: activeSession.lastUpdate,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/sessions
 * @desc    Get user's session history with pagination
 * @access  Private
 */
router.get(
  "/",
  [
    query("page")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Page must be a positive integer"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage("Limit must be between 1 and 100"),
    query("status")
      .optional()
      .isIn(["active", "paused", "completed"])
      .withMessage("Status must be active, paused, or completed"),
    query("startDate")
      .optional()
      .isISO8601()
      .withMessage("Start date must be a valid ISO 8601 date"),
    query("endDate")
      .optional()
      .isISO8601()
      .withMessage("End date must be a valid ISO 8601 date"),
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
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      // Build query filters
      const filters = { userId };

      if (req.query.status) {
        filters.status = req.query.status;
      }

      if (req.query.startDate || req.query.endDate) {
        filters.startTime = {};
        if (req.query.startDate) {
          filters.startTime.$gte = new Date(req.query.startDate);
        }
        if (req.query.endDate) {
          filters.startTime.$lte = new Date(req.query.endDate);
        }
      }

      // Get sessions with pagination
      const [sessions, totalCount] = await Promise.all([
        PostureSession.find(filters)
          .sort({ startTime: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        PostureSession.countDocuments(filters),
      ]);

      const totalPages = Math.ceil(totalCount / limit);

      res.json({
        success: true,
        data: {
          sessions,
          pagination: {
            currentPage: page,
            totalPages,
            totalCount,
            hasNextPage: page < totalPages,
            hasPreviousPage: page > 1,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   GET /api/sessions/:sessionId
 * @desc    Get detailed session information
 * @access  Private
 */
router.get("/:sessionId", async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const userId = req.userId;

    const session = await PostureSession.findOne({
      _id: sessionId,
      userId,
    }).lean();

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Session not found",
      });
    }

    res.json({
      success: true,
      data: { session },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/sessions/:sessionId/patterns
 * @desc    Get posture patterns for a specific session
 * @access  Private
 */
router.get(
  "/:sessionId/patterns",
  [
    query("page")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Page must be a positive integer"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 1000 })
      .withMessage("Limit must be between 1 and 1000"),
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

      const { sessionId } = req.params;
      const userId = req.userId;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 100;
      const skip = (page - 1) * limit;

      // Verify session belongs to user
      const session = await PostureSession.findOne({
        _id: sessionId,
        userId,
      });

      if (!session) {
        return res.status(404).json({
          success: false,
          message: "Session not found",
        });
      }

      // Get posture patterns for the session
      const [patterns, totalCount] = await Promise.all([
        PosturePattern.find({ sessionId, userId })
          .sort({ timestamp: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        PosturePattern.countDocuments({ sessionId, userId }),
      ]);

      const totalPages = Math.ceil(totalCount / limit);

      res.json({
        success: true,
        data: {
          patterns,
          pagination: {
            currentPage: page,
            totalPages,
            totalCount,
            hasNextPage: page < totalPages,
            hasPreviousPage: page > 1,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   PATCH /api/sessions/:sessionId
 * @desc    Update session (pause/resume)
 * @access  Private
 */
router.patch(
  "/:sessionId",
  [
    body("status")
      .isIn(["active", "paused"])
      .withMessage("Status must be active or paused"),
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

      const { sessionId } = req.params;
      const { status } = req.body;
      const userId = req.userId;

      const session = await PostureSession.findOne({
        _id: sessionId,
        userId,
        status: { $ne: "completed" },
      });

      if (!session) {
        return res.status(404).json({
          success: false,
          message: "Active session not found",
        });
      }

      session.status = status;
      await session.save();

      // Update active session data
      const activeSession = PostureService.getActiveSession(userId);
      if (activeSession && activeSession.sessionId.toString() === sessionId) {
        // Handle pause/resume logic if needed
        logger.info(
          `Session ${sessionId} status changed to ${status} for user ${userId}`
        );
      }

      res.json({
        success: true,
        message: `Session ${
          status === "paused" ? "paused" : "resumed"
        } successfully`,
        data: {
          sessionId: session._id,
          status: session.status,
          updatedAt: session.updatedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
