/**
 * Main Server Configuration
 *
 * This file sets up the Express server with all necessary middleware,
 * database connections, and route handlers for the posture monitoring application.
 */

const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { createServer } = require("http");
const { Server } = require("socket.io");
require("dotenv").config({ path: path.join(__dirname, ".env") });

// Import routes
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/user");
const sessionRoutes = require("./routes/session");
const postureRoutes = require("./routes/posture");
const reportRoutes = require("./routes/reports");
const chatRoutes = require("./routes/chat");
const exerciseRoutes = require("./routes/exercises");

// Import middleware
const { authenticateToken } = require("./middleware/auth");
const errorHandler = require("./middleware/errorHandler");
const logger = require("./utils/logger");

// Import services
const PostureService = require("./services/postureService");
const cron = require("node-cron");
const { sendMail } = require("./services/emailService");
const { buildDailyEmail } = require("./services/dailyReportService");
const { User } = require("./models");

const app = express();
const server = createServer(app);

// Initialize Socket.IO for real-time communication
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  },
});

// Security middleware
app.use(
  helmet({
    crossOriginEmbedderPolicy: false, // Required for video streaming
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "blob:"],
      },
    },
  })
);

// Rate limiting
// 1) Light limiter for public/unauthenticated routes (per IP)
const publicLimiter = rateLimit({
  windowMs: parseInt(process.env.WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.MAX_REQUESTS_PER_WINDOW) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
  // Don't rate-limit token verification to avoid accidental logouts
  skip: (req) => req.path?.includes("/api/auth/verify"),
});

// 2) Per-user limiter for authenticated report analytics (prevents noisy 429s across users)
const reportsLimiter = rateLimit({
  windowMs: parseInt(process.env.REPORTS_WINDOW_MS) || 60 * 1000, // 1 minute
  max: parseInt(process.env.REPORTS_MAX_PER_WINDOW) || 30, // 30 req/min/user
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    req.userId || req.user?._id ? `u:${req.userId || req.user?._id}` : `ip:${req.ip}`,
  message: {
    error: "Too many report requests. Please slow down.",
    retryAfter: "60s",
  },
});

// 3) Per-user limiter for posture trend endpoints (slightly higher as these can refresh live)
const trendsLimiter = rateLimit({
  windowMs: parseInt(process.env.TRENDS_WINDOW_MS) || 60 * 1000,
  max: parseInt(process.env.TRENDS_MAX_PER_WINDOW) || 60, // 60 req/min/user
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    req.userId || req.user?._id ? `u:${req.userId || req.user?._id}` : `ip:${req.ip}`,
  message: {
    error: "Too many trend requests. Please wait a moment.",
    retryAfter: "60s",
  },
});

// CORS configuration
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Content-Length",
      "X-Requested-With",
    ],
    preflightContinue: false,
    optionsSuccessStatus: 200,
  })
);

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path} - ${req.ip}`);
  next();
});

// Database connection
mongoose
  .connect(
    process.env.MONGODB_URI || "mongodb://localhost:27017/posture_tracker",
    {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    }
  )
  .then(() => {
    logger.info("Connected to MongoDB successfully");
  })
  .catch((error) => {
    logger.error("MongoDB connection error:", error);
    process.exit(1);
  });

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    database:
      mongoose.connection.readyState === 1 ? "Connected" : "Disconnected",
  });
});

// API Routes
// Apply public limiter only to unauthenticated routes
app.use("/api/auth", publicLimiter, authRoutes);
app.use("/api/user", authenticateToken, userRoutes);
app.use("/api/sessions", authenticateToken, sessionRoutes);

// Add targeted limiters before mounting respective handlers
// Posture trends (authenticated GETs that refresh frequently)
app.use("/api/posture/hourly-trends", authenticateToken, trendsLimiter);
app.use("/api/posture/live-dashboard", authenticateToken, trendsLimiter);

// Mount posture routes (route-level auth applied within file where needed)
app.use("/api/posture", postureRoutes); // individual routes handle auth

// Reports analytics (authenticated, heavier data)
app.use("/api/reports", authenticateToken, reportsLimiter, reportRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/exercises", authenticateToken, exerciseRoutes);

// Initialize posture service with Socket.IO
PostureService.initialize(io);

// Socket.IO connection handling
io.use((socket, next) => {
  // Authentication middleware for Socket.IO
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error("Authentication error"));
  }

  const jwt = require("jsonwebtoken");
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    next();
  } catch (error) {
    next(new Error("Authentication error"));
  }
});

io.on("connection", (socket) => {
  logger.info(`User ${socket.userId} connected via Socket.IO`);

  // Join user-specific room
  socket.join(`user_${socket.userId}`);

  // Handle posture data streaming
  socket.on("start_posture_monitoring", (data) => {
    PostureService.startMonitoring(socket.userId, data);
  });

  socket.on("stop_posture_monitoring", () => {
    PostureService.stopMonitoring(socket.userId);
  });

  socket.on("disconnect", () => {
    logger.info(`User ${socket.userId} disconnected`);
    PostureService.stopMonitoring(socket.userId);
  });
});

// 404 handler: forward to the global error handler for consistent formatting/logging.
app.use("*", (req, res, next) => {
  const error = new Error("Route not found");
  error.statusCode = 404;
  next(error);
});

// Global error handler
app.use(errorHandler);

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully");
  server.close(() => {
    mongoose.connection.close();
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  logger.info("SIGINT received, shutting down gracefully");
  server.close(() => {
    mongoose.connection.close();
    process.exit(0);
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
});

// Schedule: send daily posture reports to all users at 18:00 server time
// Cron format "0 18 * * *" means at minute 0 of hour 18 every day
if (process.env.ENABLE_DAILY_EMAILS === "true") {
  cron.schedule(process.env.DAILY_EMAIL_CRON || "0 18 * * *", async () => {
    try {
      logger.info("Starting daily report email job...");
      const users = await User.find({ isActive: true }).select(
        "_id email firstName username"
      );
      const today = new Date();

      for (const user of users) {
        try {
          const { to, subject, html } = await buildDailyEmail(user._id, today);
          const info = await sendMail({ to, subject, html });
          if (info?.skipped) {
            logger.warn(`Email skipped for ${to} (SMTP not configured)`);
            break; // Don't loop needlessly if SMTP isn't configured
          }
        } catch (e) {
          logger.error(
            `Failed to send daily report to ${user.email}: ${e.message}`
          );
        }
      }
      logger.info("Daily report email job completed.");
    } catch (err) {
      logger.error("Daily email cron job failed:", err);
    }
  });
  logger.info("Daily email scheduler initialized.");
} else {
  logger.info("Daily email scheduler disabled (ENABLE_DAILY_EMAILS != true)");
}

module.exports = app;
