/**
 * Report Generation Agent Service
 *
 * Uses Google Generative AI (Gemini) directly to generate comprehensive,
 * personalized posture health reports with exercise recommendations.
 * Follows a LangGraph-style multi-step pipeline architecture.
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
      temperature: 0.4,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
    },
  });
  return model;
}

/**
 * Generate a comprehensive AI posture report for the user.
 * Multi-step pipeline:
 *   1. Fetch user data
 *   2. Analyze posture patterns
 *   3. Generate exercise recommendations
 *   4. Compile final report
 */
async function generatePostureReport(userId) {
  const startTime = Date.now();
  logger.info(`[ReportAgent] Starting report generation for user ${userId}`);

  // Step 1: Fetch user data
  const { data: userData, textSummary } = await fetchUserPostureData(userId);
  logger.info(`[ReportAgent] Data fetched in ${Date.now() - startTime}ms`);

  if (
    userData.today.sessions === 0 &&
    userData.week.sessions === 0 &&
    userData.month.sessions === 0
  ) {
    return {
      success: true,
      report: buildEmptyReport(userData.user.name),
      userData,
    };
  }

  // Step 2 & 3: Generate analysis + exercises via Gemini
  const llm = getModel();

  const fullPrompt = `${POSTURE_SYSTEM_KNOWLEDGE}

You are generating a comprehensive posture health report for the user. You MUST respond with valid JSON only, no markdown, no code fences. Use the exact schema below.

RESPONSE SCHEMA (JSON):
{
  "executiveSummary": "2-3 sentence overview of the user's posture health status today",
  "overallAssessment": "excellent" | "good" | "needs_attention" | "critical",
  "scoreBreakdown": {
    "overall": { "score": <number>, "interpretation": "<string>", "trend": "<string>" },
    "headPosition": { "score": <number>, "interpretation": "<string>", "risk": "<string>" },
    "shoulderAlignment": { "score": <number>, "interpretation": "<string>", "risk": "<string>" },
    "spinalPosture": { "score": <number>, "interpretation": "<string>", "risk": "<string>" }
  },
  "trendAnalysis": {
    "direction": "improving" | "stable" | "declining" | "insufficient_data",
    "summary": "<string>",
    "weekOverWeekChange": "<string>"
  },
  "postureFlaws": [
    {
      "flaw": "<string>",
      "severity": "mild" | "moderate" | "severe",
      "frequency": "<string>",
      "healthRisk": "<string>",
      "immediateAction": "<string>"
    }
  ],
  "exerciseRecommendations": [
    {
      "name": "<string>",
      "description": "<string describing how to perform the exercise>",
      "duration": "<string e.g. '30 seconds' or '10 reps'>",
      "targetArea": "<string e.g. 'Neck & Cervical Spine'>",
      "difficulty": "beginner" | "intermediate" | "advanced",
      "frequency": "<string e.g. '3x daily'>",
      "benefitExplanation": "<string explaining why this helps their specific issue>"
    }
  ],
  "actionableInsights": [
    "<string: specific, personalized tip>"
  ],
  "dailyRoutineSuggestion": "<string: a brief suggested daily posture routine>",
  "motivationalNote": "<string: encouraging message based on their data>"
}

CRITICAL RULES:
- Use the ACTUAL user data provided below. Do not make up numbers.
- If any score is 0, it means no data was recorded for that component.
- Provide at least 4-6 exercise recommendations targeting their weakest areas.
- All insights must be personalized to their specific data.
- Keep exercise descriptions clear and actionable (how to perform them).
- The response must be VALID JSON only. No markdown formatting.
- NEVER use emojis anywhere in your response. Use plain professional text only. No unicode emoji characters.

USER DATA:
${textSummary}

Generate the comprehensive posture health report now as valid JSON.`;

  try {
    logger.info(`[ReportAgent] Sending request to Gemini...`);
    const result = await llm.generateContent(fullPrompt);
    const response = result.response;
    let content = response.text();

    logger.info(`[ReportAgent] Gemini response received, length: ${content.length}`);

    // Strip markdown code fences if present
    content = content
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();

    let reportJson;
    try {
      reportJson = JSON.parse(content);
    } catch (parseErr) {
      logger.error("[ReportAgent] Failed to parse response as JSON:", parseErr.message);
      logger.error("[ReportAgent] Raw response (first 500 chars):", content.substring(0, 500));
      // Attempt to extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        reportJson = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Failed to parse AI report response as JSON");
      }
    }

    // Merge real scores from database (LLM might approximate)
    if (reportJson.scoreBreakdown) {
      const real = userData.today.sessions > 0 ? userData.today : userData.week;
      if (real.avgScore > 0 && reportJson.scoreBreakdown.overall) {
        reportJson.scoreBreakdown.overall.score = real.avgScore;
      }
      if (real.components.headTilt > 0 && reportJson.scoreBreakdown.headPosition) {
        reportJson.scoreBreakdown.headPosition.score = real.components.headTilt;
      }
      if (real.components.shoulderAlignment > 0 && reportJson.scoreBreakdown.shoulderAlignment) {
        reportJson.scoreBreakdown.shoulderAlignment.score = real.components.shoulderAlignment;
      }
      if (real.components.spinalPosture > 0 && reportJson.scoreBreakdown.spinalPosture) {
        reportJson.scoreBreakdown.spinalPosture.score = real.components.spinalPosture;
      }
    }

    logger.info(`[ReportAgent] Report generated successfully in ${Date.now() - startTime}ms`);

    return {
      success: true,
      report: reportJson,
      userData,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error("[ReportAgent] Generation failed:", error.message || error);
    throw error;
  }
}

