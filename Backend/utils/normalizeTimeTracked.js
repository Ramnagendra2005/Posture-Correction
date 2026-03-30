/**
 * Normalize DailySummary.totalTimeTracked to minutes and clamp to 1440 per day,
 * then recompute cumulativeDuration (in seconds).
 *
 * Run with: node utils/normalizeTimeTracked.js
 */
const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { DailySummary, User } = require("../models");
const logger = require("../utils/logger");

async function main() {
  const uri =
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    "mongodb://localhost:27017/posture_tracker";
  await mongoose.connect(uri);
  logger.info("Connected to MongoDB for normalization");

  try {
    const users = await User.find({}).select("_id");
    logger.info(`Normalizing time for ${users.length} users`);

    for (const u of users) {
      const summaries = await DailySummary.find({ userId: u._id }).sort({
        date: 1,
      });
      let cumulativeSeconds = 0;
      for (const s of summaries) {
        // Detect seconds-like values and convert to minutes, else keep as minutes
        let minutes = Number(s.totalTimeTracked || 0);
        if (minutes >= 1000 && minutes <= 86400) {
          minutes = Math.round(minutes / 60); // seconds -> minutes
        }
        if (!Number.isFinite(minutes) || minutes < 0) minutes = 0;
        minutes = Math.min(minutes, 1440); // cap to 24h/day

        s.totalTimeTracked = minutes;
        cumulativeSeconds += Math.round(minutes * 60);
        s.cumulativeDuration = cumulativeSeconds;
        await s.save();
      }
      logger.info(`Normalized ${summaries.length} summaries for user ${u._id}`);
    }
    logger.info("Normalization completed");
  } catch (err) {
    logger.error(`Normalization failed: ${err.message}`);
    console.error(err);
  } finally {
    await mongoose.disconnect();
    logger.info("Disconnected from MongoDB");
  }
}

main();
