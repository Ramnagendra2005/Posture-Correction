const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/auth");
const { User, ExerciseRecommendation, PostureSession, DailySummary } = require("../models");
const { getRecommendations, determineSeverity } = require("../data/exercises");
const logger = require("../utils/logger");

/**
 * @route   GET /api/exercises/recommendations
 * @desc    Get exercise recommendations based on user's recent posture data
 * @access  Private
 */
router.get("/recommendations", authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);

    // Get latest session or daily summary to determine current flaws
    const latestSession = await PostureSession.findOne({ userId })
      .sort({ startTime: -1 })
      .lean();

    let detectedFlaws = [];
    let severity = "mild";

    if (latestSession) {
      // Extract flaws from sustained flaws
      if (latestSession.sustainedFlaws && latestSession.sustainedFlaws.length > 0) {
        detectedFlaws = [
          ...new Set(latestSession.sustainedFlaws.map((f) => f.flawType)),
        ];
      }

      // Also check low scores to infer flaw types
      const scores = latestSession.scores || {};
      if (scores.headTiltScore && scores.headTiltScore < 70) {
        detectedFlaws.push("head_tilt");
      }
      if (scores.shoulderAlignmentScore && scores.shoulderAlignmentScore < 70) {
        detectedFlaws.push("shoulder_misalignment");
      }
      if (scores.spinalPostureScore && scores.spinalPostureScore < 70) {
        detectedFlaws.push("forward_lean");
      }
      if (scores.proximityScore && scores.proximityScore < 70) {
        detectedFlaws.push("too_close");
      }

      detectedFlaws = [...new Set(detectedFlaws)];
      severity = determineSeverity(scores);
    }

    // Get recommendations with safe mode filtering
    const safeMode = user?.safeMode || false;
    const recommendations = getRecommendations(detectedFlaws, { safeMode });

    // Flatten for the API response
    const allExercises = [];
    for (const [flawType, exercises] of Object.entries(recommendations)) {
      for (const exercise of exercises) {
        allExercises.push({
          ...exercise,
          flawType,
          severity,
        });
      }
    }

    res.json({
      success: true,
      data: {
        detectedFlaws,
        severity,
        safeMode,
        exercises: allExercises,
        grouped: recommendations,
        sessionId: latestSession?._id,
      },
    });
  } catch (error) {
    logger.error("Error getting exercise recommendations:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get exercise recommendations",
    });
  }
});

/**
 * @route   POST /api/exercises/complete
 * @desc    Mark an exercise recommendation as completed
 * @access  Private
 */
router.post("/complete", authenticateToken, async (req, res) => {
  try {
    const { exerciseName, flawType } = req.body;
    const userId = req.user._id;

    // Store completion in ExerciseRecommendation collection
    const rec = new ExerciseRecommendation({
      userId,
      date: new Date(),
      flawType: flawType || "general",
      exercises: [{ name: exerciseName, durationMinutes: 0 }],
      severity: "mild",
      completed: true,
    });
    await rec.save();

    res.json({
      success: true,
      message: `Exercise "${exerciseName}" marked as complete!`,
    });
  } catch (error) {
    logger.error("Error completing exercise:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark exercise as complete",
    });
  }
});

/**
 * @route   GET /api/exercises/history
 * @desc    Get exercise completion history
 * @access  Private
 */
router.get("/history", authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id;
    const days = parseInt(req.query.days) || 7;

    const since = new Date();
    since.setDate(since.getDate() - days);

    const history = await ExerciseRecommendation.find({
      userId,
      date: { $gte: since },
      completed: true,
    })
      .sort({ date: -1 })
      .lean();

    res.json({
      success: true,
      data: {
        completedCount: history.length,
        exercises: history,
      },
    });
  } catch (error) {
    logger.error("Error getting exercise history:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get exercise history",
    });
  }
});

module.exports = router;
