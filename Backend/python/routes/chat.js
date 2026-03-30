const express = require("express");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const router = express.Router();
const { authenticateToken } = require("../middleware/auth");
const logger = require("../utils/logger");

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Detection prompt generator to classify if question is posture-related
const getDetectionPrompt = (
  question
) => `You are a question classifier for a posture monitoring application. 

Analyze the following question and determine if it's related to posture, ergonomics, or workplace health.

POSTURE-RELATED topics include:
- Posture improvement, correction, or analysis
- Back pain, neck pain, shoulder pain from sitting/working
- Ergonomic workspace setup (chair, desk, monitor positioning)
- Exercises and stretches for better posture
- Break reminders and movement during work
- Spinal health and alignment
- Workplace ergonomics and health
- Computer workstation setup
- Standing vs sitting desks
- Posture tracking and monitoring

NON-POSTURE topics include:
- Weather, news, cooking, entertainment
- General health unrelated to posture
- Technology troubleshooting (unrelated to ergonomics)
- Personal questions not about physical health
- Academic subjects, math, science (unless ergonomic)

Respond with ONLY "POSTURE" or "NON-POSTURE" - no other text.

Question: "${question}"`;

// Response prompt generators for different categories
const getPostureResponsePrompt = (
  message
) => `You are a specialized posture and ergonomics expert for a posture monitoring application. 

Provide a detailed, helpful response about the user's posture-related question. Include:
- Specific, actionable advice
- Use **bold formatting** for emphasis
- Include bullet points for clarity
- Be encouraging and professional
- Focus on practical solutions

User Question: "${message}"

Context: This user is using a posture monitoring application that tracks their posture throughout the day.

Provide a comprehensive, helpful response:`;

const getNonPostureResponsePrompt = (
  message
) => `You are a specialized posture assistant, but the user asked about something outside your expertise area.

Politely redirect them while being helpful:
- Acknowledge their question briefly
- Explain you specialize in posture and ergonomics
- Offer to help with posture-related topics instead
- Be friendly and professional
- Suggest some posture topics they might be interested in

User Question: "${message}"

Provide a polite redirection response:`;

// AI-powered question classification and response
const generateAIResponse = async (message, userContext = {}) => {
  try {
    // Step 1: Detect if question is posture-related using AI
    const detectionPrompt = getDetectionPrompt(message);
    const detectionResult = await model.generateContent(detectionPrompt);
    const classification = (await detectionResult.response.text())
      .trim()
      .toUpperCase();

    logger.info(
      `Question classification: "${message.substring(
        0,
        50
      )}..." -> ${classification}`
    );

    // Step 2: Generate appropriate response based on classification
    let responsePrompt;
    if (classification === "POSTURE" || classification.includes("POSTURE")) {
      responsePrompt = getPostureResponsePrompt(message);
    } else {
      responsePrompt = getNonPostureResponsePrompt(message);
    }

    const responseResult = await model.generateContent(responsePrompt);
    const response = await responseResult.response;
    return response.text();
  } catch (error) {
    logger.error("Gemini AI error:", error);
    throw error;
  }
};

// Fallback responses for when AI is unavailable
const getFallbackResponse = (message) => {
  const lowerMessage = message.toLowerCase();

  // Check if it's posture-related
  const postureKeywords = [
    "posture",
    "back",
    "neck",
    "shoulder",
    "spine",
    "ergonomic",
    "chair",
    "desk",
    "monitor",
    "sitting",
    "standing",
    "exercise",
    "stretch",
    "pain",
    "ache",
    "workspace",
    "setup",
    "break",
    "reminder",
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

  // Basic posture-related fallback responses
  if (lowerMessage.includes("posture") || lowerMessage.includes("improve")) {
    return `Here are some **posture improvement tips**:

• **Monitor Height**: Keep your screen at eye level
• **Chair Support**: Use proper lumbar support
• **Take Breaks**: Stand and stretch every 30-45 minutes
• **Shoulder Position**: Keep shoulders relaxed and back

Would you like more specific guidance?`;
  }

  return `I'm your **posture health assistant**! 🤖

I can help you with:
• **Posture improvement tips**
• **Ergonomic workspace setup**
• **Exercise recommendations**
• **Understanding your posture data**

What would you like to know about maintaining healthy posture?`;
};

// POST /api/chat - Send message to chatbot
router.post("/", authenticateToken, async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        success: false,
        error: "Message is required and must be a string",
      });
    }

    // Log the chat interaction
    logger.info(
      `Chat message from user ${req.user.username}: ${message.substring(
        0,
        50
      )}...`
    );

    let response;

    // Check if Gemini API key is configured
    if (
      !process.env.GEMINI_API_KEY ||
      process.env.GEMINI_API_KEY === "your_gemini_api_key_here"
    ) {
      logger.warn("Gemini API key not configured, using fallback responses");
      response = getFallbackResponse(message.trim());
    } else {
      try {
        // Use Gemini AI for intelligent responses
        response = await generateAIResponse(message.trim(), {
          userId: req.user.id,
          username: req.user.username,
        });
      } catch (aiError) {
        logger.error("AI response failed, using fallback:", aiError);
        response = getFallbackResponse(message.trim());
      }
    }

    // Simulate a small delay for more natural feel
    await new Promise((resolve) =>
      setTimeout(resolve, 300 + Math.random() * 700)
    );

    res.json({
      success: true,
      response: response,
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
