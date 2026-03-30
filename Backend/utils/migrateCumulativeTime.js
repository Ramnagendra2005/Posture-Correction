/**
 * Utility script to migrate existing data to support cumulative time tracking
 * This script calculates and populates the cumulativeDuration field for all existing DailySummary records
 *
 * Run with: node utils/migrateCumulativeTime.js
 */

const mongoose = require("mongoose");
const { DailySummary, User } = require("../models");
const logger = require("./logger");

// Connect to MongoDB
const connectDB = async () => {
  try {
    const mongoURI =
      process.env.MONGO_URI || "mongodb://localhost:27017/posture-app";
    await mongoose.connect(mongoURI);
    logger.info("MongoDB Connected for migration...");
  } catch (err) {
    logger.error(`MongoDB Connection Error: ${err.message}`);
    process.exit(1);
  }
};

// Migrate cumulative time data
const migrateCumulativeTime = async () => {
  try {
    logger.info("Starting cumulative time migration...");

    // Get all users
    const users = await User.find({});
    logger.info(`Found ${users.length} users to process`);

    for (const user of users) {
      // Get all daily summaries for the user, sorted by date
      const dailySummaries = await DailySummary.find({ userId: user._id }).sort(
        { date: 1 }
      );

      logger.info(
        `Processing ${dailySummaries.length} daily summaries for user ${user._id}`
      );

      let cumulativeTime = 0;

      // Update each summary with the cumulative time
      for (const summary of dailySummaries) {
        // Calculate session time in seconds
        const dailyTimeSeconds = Math.round(summary.totalTimeTracked * 60); // Convert minutes to seconds

        // Add to cumulative time
        cumulativeTime += dailyTimeSeconds;

        // Update the summary
        summary.cumulativeDuration = cumulativeTime;
        await summary.save();

        logger.info(
          `Updated daily summary ${summary._id}, date: ${summary.date}, cumulative time: ${cumulativeTime} seconds`
        );
      }

      logger.info(`Completed migration for user ${user._id}`);
    }

    logger.info("Migration completed successfully!");
  } catch (error) {
    logger.error(`Migration failed: ${error.message}`);
    console.error(error);
  } finally {
    mongoose.disconnect();
    logger.info("Database connection closed");
  }
};

// Run the migration
connectDB().then(() => {
  migrateCumulativeTime();
});
