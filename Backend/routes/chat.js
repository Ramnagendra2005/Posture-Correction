const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/auth");
const { processMessage } = require("../services/chatbotAgentService");
const logger = require("../utils/logger");

// Fallback responses for when AI is unavailable
const getFallbackResponse = (message) => {
  const lowerMessage = message.toLowerCase();

  const postureKeywords = [
    "posture", "back", "neck", "shoulder", "spine", "ergonomic",
    "chair", "desk", "monitor", "sitting", "standing", "exercise",
    "stretch", "pain", "ache", "workspace", "setup", "break", "reminder",
  ];

  const isPostureRelated = postureKeywords.some((keyword) =>
    lowerMessage.includes(keyword)
  );

  if (!isPostureRelated) {
    return `I'm specialized in helping with posture and ergonomics! 🏃‍♂️

While I'd love to help with other topics, I'm specifically designed to assist with:
• **Posture improvement** and techniques
• **Workspace ergonomics** and setup
• **Exercise recommendations** for better posture
• **Understanding your posture metrics**
• **Break scheduling** and reminders

Is there anything about your posture or workspace setup I can help you with instead?`;
  }

  return `I'm your **posture health assistant**! 🤖

I can help you with:
• **Posture improvement tips**
• **Ergonomic workspace setup**
• **Exercise recommendations**
• **Understanding your posture data**

What would you like to know about maintaining healthy posture?`;
};

// POST /api/chat - Send message to chatbot (LangChain/LangGraph Agent)
router.post("/", authenticateToken, async (req, res) => {
  try {
    const { message } = req.body;
    const userId = req.userId?.toString?.() || req.user?._id?.toString?.() || "unknown";
    const username = req.user?.username || "unknown";

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        success: false,
        error: "Message is required and must be a string",
      });
    }

    logger.info(
      `Chat message from user ${username} (${userId}): ${message.substring(0, 50)}...`
    );

    let result;

    // Check if Gemini API key is configured
    if (
      !process.env.GEMINI_API_KEY ||
      process.env.GEMINI_API_KEY === "your_gemini_api_key_here"
    ) {
      logger.warn("Gemini API key not configured, using fallback responses");
      result = {
        response: getFallbackResponse(message.trim()),
        personalized: false,
      };
    } else {
      try {
        // Use LangChain/LangGraph agent for intelligent responses
        result = await processMessage(userId, message.trim());
      } catch (aiError) {
        logger.error("AI agent response failed, using fallback:", aiError);
        result = {
          response: getFallbackResponse(message.trim()),
          personalized: false,
        };
      }
    }

    res.json({
      success: true,
      response: result.response,
      personalized: result.personalized || false,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Chat error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to process chat message",
      response:
        "I'm sorry, I'm having technical difficulties right now. Please try again in a moment.",
    });
  }
});

module.exports = router;