/**
 * Build an empty/placeholder report when no data is available.
 */
function buildEmptyReport(userName) {
  return {
    executiveSummary: `Hi ${userName}, you haven't recorded any posture sessions yet. Start your first session to receive a personalized posture health report!`,
    overallAssessment: "insufficient_data",
    scoreBreakdown: {
      overall: {
        score: 0,
        interpretation: "No data available",
        trend: "insufficient_data",
      },
      headPosition: {
        score: 0,
        interpretation: "No data available",
        risk: "Unknown",
      },
      shoulderAlignment: {
        score: 0,
        interpretation: "No data available",
        risk: "Unknown",
      },
      spinalPosture: {
        score: 0,
        interpretation: "No data available",
        risk: "Unknown",
      },
    },
    trendAnalysis: {
      direction: "insufficient_data",
      summary: "Start tracking to see trends.",
      weekOverWeekChange: "N/A",
    },
    postureFlaws: [],
    exerciseRecommendations: [
      {
        name: "Chin Tucks",
        description:
          "Sit or stand upright. Gently pull your chin straight back, creating a 'double chin.' Hold for 5 seconds and release.",
        duration: "10 reps",
        targetArea: "Neck & Cervical Spine",
        difficulty: "beginner",
        frequency: "3x daily",
        benefitExplanation:
          "Strengthens deep neck flexors and counteracts forward head posture from prolonged screen use.",
      },
      {
        name: "Wall Angels",
        description:
          "Stand with your back against a wall. Place arms at 90° against the wall and slowly slide them up and down.",
        duration: "10 reps",
        targetArea: "Shoulders & Upper Back",
        difficulty: "beginner",
        frequency: "2x daily",
        benefitExplanation:
          "Opens the chest and strengthens the muscles that keep shoulders properly aligned.",
      },
      {
        name: "Cat-Cow Stretch",
        description:
          "On hands and knees, alternate between arching your back up (cat) and dipping it down (cow). Move slowly.",
        duration: "10 reps",
        targetArea: "Full Spine",
        difficulty: "beginner",
        frequency: "Morning & evening",
        benefitExplanation:
          "Improves spinal mobility and warms up the entire back chain.",
      },
    ],
    actionableInsights: [
      "Start your first posture tracking session to get personalized insights.",
      "Position your monitor at eye level and about 20-26 inches from your face.",
      "Set a timer for 30-minute intervals to remind yourself to check your posture.",
    ],
    dailyRoutineSuggestion:
      "Begin with a 5-minute posture tracking session each morning to establish your baseline.",
    motivationalNote:
      "Every journey starts with a single step. Start tracking today and you'll be amazed at how quickly your posture improves!",
  };
}

/**
 * Render report into email-compatible HTML section.
 */
