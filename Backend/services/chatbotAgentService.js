/**
 * Chatbot Agent Service
 *
 * Intelligent chatbot using Google Generative AI (Gemini) directly.
 * Automatically fetches user posture data and provides personalized responses.
 * Pipeline: classify → fetch data → generate personalized response.
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { POSTURE_SYSTEM_KNOWLEDGE } = require("./postureSystemKnowledge");
const { fetchUserPostureData } = require("./userDataFetcher");
const logger = require("../utils/logger");

let genAI = null;
let model = null;

function getModel() {
  if (model) return model;
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: 2048,
    },
  });
  return model;
}

// Simple in-memory conversation history (per user, last N messages)
const conversationHistory = new Map();
const MAX_HISTORY = 10;

function getHistory(userId) {
  return conversationHistory.get(userId) || [];
}

function addToHistory(userId, role, content) {
  const history = getHistory(userId);
  history.push({ role, content });
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
  conversationHistory.set(userId, history);
}

/**
 * Classify if the question needs personal posture data.
 */
function needsPersonalData(message) {
  const personalKeywords = [
    "my score", "my posture", "my session", "my data", "my progress",
    "my trend", "my report", "my average", "my stats", "my performance",
    "how am i", "how did i", "how is my", "how's my",
    "today's", "this week", "this month",
    "my head", "my shoulder", "my neck", "my back", "my spine",
    "improve", "exercise", "recommend", "suggestion",
    "what should i", "what can i", "tell me about my",
    "analyze", "report", "summary", "corrections", "how many",
    "time tracked", "sessions",
  ];
  const lower = message.toLowerCase();
  return personalKeywords.some((kw) => lower.includes(kw));
}

/**
 * Classify if the question is posture-related at all.
 */
function isPostureRelated(message) {
  const postureKeywords = [
    "posture", "back", "neck", "shoulder", "spine", "ergonomic",
    "chair", "desk", "monitor", "sitting", "standing", "exercise",
    "stretch", "pain", "ache", "workspace", "setup", "break", "reminder",
    "slouch", "lean", "tilt", "blink", "eye", "screen", "lumbar",
    "headache", "stiff", "sore", "alignment", "kyphosis", "lordosis",
    "sciatica", "carpal", "wrist", "forearm", "strain", "sedentary",
    "movement", "mobility", "flexibility", "core", "plank", "yoga",
    "pilates", "foam roller", "score", "session", "tracking",
    "correction", "health", "wellness", "habit", "routine", "improve",
    "recommend", "tip", "advice", "how to", "what is", "why does",
    "should i", "can i",
  ];
  const lower = message.toLowerCase();
  return postureKeywords.some((kw) => lower.includes(kw));
}

/**
 * Process a chat message through the agent pipeline.
 *
 * Pipeline:
 *   1. Classify: posture-related? needs personal data?
 *   2. Fetch user data (if needed)
 *   3. Build context-aware prompt
 *   4. Generate response with Gemini
 */
async function processMessage(userId, message) {
  const startTime = Date.now();
  logger.info(`[ChatAgent] Processing message from user ${userId}: "${message.substring(0, 50)}..."`);

  const llm = getModel();
  const postureRelated = isPostureRelated(message);
  const personalData = needsPersonalData(message);

  // Step 1: If not posture-related, politely redirect
  if (!postureRelated) {
    const redirectPrompt = `You are a specialized posture and ergonomics assistant. The user asked something outside your expertise.

User message: "${message}"

Politely acknowledge their question, explain you specialize in posture and ergonomics, and suggest some relevant posture topics you can help with. Be friendly and brief.`;

    const result = await llm.generateContent(redirectPrompt);
    const responseText = result.response.text();

    addToHistory(userId, "user", message);
    addToHistory(userId, "model", responseText);

    return {
      response: responseText,
      personalized: false,
      timestamp: new Date().toISOString(),
    };
  }

  // Step 2: Fetch personal data if needed
  let userDataContext = "";
  let personalized = false;

  if (personalData) {
    try {
      const { textSummary } = await fetchUserPostureData(userId);
      userDataContext = `\n\n## USER'S PERSONAL POSTURE DATA\n${textSummary}`;
      personalized = true;
      logger.info(`[ChatAgent] Fetched personal data for user ${userId}`);
    } catch (err) {
      logger.error(`[ChatAgent] Failed to fetch user data:`, err.message);
      userDataContext =
        "\n\n[Note: Unable to fetch user's personal data at this time. Provide general advice.]";
    }
  }

  // Step 3: Build conversation with system knowledge + user data
  const systemPrompt = `${POSTURE_SYSTEM_KNOWLEDGE}
${userDataContext}

## YOUR ROLE
You are the user's personal posture AI coach embedded in their posture monitoring app.

RESPONSE GUIDELINES:
- Be conversational, warm, and encouraging.
- Use **bold** for emphasis and bullet points for clarity.
- If you have the user's personal data, ALWAYS reference their specific numbers (e.g., "Your shoulder alignment score of 65 suggests...")
- Compare their current performance to their historical data when available.
- Provide specific, actionable advice tailored to their data.
- If they ask about exercises, recommend specific exercises with clear instructions.
- Keep responses focused and under 300 words unless they ask for detail.
- NEVER use emojis in your responses. Use clean, professional text only. No unicode emoji characters.
- If data shows concerning trends, express concern while being supportive.
- Never make up data. If you don't have data for something, say so.`;

  // Build conversation history for Gemini chat format
  const history = getHistory(userId);
  const chatHistory = history.slice(-6).map(entry => ({
    role: entry.role === "assistant" ? "model" : entry.role,
    parts: [{ text: entry.content }],
  }));

  // Start a chat session with history
  const chat = llm.startChat({
    history: [
      { role: "user", parts: [{ text: systemPrompt }] },
      { role: "model", parts: [{ text: "I understand. I'm ready to help as a posture AI coach. How can I assist you?" }] },
      ...chatHistory,
    ],
  });

  // Step 4: Generate response
  const result = await chat.sendMessage(message);
  const responseText = result.response.text();

  // Update history
  addToHistory(userId, "user", message);
  addToHistory(userId, "model", responseText);

  logger.info(`[ChatAgent] Response generated in ${Date.now() - startTime}ms (personalized=${personalized})`);

  return {
    response: responseText,
    personalized,
    timestamp: new Date().toISOString(),
  };
}

module.exports = { processMessage };
