/**
 * Database Models
 *
 * This file contains all Mongoose schemas for the posture monitoring application.
 * Each model represents a collection in MongoDB with proper validation and indexing.
 */

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// User Schema
const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, "Username is required"],
      unique: true,
      trim: true,
      minlength: [3, "Username must be at least 3 characters"],
      maxlength: [30, "Username cannot exceed 30 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        "Please enter a valid email",
      ],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"],
    },
    firstName: {
      type: String,
      required: [true, "First name is required"],
      trim: true,
      maxlength: [50, "First name cannot exceed 50 characters"],
    },
    lastName: {
      type: String,
      required: [true, "Last name is required"],
      trim: true,
      maxlength: [50, "Last name cannot exceed 50 characters"],
    },
    profilePicture: {
      type: String,
      default: "",
    },
    preferences: {
      autoFraming: {
        enabled: { type: Boolean, default: true },
        margin: { type: Number, default: 50, min: 10, max: 200 },
        smoothing: { type: Number, default: 0.3, min: 0.1, max: 1.0 },
      },
      notifications: {
        enabled: { type: Boolean, default: true },
        frequency: {
          type: String,
          enum: ["low", "medium", "high"],
          default: "medium",
        },
      },
      thresholds: {
        neckDeviation: { type: Number, default: 0.08, min: 0.01, max: 0.2 },
        shoulderTilt: { type: Number, default: 0.05, min: 0.01, max: 0.15 },
        backBending: { type: Number, default: 0.12, min: 0.01, max: 0.25 },
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Posture Session Schema
const postureSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    startTime: {
      type: Date,
      required: true,
      default: Date.now,
    },
    endTime: {
      type: Date,
    },
    duration: {
      type: Number, // Duration in minutes
      default: 0,
    },
    status: {
      type: String,
      enum: ["active", "paused", "completed"],
      default: "active",
    },
    postureMetrics: {
      headTiltCount: { type: Number, default: 0 },
      shoulderBendingCount: { type: Number, default: 0 },
      backBendingCount: { type: Number, default: 0 },
      totalCorrections: { type: Number, default: 0 },
    },
    scores: {
      headTiltScore: { type: Number, default: 100, min: 0, max: 100 },
      shoulderAlignmentScore: { type: Number, default: 100, min: 0, max: 100 },
      spinalPostureScore: { type: Number, default: 100, min: 0, max: 100 },
      overallScore: { type: Number, default: 100, min: 0, max: 100 },
    },
    eyeHealth: {
      blinkCount: { type: Number, default: 0 },
      averageBlinkRate: { type: Number, default: 0 }, // blinks per minute
      lowBlinkWarnings: { type: Number, default: 0 },
    },
    autoFramingStats: {
      enabled: { type: Boolean, default: true },
      adjustmentCount: { type: Number, default: 0 },
      averageFrameStability: { type: Number, default: 0 },
    },
    feedbackMessages: [
      {
        timestamp: { type: Date, default: Date.now },
        message: { type: String, required: true },
        category: {
          type: String,
          enum: ["posture", "proximity", "eye_health", "auto_framing"],
          required: true,
        },
        severity: {
          type: String,
          enum: ["info", "warning", "alert"],
          default: "info",
        },
      },
    ],
    deviceInfo: {
      cameraResolution: { type: String },
      userAgent: { type: String },
      platform: { type: String },
    },
  },
  {
    timestamps: true,
  }
);

// Calculate session duration before saving
postureSessionSchema.pre("save", function (next) {
  if (this.endTime && this.startTime) {
    this.duration = Math.round((this.endTime - this.startTime) / (1000 * 60)); // Convert to minutes
  }
  next();
});