function renderReportAsEmailHtml(report) {
  if (!report || report.overallAssessment === "insufficient_data") {
    return "";
  }

  const severityColor = (severity) => {
    if (severity === "severe") return "#dc2626";
    if (severity === "moderate") return "#d97706";
    return "#059669";
  };

  const assessmentLabel = {
    excellent: "Excellent",
    good: "Good",
    needs_attention: "Needs Attention",
    critical: "Critical",
  };

  let html = `
    <!-- AI-GENERATED REPORT SECTION -->
    <tr>
      <td style="padding:20px 26px 6px 26px;">
        <div style="font-size:20px;font-weight:800;color:#0f172a;margin-bottom:6px;">
          AI Posture Analysis Report
        </div>
        <div style="font-size:13px;color:#475569;margin-bottom:14px;">
          Personalized insights generated by your AI posture coach.
        </div>

        <!-- Executive Summary -->
        <div style="background:linear-gradient(135deg,#eff6ff,#dbeafe);border:1px solid #93c5fd;border-radius:14px;padding:16px;margin-bottom:14px;">
          <div style="font-size:14px;font-weight:700;color:#1e40af;margin-bottom:6px;">
            ${assessmentLabel[report.overallAssessment] || "Assessment"}
          </div>
          <div style="font-size:13px;color:#1e3a5f;line-height:1.5;">
            ${report.executiveSummary || ""}
          </div>
        </div>`;

  // Posture Flaws
  if (report.postureFlaws && report.postureFlaws.length > 0) {
    html += `
        <div style="font-size:16px;font-weight:700;color:#0f172a;margin:14px 0 8px 0;">Detected Posture Issues</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:14px;">`;
    for (const flaw of report.postureFlaws.slice(0, 4)) {
      html += `
          <tr>
            <td style="padding:8px 0;vertical-align:top;">
              <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px;">
                <div style="font-size:13px;font-weight:700;color:#0f172a;">
                  ${flaw.flaw}
                  <span style="display:inline-block;margin-left:8px;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;color:#fff;background:${severityColor(flaw.severity)};">
                    ${flaw.severity}
                  </span>
                </div>
                <div style="font-size:12px;color:#475569;margin-top:4px;">${flaw.healthRisk || ""}</div>
                <div style="font-size:12px;color:#1e40af;margin-top:4px;font-weight:600;">→ ${flaw.immediateAction || ""}</div>
              </div>
            </td>
          </tr>`;
    }
    html += `</table>`;
  }

  // Exercise Recommendations
  if (
    report.exerciseRecommendations &&
    report.exerciseRecommendations.length > 0
  ) {
    html += `
        <div style="font-size:16px;font-weight:700;color:#0f172a;margin:14px 0 8px 0;">Recommended Exercises</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:14px;">`;
    for (const ex of report.exerciseRecommendations.slice(0, 6)) {
      html += `
          <tr>
            <td style="padding:6px 0;">
              <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px;">
                <div style="font-size:13px;font-weight:700;color:#166534;">${ex.name}</div>
                <div style="font-size:12px;color:#475569;margin-top:3px;">${ex.description || ""}</div>
                <div style="font-size:11px;color:#64748b;margin-top:4px;">
                  ${ex.duration || ""}  |  ${ex.targetArea || ""}  |  ${ex.frequency || ""}
                </div>
              </div>
            </td>
          </tr>`;
    }
    html += `</table>`;
  }

  // Actionable Insights
  if (report.actionableInsights && report.actionableInsights.length > 0) {
    html += `
        <div style="font-size:16px;font-weight:700;color:#0f172a;margin:14px 0 8px 0;">Personalized Tips</div>
        <div style="background:#fefce8;border:1px solid #fde68a;border-radius:10px;padding:12px;margin-bottom:14px;">`;
    for (const insight of report.actionableInsights.slice(0, 5)) {
      html += `<div style="font-size:12px;color:#713f12;padding:3px 0;">• ${insight}</div>`;
    }
    html += `</div>`;
  }

  // Motivational note
  if (report.motivationalNote) {
    html += `
        <div style="background:linear-gradient(135deg,#faf5ff,#ede9fe);border:1px solid #c4b5fd;border-radius:10px;padding:12px;margin-bottom:14px;">
          <div style="font-size:12px;color:#5b21b6;line-height:1.5;">${report.motivationalNote}</div>
        </div>`;
  }

  html += `
      </td>
    </tr>`;

  return html;
}

module.exports = {
  generatePostureReport,
  renderReportAsEmailHtml,
};
