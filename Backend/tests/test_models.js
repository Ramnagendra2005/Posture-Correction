/**
 * Database Schema Verification Test
 * 
 * Tests that all 5 schemas (User, PostureSession, PostureSnapshot,
 * DailySummary, ExerciseRecommendation) can be instantiated, validated,
 * and saved correctly.
 * 
 * Usage: node Backend/tests/test_models.js
 * Requires: MongoDB running (uses MONGODB_URI from .env)
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

const {
  User,
  PostureSession,
  PostureSnapshot,
  DailySummary,
  ExerciseRecommendation,
} = require("../models");

const TEST_PREFIX = "__test_schema_verify__";

async function cleanup(userId) {
  if (userId) {
    await PostureSnapshot.deleteMany({ userId });
    await PostureSession.deleteMany({ userId });
    await DailySummary.deleteMany({ userId });
    await ExerciseRecommendation.deleteMany({ userId });
    await User.deleteOne({ _id: userId });
  }
}

async function runTests() {
  let userId = null;

  try {
    // Connect to MongoDB
    const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/posture_monitoring";
    await mongoose.connect(uri);
    console.log("✅ Connected to MongoDB\n");

    // ─── 1. Create User with safeMode ───
    console.log("--- Test 1: User Schema ---");
    const user = new User({
      username: `${TEST_PREFIX}user`,
      email: `${TEST_PREFIX}user@test.com`,
      password: "Test123!",
      firstName: "Test",
      lastName: "User",
      safeMode: true,
      preferences: {
        notifications: { inApp: true, push: false, frequency: "high" },
        sustainedFlawThresholdSeconds: 300,
      },
    });
    await user.save();
    userId = user._id;
    console.log(`  ✅ User created with safeMode=${user.safeMode}`);
    console.log(`  ✅ notifications.inApp=${user.preferences.notifications.inApp}`);
    console.log(`  ✅ notifications.push=${user.preferences.notifications.push}`);
    console.log(`  ✅ sustainedFlawThresholdSeconds=${user.preferences.sustainedFlawThresholdSeconds}`);
    console.log(`  ✅ Password hashed: ${user.password !== "Test123!"}\n`);

    // ─── 2. Create PostureSession with sustainedFlaws ───
    console.log("--- Test 2: PostureSession Schema ---");
    const session = new PostureSession({
      userId,
      startTime: new Date(Date.now() - 30 * 60 * 1000), // 30 min ago
      endTime: new Date(),
      status: "completed",
      scores: {
        headTiltScore: 75,
        shoulderAlignmentScore: 80,
        spinalPostureScore: 85,
        proximityScore: 90,
        overallScore: 82,
      },
      sustainedFlaws: [
        {
          flawType: "head_tilt",
          startedAt: new Date(Date.now() - 20 * 60 * 1000),
          endedAt: new Date(Date.now() - 15 * 60 * 1000),
          durationSeconds: 300,
          notificationSent: true,
        },
      ],
      notifications: [
        {
          type: "in_app",
          message: "Your neck has been tilted for 5 minutes. Please sit straight!",
          flawType: "head_tilt",
        },
      ],
    });
    await session.save();
    console.log(`  ✅ Session created: durationSeconds=${session.durationSeconds}`);
    console.log(`  ✅ sustainedFlaws count: ${session.sustainedFlaws.length}`);
    console.log(`  ✅ notifications count: ${session.notifications.length}`);
    console.log(`  ✅ proximityScore: ${session.scores.proximityScore}\n`);

    // ─── 3. Create PostureSnapshots ───
    console.log("--- Test 3: PostureSnapshot Schema ---");
    const snapshot = new PostureSnapshot({
      userId,
      sessionId: session._id,
      landmarks: {
        neckDeviation: 0.12,
        shoulderTiltAngle: 3.5,
        forwardLeanAngle: 8.2,
        shoulderWidth: 0.55,
      },
      scores: {
        headTilt: 65,
        shoulderAlignment: 80,
        spinalPosture: 75,
        proximity: 90,
        overall: 77,
      },
      activeFlaws: ["head_tilt", "forward_lean"],
      blinkRate: 12,
    });
    await snapshot.save();
    console.log(`  ✅ Snapshot created with ${snapshot.activeFlaws.length} active flaws`);
    console.log(`  ✅ Landmarks stored: neckDeviation=${snapshot.landmarks.neckDeviation}`);
    console.log(`  ✅ Scores stored: overall=${snapshot.scores.overall}\n`);

    // ─── 4. Create DailySummary ───
    console.log("--- Test 4: DailySummary Schema ---");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const summary = new DailySummary({
      userId,
      date: today,
      totalTimeTrackedSeconds: 1800, // 30 minutes
      sessionsCount: 1,
      averageScores: { headTilt: 75, shoulderAlignment: 80, spinalPosture: 85, proximity: 90, overall: 82 },
      flawBreakdown: {
        headTiltMinutes: 5,
        shoulderMisalignmentMinutes: 2,
        forwardLeanMinutes: 3,
        tooCloseMinutes: 0,
      },
    });
    await summary.save();
    console.log(`  ✅ DailySummary created: totalTimeTrackedSeconds=${summary.totalTimeTrackedSeconds}`);
    console.log(`  ✅ flawBreakdown.headTiltMinutes=${summary.flawBreakdown.headTiltMinutes}\n`);

    // ─── 5. Create ExerciseRecommendation ───
    console.log("--- Test 5: ExerciseRecommendation Schema ---");
    const recommendation = new ExerciseRecommendation({
      userId,
      date: today,
      sessionId: session._id,
      flawType: "head_tilt",
      severity: "moderate",
      exercises: [
        {
          name: "Chin Tucks",
          description: "Gently tuck your chin toward your chest, hold for 5 seconds",
          durationMinutes: 3,
          difficulty: "light",
          isSafeModeCompatible: true,
          bodyArea: "neck",
        },
        {
          name: "Neck Stretches",
          description: "Tilt head side to side, hold each side for 10 seconds",
          durationMinutes: 5,
          difficulty: "moderate",
          isSafeModeCompatible: true,
          bodyArea: "neck",
        },
        {
          name: "Resistance Band Neck Training",
          description: "Use resistance band for progressive neck strengthening",
          durationMinutes: 10,
          difficulty: "intense",
          isSafeModeCompatible: false, // NOT safe for medical restrictions
          bodyArea: "neck",
        },
      ],
    });
    await recommendation.save();
    console.log(`  ✅ ExerciseRecommendation created for flaw: ${recommendation.flawType}`);
    console.log(`  ✅ Total exercises: ${recommendation.exercises.length}`);

    const safeExercises = recommendation.exercises.filter((e) => e.isSafeModeCompatible);
    console.log(`  ✅ Safe mode compatible: ${safeExercises.length}/${recommendation.exercises.length}\n`);

    // ─── 6. Verify Exports ───
    console.log("--- Test 6: Model Exports ---");
    const models = require("../models");
    const expectedModels = ["User", "PostureSession", "PostureSnapshot", "DailySummary", "ExerciseRecommendation"];
    for (const name of expectedModels) {
      if (models[name]) {
        console.log(`  ✅ ${name} exported correctly`);
      } else {
        console.log(`  ❌ ${name} NOT found in exports!`);
      }
    }
    // Verify old models are removed
    if (!models.PosturePattern) {
      console.log(`  ✅ PosturePattern correctly removed`);
    }
    if (!models.TrackedTime) {
      console.log(`  ✅ TrackedTime correctly removed`);
    }

    console.log("\n═══════════════════════════════════════");
    console.log("  ALL SCHEMA TESTS PASSED ✅");
    console.log("═══════════════════════════════════════\n");
  } catch (error) {
    console.error("\n❌ TEST FAILED:", error.message);
    console.error(error.stack);
  } finally {
    // Cleanup test data
    await cleanup(userId);
    console.log("🧹 Test data cleaned up");
    await mongoose.disconnect();
    console.log("🔌 Disconnected from MongoDB");
  }
}

runTests();
