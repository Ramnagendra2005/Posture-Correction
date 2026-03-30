/**
 * User Routes
 *
 * Handles user profile management and preferences updates.
 */

const express = require("express");
const { body, validationResult } = require("express-validator");
const { User } = require("../models");
const PostureService = require("../services/postureService");
const logger = require("../utils/logger");

const router = express.Router();

/**
 * @route   GET /api/user/profile
 * @desc    Get user profile information
 * @access  Private
 */
router.get("/profile", async (req, res, next) => {
  try {
    const user = await User.findById(req.userId).select("-password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          profilePicture: user.profilePicture,
          preferences: user.preferences,
          lastLogin: user.lastLogin,
          createdAt: user.createdAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   PUT /api/user/profile
 * @desc    Update user profile information
 * @access  Private
 */
router.put(
  "/profile",
  [
    body("firstName")
      .optional()
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage("First name cannot exceed 50 characters"),
    body("lastName")
      .optional()
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage("Last name cannot exceed 50 characters"),
    body("email")
      .optional()
      .isEmail()
      .normalizeEmail()
      .withMessage("Please provide a valid email"),
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
      const { firstName, lastName, email } = req.body;

      // Check if email is already taken by another user
      if (email) {
        const existingUser = await User.findOne({
          email,
          _id: { $ne: userId },
        });

        if (existingUser) {
          return res.status(400).json({
            success: false,
            message: "Email is already registered to another account",
          });
        }
      }

      // Update user
      const updateData = {};
      if (firstName !== undefined) updateData.firstName = firstName;
      if (lastName !== undefined) updateData.lastName = lastName;
      if (email !== undefined) updateData.email = email;

      const user = await User.findByIdAndUpdate(userId, updateData, {
        new: true,
        runValidators: true,
      }).select("-password");

      logger.info(`User profile updated: ${user.username}`);

      res.json({
        success: true,
        message: "Profile updated successfully",
        data: { user },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   PUT /api/user/preferences
 * @desc    Update user preferences
 * @access  Private
 */
router.put(
  "/preferences",
  [
    body("autoFraming.enabled")
      .optional()
      .isBoolean()
      .withMessage("Auto-framing enabled must be a boolean"),
    body("autoFraming.margin")
      .optional()
      .isInt({ min: 10, max: 200 })
      .withMessage("Auto-framing margin must be between 10 and 200"),
    body("autoFraming.smoothing")
      .optional()
      .isFloat({ min: 0.1, max: 1.0 })
      .withMessage("Auto-framing smoothing must be between 0.1 and 1.0"),
    body("notifications.enabled")
      .optional()
      .isBoolean()
      .withMessage("Notifications enabled must be a boolean"),
    body("notifications.frequency")
      .optional()
      .isIn(["low", "medium", "high"])
      .withMessage("Notification frequency must be low, medium, or high"),
    body("thresholds.neckDeviation")
      .optional()
      .isFloat({ min: 0.01, max: 0.2 })
      .withMessage("Neck deviation threshold must be between 0.01 and 0.2"),
    body("thresholds.shoulderTilt")
      .optional()
      .isFloat({ min: 0.01, max: 0.15 })
      .withMessage("Shoulder tilt threshold must be between 0.01 and 0.15"),
    body("thresholds.backBending")
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
      const preferences = req.body;

      // Get current user
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Update preferences
      if (preferences.autoFraming) {
        user.preferences.autoFraming = {
          ...user.preferences.autoFraming,
          ...preferences.autoFraming,
        };
      }

      if (preferences.notifications) {
        user.preferences.notifications = {
          ...user.preferences.notifications,
          ...preferences.notifications,
        };
      }

      if (preferences.thresholds) {
        user.preferences.thresholds = {
          ...user.preferences.thresholds,
          ...preferences.thresholds,
        };
      }

      await user.save();

      // Update active session preferences if user has one
      const activeSession = PostureService.getActiveSession(userId);
      if (activeSession) {
        await PostureService.updateSessionPreferences(userId, user.preferences);
      }

      logger.info(`User preferences updated: ${user.username}`);

      res.json({
        success: true,
        message: "Preferences updated successfully",
        data: {
          preferences: user.preferences,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   GET /api/user/preferences
 * @desc    Get user preferences
 * @access  Private
 */
router.get("/preferences", async (req, res, next) => {
  try {
    const user = await User.findById(req.userId).select("preferences");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      data: {
        preferences: user.preferences,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   DELETE /api/user/account
 * @desc    Deactivate user account
 * @access  Private
 */
router.delete(
  "/account",
  [
    body("password")
      .notEmpty()
      .withMessage("Password is required to deactivate account"),
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
      const { password } = req.body;

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Verify password
      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        return res.status(400).json({
          success: false,
          message: "Invalid password",
        });
      }

      // Stop any active monitoring session
      await PostureService.stopMonitoring(userId);

      // Deactivate account (soft delete)
      user.isActive = false;
      await user.save();

      logger.info(`User account deactivated: ${user.username}`);

      res.json({
        success: true,
        message: "Account deactivated successfully",
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   POST /api/user/change-password
 * @desc    Change user password
 * @access  Private
 */
router.post(
  "/change-password",
  [
    body("currentPassword")
      .notEmpty()
      .withMessage("Current password is required"),
    body("newPassword")
      .isLength({ min: 6 })
      .withMessage("New password must be at least 6 characters")
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage(
        "New password must contain at least one uppercase letter, one lowercase letter, and one number"
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
      const { currentPassword, newPassword } = req.body;

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Verify current password
      const isCurrentPasswordValid = await user.comparePassword(
        currentPassword
      );
      if (!isCurrentPasswordValid) {
        return res.status(400).json({
          success: false,
          message: "Current password is incorrect",
        });
      }

      // Update password
      user.password = newPassword;
      await user.save();

      logger.info(`Password changed for user: ${user.username}`);

      res.json({
        success: true,
        message: "Password changed successfully",
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
