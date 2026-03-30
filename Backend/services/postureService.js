/**
 * Posture Service
 *
 * Core service that handles posture detection by interfacing with Python scripts.
 * This service maintains the exact functionality from your Flask backend while
 * providing a Node.js interface.
 */

const { spawn } = require("child_process");
const path = require("path");
const EventEmitter = require("events");
const { PostureSession, PosturePattern, User } = require("../models");
const logger = require("../utils/logger");

class PostureService extends EventEmitter {
  constructor() {
    super();
    this.activeSessions = new Map(); // userId -> session data
    this.pythonProcesses = new Map(); // userId -> python process
    this.io = null; // Socket.IO instance
  }

  /**
   * Initialize the service with Socket.IO instance
   */
  initialize(io) {
    this.io = io;
    logger.info("Posture Service initialized with Socket.IO");
  }

  /**
   * Start posture monitoring for a user
   */
  async startMonitoring(userId, options = {}) {
    try {
      // Stop any existing session for this user
      await this.stopMonitoring(userId);

      const user = await User.findById(userId);
      if (!user) {
        throw new Error("User not found");
      }

      // Create new posture session
      const session = new PostureSession({
        userId,
        startTime: new Date(),
        status: "active",
        deviceInfo: {
          cameraResolution: options.cameraResolution || "640x480",
          userAgent: options.userAgent || "",
          platform: options.platform || "",
        },
      });

      await session.save();

      // Store session data
      const sessionData = {
        sessionId: session._id,
        userId,
        startTime: session.startTime,
        preferences: user.preferences,
        scores: { ...session.scores },
        metrics: { ...session.postureMetrics },
        eyeHealth: { ...session.eyeHealth },
        lastUpdate: new Date(),
      };

      this.activeSessions.set(userId.toString(), sessionData);

      // Start Python posture detection process
      await this.startPythonProcess(userId, sessionData);

      logger.info(`Started posture monitoring for user ${userId}`);

      // Emit to user's room
      if (this.io) {
        this.io.to(`user_${userId}`).emit("monitoring_started", {
          sessionId: session._id,
          startTime: session.startTime,
        });
      }

      return session;
    } catch (error) {
      logger.error(
        `Error starting posture monitoring for user ${userId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Stop posture monitoring for a user
   */
  async stopMonitoring(userId) {
    try {
      const userIdStr = userId.toString();
      const sessionData = this.activeSessions.get(userIdStr);

      if (!sessionData) {
        return; // No active session
      }

      // Stop Python process
      const pythonProcess = this.pythonProcesses.get(userIdStr);
      if (pythonProcess && !pythonProcess.killed) {
        pythonProcess.kill("SIGTERM");
        this.pythonProcesses.delete(userIdStr);
      }

      // Update session in database
      const session = await PostureSession.findById(sessionData.sessionId);
      if (session) {
        session.endTime = new Date();
        session.status = "completed";
        session.postureMetrics = sessionData.metrics;
        session.scores = sessionData.scores;
        session.eyeHealth = sessionData.eyeHealth;
        session.autoFramingStats = sessionData.autoFramingStats || {};

        await session.save();

        // Update daily summary
        await this.updateDailySummary(userId, session);
      }

      // Clean up
      this.activeSessions.delete(userIdStr);

      logger.info(`Stopped posture monitoring for user ${userId}`);

      // Emit to user's room
      if (this.io) {
        this.io.to(`user_${userId}`).emit("monitoring_stopped", {
          sessionId: sessionData.sessionId,
          endTime: new Date(),
          finalScores: sessionData.scores,
        });
      }
    } catch (error) {
      logger.error(
        `Error stopping posture monitoring for user ${userId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Start Python process for posture detection
   */
  async startPythonProcess(userId, sessionData) {
    try {
      const userIdStr = userId.toString();

      // Path to your Python posture detection script
      const pythonScriptPath = path.join(
        __dirname,
        "..",
        "backend.py"
      );

      // Python process arguments
      const args = [
        pythonScriptPath,
        "--user-id",
        userIdStr,
        "--session-id",
        sessionData.sessionId.toString(),
        "--auto-frame-enabled",
        sessionData.preferences.autoFraming.enabled.toString(),
        "--auto-frame-margin",
        sessionData.preferences.autoFraming.margin.toString(),
        "--auto-frame-smoothing",
        sessionData.preferences.autoFraming.smoothing.toString(),
        "--neck-threshold",
        sessionData.preferences.thresholds.neckDeviation.toString(),
        "--shoulder-threshold",
        sessionData.preferences.thresholds.shoulderTilt.toString(),
        "--back-threshold",
        sessionData.preferences.thresholds.backBending.toString(),
      ];

      // Spawn Python process
      const pythonProcess = spawn(
        process.env.PYTHON_EXECUTABLE || "python",
        args,
        {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env },
        }
      );

      this.pythonProcesses.set(userIdStr, pythonProcess);

      // Handle Python process output
      pythonProcess.stdout.on("data", (data) => {
        try {
          const lines = data
            .toString()
            .split("\n")
            .filter((line) => line.trim());

          for (const line of lines) {
            if (line.startsWith("POSTURE_DATA:")) {
              const postureData = JSON.parse(line.substring(13));
              this.handlePostureData(userId, postureData);
            } else if (line.startsWith("FEEDBACK:")) {
              const feedback = JSON.parse(line.substring(9));
              this.handleFeedback(userId, feedback);
            } else if (line.startsWith("SCORES:")) {
              const scores = JSON.parse(line.substring(7));
              this.handleScoreUpdate(userId, scores);
            }
          }
        } catch (error) {
          logger.error(
            `Error parsing Python output for user ${userId}:`,
            error
          );
        }
      });

      pythonProcess.stderr.on("data", (data) => {
        logger.error(`Python process error for user ${userId}: ${data}`);
      });

      pythonProcess.on("close", (code) => {
        logger.info(
          `Python process for user ${userId} exited with code ${code}`
        );
        this.pythonProcesses.delete(userIdStr);
      });

      pythonProcess.on("error", (error) => {
        logger.error(
          `Failed to start Python process for user ${userId}:`,
          error
        );
        this.pythonProcesses.delete(userIdStr);
      });
    } catch (error) {
      logger.error(`Error starting Python process for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Handle posture data from Python process
   */
  async handlePostureData(userId, postureData) {
    try {
      const userIdStr = userId.toString();
      const sessionData = this.activeSessions.get(userIdStr);

      if (!sessionData) return;

      // Create posture pattern record
      const pattern = new PosturePattern({
        userId,
        sessionId: sessionData.sessionId,
        timestamp: new Date(),
        postureData: postureData.posture,
        scores: postureData.scores,
        issues: postureData.issues || [],
      });

      await pattern.save();

      // Update session metrics
      if (postureData.metrics) {
        sessionData.metrics.headTiltCount +=
          postureData.metrics.headTiltIncrement || 0;
        sessionData.metrics.shoulderBendingCount +=
          postureData.metrics.shoulderBendingIncrement || 0;
        sessionData.metrics.backBendingCount +=
          postureData.metrics.backBendingIncrement || 0;
        sessionData.metrics.totalCorrections =
          sessionData.metrics.headTiltCount +
          sessionData.metrics.shoulderBendingCount +
          sessionData.metrics.backBendingCount;
      }

      // Update eye health metrics
      if (postureData.eyeHealth) {
        sessionData.eyeHealth.blinkCount +=
          postureData.eyeHealth.blinkIncrement || 0;
        sessionData.eyeHealth.averageBlinkRate =
          postureData.eyeHealth.currentBlinkRate ||
          sessionData.eyeHealth.averageBlinkRate;
        sessionData.eyeHealth.lowBlinkWarnings += postureData.eyeHealth
          .lowBlinkWarning
          ? 1
          : 0;
      }

      sessionData.lastUpdate = new Date();

      // Emit real-time data to user
      if (this.io) {
        this.io.to(`user_${userId}`).emit("posture_data", {
          timestamp: pattern.timestamp,
          scores: postureData.scores,
          metrics: sessionData.metrics,
          eyeHealth: sessionData.eyeHealth,
          issues: postureData.issues,
        });
      }
    } catch (error) {
      logger.error(`Error handling posture data for user ${userId}:`, error);
    }
  }

  /**
   * Handle feedback messages from Python process
   */
  async handleFeedback(userId, feedback) {
    try {
      const userIdStr = userId.toString();
      const sessionData = this.activeSessions.get(userIdStr);

      if (!sessionData) return;

      // Update session with feedback
      const session = await PostureSession.findById(sessionData.sessionId);
      if (session) {
        session.feedbackMessages.push({
          timestamp: new Date(),
          message: feedback.message,
          category: feedback.category,
          severity: feedback.severity,
        });
        await session.save();
      }

      // Emit feedback to user
      if (this.io) {
        this.io.to(`user_${userId}`).emit("posture_feedback", feedback);
      }
    } catch (error) {
      logger.error(`Error handling feedback for user ${userId}:`, error);
    }
  }

  /**
   * Handle score updates from Python process
   */
  async handleScoreUpdate(userId, scores) {
    try {
      const userIdStr = userId.toString();
      const sessionData = this.activeSessions.get(userIdStr);

      if (!sessionData) return;

      // Update session scores
      sessionData.scores = { ...sessionData.scores, ...scores };

      // Emit score update to user
      if (this.io) {
        this.io.to(`user_${userId}`).emit("score_update", scores);
      }
    } catch (error) {
      logger.error(`Error handling score update for user ${userId}:`, error);
    }
  }

  /**
   * Update daily summary after session ends
   */
  async updateDailySummary(userId, session) {
    try {
      const { DailySummary } = require("../models");
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let summary = await DailySummary.findOne({ userId, date: today });

      if (!summary) {
        summary = new DailySummary({
          userId,
          date: today,
          totalTimeTracked: 0,
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
          qualityMetrics: {
            bestSessionScore: 0,
            worstSessionScore: 100,
            consistencyScore: 0,
            improvementTrend: "insufficient_data",
          },
        });
      }

      // Update summary data
      summary.totalTimeTracked += session.duration;
      const previousSessionCount = Math.max(
        0,
        Number(summary.sessionsCount) || 0
      );
      const sessionCount = previousSessionCount + 1;
      summary.sessionsCount = sessionCount;

      const safeNumber = (value, fallback = 0) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
      };

      const runningAverage = (previousAverage, latestValue) => {
        const current = safeNumber(latestValue);
        if (previousSessionCount === 0) {
          return current;
        }

        return (
          (safeNumber(previousAverage) * previousSessionCount + current) /
          sessionCount
        );
      };

      // Update average scores using prior-count baseline to avoid default-score inflation.
      summary.averageScores.headTilt = runningAverage(
        summary.averageScores.headTilt,
        session.scores.headTiltScore
      );
      summary.averageScores.shoulderAlignment = runningAverage(
        summary.averageScores.shoulderAlignment,
        session.scores.shoulderAlignmentScore
      );
      summary.averageScores.spinalPosture = runningAverage(
        summary.averageScores.spinalPosture,
        session.scores.spinalPostureScore
      );
      summary.averageScores.overall = runningAverage(
        summary.averageScores.overall,
        session.scores.overallScore
      );

      // Update corrections
      summary.totalCorrections.headTiltCorrections +=
        session.postureMetrics.headTiltCount;
      summary.totalCorrections.shoulderCorrections +=
        session.postureMetrics.shoulderBendingCount;
      summary.totalCorrections.backCorrections +=
        session.postureMetrics.backBendingCount;
      summary.totalCorrections.total += session.postureMetrics.totalCorrections;

      // Update eye health
      summary.eyeHealthMetrics.totalBlinks += session.eyeHealth.blinkCount;
      summary.eyeHealthMetrics.lowBlinkPeriods +=
        session.eyeHealth.lowBlinkWarnings;
      summary.eyeHealthMetrics.averageBlinkRate = runningAverage(
        summary.eyeHealthMetrics.averageBlinkRate,
        session.eyeHealth.averageBlinkRate
      );

      // Update quality metrics
      summary.qualityMetrics.bestSessionScore = Math.max(
        summary.qualityMetrics.bestSessionScore,
        session.scores.overallScore
      );
      summary.qualityMetrics.worstSessionScore = Math.min(
        summary.qualityMetrics.worstSessionScore,
        session.scores.overallScore
      );

      // Compute cumulativeDuration before saving
      const priorSummaries = await DailySummary.find({
        userId,
        date: { $lt: today },
      }).select('totalTimeTracked').lean();
      const priorSeconds = priorSummaries.reduce(
        (sum, s) => sum + (s.totalTimeTracked || 0) * 60, 0
      );
      summary.cumulativeDuration = priorSeconds + (summary.totalTimeTracked || 0) * 60;

      await summary.save();
    } catch (error) {
      logger.error(`Error updating daily summary for user ${userId}:`, error);
    }
  }

  /**
   * Get active session for a user
   */
  getActiveSession(userId) {
    return this.activeSessions.get(userId.toString());
  }

  /**
   * Get all active sessions
   */
  getAllActiveSessions() {
    return Array.from(this.activeSessions.values());
  }

  /**
   * Update user preferences for active session
   */
  async updateSessionPreferences(userId, preferences) {
    try {
      const userIdStr = userId.toString();
      const sessionData = this.activeSessions.get(userIdStr);

      if (!sessionData) return false;

      // Update session preferences
      sessionData.preferences = { ...sessionData.preferences, ...preferences };

      // Send updated preferences to Python process
      const pythonProcess = this.pythonProcesses.get(userIdStr);
      if (pythonProcess && !pythonProcess.killed) {
        const command = {
          type: "update_preferences",
          preferences: sessionData.preferences,
        };
        pythonProcess.stdin.write(JSON.stringify(command) + "\n");
      }

      return true;
    } catch (error) {
      logger.error(
        `Error updating session preferences for user ${userId}:`,
        error
      );
      return false;
    }
  }
}

// Create singleton instance
const postureService = new PostureService();

module.exports = postureService;
