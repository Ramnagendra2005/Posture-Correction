/**
 * Authentication Routes
 *
 * Handles user registration, login, and token refresh functionality.
 */

const express = require("express");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const { User } = require("../models");
const { authenticateToken } = require("../middleware/auth");
const logger = require("../utils/logger");

const router = express.Router();

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user
 * @access  Public
 */
router.post(
  "/register",
  [
    body("username")
      .isLength({ min: 3, max: 30 })
      .withMessage("Username must be between 3 and 30 characters")
      .matches(/^[a-zA-Z0-9_]+$/)
      .withMessage(
        "Username can only contain letters, numbers, and underscores"
      ),
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Please provide a valid email"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters")
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage(
        "Password must contain at least one uppercase letter, one lowercase letter, and one number"
      ),
    body("firstName")
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage("First name is required and cannot exceed 50 characters"),
    body("lastName")
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage("Last name is required and cannot exceed 50 characters"),
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

      const { username, email, password, firstName, lastName } = req.body;

      // Check if user already exists
      const existingUser = await User.findOne({
        $or: [{ email }, { username }],
      });

      if (existingUser) {
        return res.status(400).json({
          success: false,
          message:
            existingUser.email === email
              ? "Email is already registered"
              : "Username is already taken",
        });
      }

      // Create new user
      const user = new User({
        username,
        email,
        password,
        firstName,
        lastName,
      });

      await user.save();

      // Generate JWT token
      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        logger.error("JWT_SECRET is not defined in environment variables");
        return res.status(500).json({
          success: false,
          message: "Server configuration error",
        });
      }

      const token = jwt.sign(
        { userId: user._id, username: user.username },
        jwtSecret,
        { expiresIn: process.env.JWT_EXPIRE || "7d" }
      );

      logger.info(`New user registered: ${user.username} (${user.email})`);

      res.status(201).json({
        success: true,
        message: "User registered successfully",
        data: {
          user: {
            id: user._id,
            username: user.username,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            preferences: user.preferences,
          },
          token,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   POST /api/auth/login
 * @desc    Login user
 * @access  Public
 */
router.post(
  "/login",
  [
    body("credential").notEmpty().withMessage("Username or email is required"),
    body("password").notEmpty().withMessage("Password is required"),
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

      const { credential, password } = req.body;

      // Find user by email or username
      const user = await User.findOne({
        $or: [{ email: credential.toLowerCase() }, { username: credential }],
        isActive: true,
      });

      if (!user) {
        return res.status(400).json({
          success: false,
          message: "Invalid credentials",
        });
      }

      // Check password
      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        return res.status(400).json({
          success: false,
          message: "Invalid credentials",
        });
      }

      // Update last login
      user.lastLogin = new Date();
      await user.save();

      // Generate JWT token
      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        logger.error("JWT_SECRET is not defined in environment variables");
        return res.status(500).json({
          success: false,
          message: "Server configuration error",
        });
      }

      const token = jwt.sign(
        { userId: user._id, username: user.username },
        jwtSecret,
        { expiresIn: process.env.JWT_EXPIRE || "7d" }
      );

      logger.info(`User logged in: ${user.username}`);

      res.json({
        success: true,
        message: "Login successful",
        data: {
          user: {
            id: user._id,
            username: user.username,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            preferences: user.preferences,
            lastLogin: user.lastLogin,
          },
          token,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   POST /api/auth/refresh
 * @desc    Refresh JWT token
 * @access  Private
 */
router.post("/refresh", authenticateToken, async (req, res, next) => {
  try {
    const user = await User.findById(req.userId).select("-password");

    if (!user || !user.isActive) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Generate new token
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      logger.error("JWT_SECRET is not defined in environment variables");
      return res.status(500).json({
        success: false,
        message: "Server configuration error",
      });
    }

    const token = jwt.sign(
      { userId: user._id, username: user.username },
      jwtSecret,
      { expiresIn: process.env.JWT_EXPIRE || "7d" }
    );

    res.json({
      success: true,
      message: "Token refreshed successfully",
      data: {
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          preferences: user.preferences,
        },
        token,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user (mainly for frontend to clear token)
 * @access  Public (allows logout even with invalid tokens)
 */
router.post("/logout", async (req, res) => {
  try {
    // Get username from token if available, otherwise use "unknown"
    let username = "unknown";
    const token = req.headers.authorization?.split(" ")[1];

    if (token) {
      try {
        const jwt = require("jsonwebtoken");
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        username = user?.username || "unknown";
      } catch (tokenError) {
        // Token is invalid/expired, but that's okay for logout
        logger.info("Logout attempted with invalid/expired token");
      }
    }

    logger.info(`User logged out: ${username}`);

    res.json({
      success: true,
      message: "Logout successful",
    });
  } catch (error) {
    // Even if there's an error, we should allow logout
    logger.error("Logout error:", error);
    res.json({
      success: true,
      message: "Logout completed (with errors)",
    });
  }
});

/**
 * @route   GET /api/auth/verify
 * @desc    Verify JWT token and return user data
 * @access  Private
 */
router.get("/verify", authenticateToken, async (req, res, next) => {
  try {
    const user = await User.findById(req.userId).select("-password");

    if (!user || !user.isActive) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        preferences: user.preferences,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/auth/me
 * @desc    Get current user information
 * @access  Private
 */
router.get("/me", authenticateToken, async (req, res, next) => {
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

module.exports = router;
