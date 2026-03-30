/**
 * Authentication Middleware
 *
 * Handles JWT token verification and user authentication for protected routes.
 */

const jwt = require("jsonwebtoken");
const { User } = require("../models");
const logger = require("../utils/logger");

/**
 * Middleware to authenticate JWT tokens
 */
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Access token is required",
      });
    }

    // Verify the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Find the user
    const user = await User.findById(decoded.userId).select("-password");

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: "Invalid token or user not found",
      });
    }

    // Add user information to request object
    req.user = user;
    req.userId = user._id;

    next();
  } catch (error) {
    logger.error("Authentication error:", error);

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token has expired",
      });
    }

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Invalid token",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Authentication failed",
    });
  }
};

/**
 * Middleware to check if user is admin (if needed for future features)
 */
const requireAdmin = async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Admin access required",
      });
    }
    next();
  } catch (error) {
    logger.error("Admin check error:", error);
    return res.status(500).json({
      success: false,
      message: "Authorization check failed",
    });
  }
};

/**
 * Optional authentication middleware (for routes that work with or without auth)
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).select("-password");

      if (user && user.isActive) {
        req.user = user;
        req.userId = user._id;
      }
    }

    next();
  } catch (error) {
    // Continue without authentication for optional routes
    next();
  }
};

module.exports = {
  authenticateToken,
  requireAdmin,
  optionalAuth,
};