// Posture Pattern Schema (for detailed analytics)
const posturePatternSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PostureSession",
      required: true,
      index: true,
    },
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    postureData: {
      neckPosition: {
        x: { type: Number, required: true },
        y: { type: Number, required: true },
        deviation: { type: Number, required: true },
      },
      shoulderAlignment: {
        leftShoulder: {
          x: { type: Number, required: true },
          y: { type: Number, required: true },
        },
        rightShoulder: {
          x: { type: Number, required: true },
          y: { type: Number, required: true },
        },
        tiltAngle: { type: Number, required: true },
      },
      spinalCurvature: {
        upperBack: { type: Number, required: true },
        lowerBack: { type: Number, required: true },
        overallBending: { type: Number, required: true },
      },
      proximityToScreen: {
        shoulderWidth: { type: Number, required: true },
        distanceCategory: {
          type: String,
          enum: ["too_close", "optimal", "too_far"],
          required: true,
        },
      },
    },
    scores: {
      instantHeadTiltScore: { type: Number, min: 0, max: 100 },
      instantShoulderScore: { type: Number, min: 0, max: 100 },
      instantSpinalScore: { type: Number, min: 0, max: 100 },
      instantOverallScore: { type: Number, min: 0, max: 100 },
    },
    issues: [
      {
        type: {
          type: String,
          enum: [
            "head_tilt",
            "shoulder_misalignment",
            "back_bending",
            "proximity_warning",
          ],
          required: true,
        },
        severity: {
          type: String,
          enum: ["mild", "moderate", "severe"],
          required: true,
        },
        description: { type: String, required: true },
      },
    ],
  },
  {
    timestamps: false, // We're using our own timestamp field
  }
);

// Daily Summary Schema (for quick reporting)
const dailySummarySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    date: {
      type: Date,
      required: true,
      index: true,
    },
    totalTimeTracked: { type: Number, default: 0 }, // in minutes
    cumulativeDuration: { type: Number, default: 0 }, // in seconds (cumulative across all days)
    sessionsCount: { type: Number, default: 0 },
    averageScores: {
      headTilt: { type: Number, default: 100 },
      shoulderAlignment: { type: Number, default: 100 },
      spinalPosture: { type: Number, default: 100 },
      overall: { type: Number, default: 100 },
    },
    totalCorrections: {
      headTiltCorrections: { type: Number, default: 0 },
      shoulderCorrections: { type: Number, default: 0 },
      backCorrections: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },
    eyeHealthMetrics: {
      totalBlinks: { type: Number, default: 0 },
      averageBlinkRate: { type: Number, default: 0 },
      lowBlinkPeriods: { type: Number, default: 0 },
    },
    qualityMetrics: {
      bestSessionScore: { type: Number, default: 0 },
      worstSessionScore: { type: Number, default: 100 },
      consistencyScore: { type: Number, default: 0 }, // How consistent posture was
      improvementTrend: {
        type: String,
        enum: ["improving", "stable", "declining", "insufficient_data"],
        default: "insufficient_data",
      },
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient date-based queries
dailySummarySchema.index({ userId: 1, date: 1 }, { unique: true });
posturePatternSchema.index({ userId: 1, timestamp: 1 });
postureSessionSchema.index({ userId: 1, startTime: 1 });

// Export models
module.exports = {
  User: mongoose.model("User", userSchema),
  PostureSession: mongoose.model("PostureSession", postureSessionSchema),
  PosturePattern: mongoose.model("PosturePattern", posturePatternSchema),
  DailySummary: mongoose.model("DailySummary", dailySummarySchema),
};

// --- Appended: Tracked Time Schema and Export ---
const trackedTimeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    date: { type: Date, required: true, index: true }, // midnight of the day
    todaysTimeTrackedSeconds: { type: Number, default: 0 },
    currentSessionTimeSeconds: { type: Number, default: 0 },
  },
  { timestamps: true }
);
trackedTimeSchema.index({ userId: 1, date: 1 }, { unique: true });

// Safely attach to existing exports without altering original object structure
module.exports.TrackedTime = mongoose.model("TrackedTime", trackedTimeSchema);
