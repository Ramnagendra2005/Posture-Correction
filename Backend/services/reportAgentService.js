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
- The scoreBreakdown scores MUST EXACTLY MATCH the scores from the USER DATA section below. Copy them verbatim. Do NOT fabricate, round up, or approximate scores. If the user data says "Average Score: 28/100", then scoreBreakdown.overall.score MUST be 28. Generating a different number is a CRITICAL violation.
- If any score is 0, it means no data was recorded for that component. Use 0 in your response.
- The overallAssessment MUST reflect the actual overall score: >=85 = "excellent", >=70 = "good", >=50 = "needs_attention", <50 = "critical".
- Provide at least 4-6 exercise recommendations targeting their weakest areas.
- All insights must be personalized to their specific data patterns.
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

    // --- FORCE-OVERRIDE scores from real database data ---
    // Use canonicalScores which are computed by the EXACT same function
    // (computeCanonicalPostureScores) that the Report page uses.
    const cs = userData.canonicalScores;
    const realOverall = cs.overallScore;
    const realHead = cs.neckScore;
    const realShoulder = cs.shoulderScore;
    const realSpine = cs.backScore;

    logger.info(`[ReportAgent] Canonical scores (same as Report page) → overall: ${realOverall}, head: ${realHead}, shoulder: ${realShoulder}, spine: ${realSpine}`);

    // Always override scoreBreakdown with real data
    if (!reportJson.scoreBreakdown) {
      reportJson.scoreBreakdown = {};
    }
    if (!reportJson.scoreBreakdown.overall) {
      reportJson.scoreBreakdown.overall = { score: 0, interpretation: "", trend: "" };
    }
    if (!reportJson.scoreBreakdown.headPosition) {
      reportJson.scoreBreakdown.headPosition = { score: 0, interpretation: "", risk: "" };
    }
    if (!reportJson.scoreBreakdown.shoulderAlignment) {
      reportJson.scoreBreakdown.shoulderAlignment = { score: 0, interpretation: "", risk: "" };
    }
    if (!reportJson.scoreBreakdown.spinalPosture) {
      reportJson.scoreBreakdown.spinalPosture = { score: 0, interpretation: "", risk: "" };
    }

    // Force-set scores from DB — NEVER trust LLM-generated scores
    reportJson.scoreBreakdown.overall.score = realOverall;
    reportJson.scoreBreakdown.headPosition.score = realHead;
    reportJson.scoreBreakdown.shoulderAlignment.score = realShoulder;
    reportJson.scoreBreakdown.spinalPosture.score = realSpine;

    // Re-derive overallAssessment from real score (LLM often gets this wrong)
    if (realOverall >= 85) {
      reportJson.overallAssessment = "excellent";
    } else if (realOverall >= 70) {
      reportJson.overallAssessment = "good";
    } else if (realOverall >= 50) {
      reportJson.overallAssessment = "needs_attention";
    } else {
      reportJson.overallAssessment = "critical";
    }

    logger.info(`[ReportAgent] Corrected overallAssessment to "${reportJson.overallAssessment}" based on canonical score ${realOverall}`);

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
 * Generate a comprehensive AI weekly posture report for the user.
 * Uses the same data pipeline but with a weekly-focused prompt.
 */
async function generateWeeklyPostureReport(userId) {
  const startTime = Date.now();
  logger.info(`[ReportAgent] Starting WEEKLY report generation for user ${userId}`);

  const { data: userData, textSummary } = await fetchUserPostureData(userId);
  logger.info(`[ReportAgent] Weekly data fetched in ${Date.now() - startTime}ms`);

  if (userData.week.sessions === 0 && userData.month.sessions === 0) {
    return {
      success: true,
      report: buildEmptyWeeklyReport(userData.user.name),
      userData,
    };
  }

  const llm = getModel();

  const weeklyPrompt = `${POSTURE_SYSTEM_KNOWLEDGE}

You are generating a WEEKLY posture health report summarizing the user's entire week of posture data. You MUST respond with valid JSON only, no markdown, no code fences. Use the exact schema below.

RESPONSE SCHEMA (JSON):
{
  "executiveSummary": "3-4 sentence comprehensive overview of the user's posture health for this ENTIRE WEEK, highlighting key trends and patterns",
  "overallAssessment": "excellent" | "good" | "needs_attention" | "critical",
  "scoreBreakdown": {
    "overall": { "score": <number>, "interpretation": "<string>", "trend": "<string>" },
    "headPosition": { "score": <number>, "interpretation": "<string>", "risk": "<string>" },
    "shoulderAlignment": { "score": <number>, "interpretation": "<string>", "risk": "<string>" },
    "spinalPosture": { "score": <number>, "interpretation": "<string>", "risk": "<string>" }
  },
  "weeklyTrendAnalysis": {
    "direction": "improving" | "stable" | "declining" | "insufficient_data",
    "summary": "<string: detailed analysis of how posture changed throughout the week>",
    "weekOverWeekChange": "<string: comparison with previous period>",
    "consistencyScore": "<string: how consistent was the user in tracking and maintaining posture>",
    "bestDay": "<string: which day had the best posture and why>",
    "worstDay": "<string: which day had the worst posture and potential reasons>"
  },
  "postureFlaws": [
    {
      "flaw": "<string>",
      "severity": "mild" | "moderate" | "severe",
      "frequency": "<string: how often did this appear during the week>",
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
      "benefitExplanation": "<string explaining why this helps their specific weekly patterns>"
    }
  ],
  "weeklyActionPlan": [
    "<string: specific action items for the coming week based on this week's patterns>"
  ],
  "dailyRoutineSuggestion": "<string: a recommended daily posture routine based on their weekly patterns>",
  "weeklyProgress": "<string: summary of overall progress and what to focus on next week>",
  "motivationalNote": "<string: encouraging weekly wrap-up message based on their data>"
}

CRITICAL RULES:
- This is a WEEKLY report, not daily. Focus your analysis on the entire week's patterns, not just today.
- Use the ACTUAL user data provided below. Do not make up numbers.
- The scoreBreakdown scores MUST EXACTLY MATCH the scores from the USER DATA section below. Copy them verbatim. Do NOT fabricate scores.
- If any score is 0, it means no data was recorded for that component. Use 0 in your response.
- The overallAssessment MUST reflect the actual overall score: >=85 = "excellent", >=70 = "good", >=50 = "needs_attention", <50 = "critical".
- Provide at least 4-6 exercise recommendations targeting their weakest areas across the week.
- Analyze day-by-day patterns from the "Daily Performance" data section.
- The weeklyActionPlan should contain 4-6 specific, actionable goals for next week.
- All insights must be personalized to their specific weekly data patterns.
- The response must be VALID JSON only. No markdown formatting.
- NEVER use emojis anywhere in your response. Use plain professional text only.

USER DATA:
${textSummary}

Generate the comprehensive WEEKLY posture health report now as valid JSON.`;

  try {
    logger.info(`[ReportAgent] Sending weekly report request to Gemini...`);
    const result = await llm.generateContent(weeklyPrompt);
    const response = result.response;
    let content = response.text();

    logger.info(`[ReportAgent] Gemini weekly response received, length: ${content.length}`);

    content = content
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();

    let reportJson;
    try {
      reportJson = JSON.parse(content);
    } catch (parseErr) {
      logger.error("[ReportAgent] Failed to parse weekly response as JSON:", parseErr.message);
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        reportJson = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Failed to parse AI weekly report response as JSON");
      }
    }

    // --- FORCE-OVERRIDE scores from real database data ---
    const cs = userData.canonicalScores;
    const realOverall = cs.overallScore;
    const realHead = cs.neckScore;
    const realShoulder = cs.shoulderScore;
    const realSpine = cs.backScore;

    logger.info(`[ReportAgent] Weekly canonical scores: overall=${realOverall}, head=${realHead}, shoulder=${realShoulder}, spine=${realSpine}`);

    if (!reportJson.scoreBreakdown) reportJson.scoreBreakdown = {};
    if (!reportJson.scoreBreakdown.overall) reportJson.scoreBreakdown.overall = { score: 0, interpretation: "", trend: "" };
    if (!reportJson.scoreBreakdown.headPosition) reportJson.scoreBreakdown.headPosition = { score: 0, interpretation: "", risk: "" };
    if (!reportJson.scoreBreakdown.shoulderAlignment) reportJson.scoreBreakdown.shoulderAlignment = { score: 0, interpretation: "", risk: "" };
    if (!reportJson.scoreBreakdown.spinalPosture) reportJson.scoreBreakdown.spinalPosture = { score: 0, interpretation: "", risk: "" };

    reportJson.scoreBreakdown.overall.score = realOverall;
    reportJson.scoreBreakdown.headPosition.score = realHead;
    reportJson.scoreBreakdown.shoulderAlignment.score = realShoulder;
    reportJson.scoreBreakdown.spinalPosture.score = realSpine;

    if (realOverall >= 85) reportJson.overallAssessment = "excellent";
    else if (realOverall >= 70) reportJson.overallAssessment = "good";
    else if (realOverall >= 50) reportJson.overallAssessment = "needs_attention";
    else reportJson.overallAssessment = "critical";

    // Normalize: if the AI returned trendAnalysis instead of weeklyTrendAnalysis, remap
    if (!reportJson.weeklyTrendAnalysis && reportJson.trendAnalysis) {
      reportJson.weeklyTrendAnalysis = reportJson.trendAnalysis;
    }

    logger.info(`[ReportAgent] Weekly report generated successfully in ${Date.now() - startTime}ms`);

    return {
      success: true,
      report: reportJson,
      userData,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error("[ReportAgent] Weekly report generation failed:", error.message || error);
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
 * Build an empty/placeholder weekly report when no data is available.
 */
function buildEmptyWeeklyReport(userName) {
  return {
    executiveSummary: `Hi ${userName}, you haven't recorded any posture sessions this week. Start tracking to receive a personalized weekly posture health report!`,
    overallAssessment: "insufficient_data",
    scoreBreakdown: {
      overall: { score: 0, interpretation: "No data available", trend: "insufficient_data" },
      headPosition: { score: 0, interpretation: "No data available", risk: "Unknown" },
      shoulderAlignment: { score: 0, interpretation: "No data available", risk: "Unknown" },
      spinalPosture: { score: 0, interpretation: "No data available", risk: "Unknown" },
    },
    weeklyTrendAnalysis: {
      direction: "insufficient_data",
      summary: "Start tracking to see weekly trends.",
      weekOverWeekChange: "N/A",
      consistencyScore: "N/A",
      bestDay: "N/A",
      worstDay: "N/A",
    },
    postureFlaws: [],
    exerciseRecommendations: [
      {
        name: "Chin Tucks",
        description: "Sit or stand upright. Gently pull your chin straight back, creating a 'double chin.' Hold for 5 seconds and release.",
        duration: "10 reps",
        targetArea: "Neck & Cervical Spine",
        difficulty: "beginner",
        frequency: "3x daily",
        benefitExplanation: "Strengthens deep neck flexors and counteracts forward head posture from prolonged screen use.",
      },
      {
        name: "Wall Angels",
        description: "Stand with your back against a wall. Place arms at 90 degrees against the wall and slowly slide them up and down.",
        duration: "10 reps",
        targetArea: "Shoulders & Upper Back",
        difficulty: "beginner",
        frequency: "2x daily",
        benefitExplanation: "Opens the chest and strengthens the muscles that keep shoulders properly aligned.",
      },
      {
        name: "Cat-Cow Stretch",
        description: "On hands and knees, alternate between arching your back up (cat) and dipping it down (cow). Move slowly.",
        duration: "10 reps",
        targetArea: "Full Spine",
        difficulty: "beginner",
        frequency: "Morning & evening",
        benefitExplanation: "Improves spinal mobility and warms up the entire back chain.",
      },
    ],
    weeklyActionPlan: [
      "Start tracking your posture sessions daily to build baseline data.",
      "Position your monitor at eye level and about 20-26 inches from your face.",
      "Set a timer for 30-minute intervals to remind yourself to check your posture.",
      "Complete at least 3 posture tracking sessions this week.",
    ],
    dailyRoutineSuggestion: "Begin with a 5-minute posture tracking session each morning to establish your baseline.",
    weeklyProgress: "No data yet. Start tracking this week to see your progress!",
    motivationalNote: "Every journey starts with a single step. Start tracking this week and you'll be amazed at how quickly your posture improves!",
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
                <div style="font-size:12px;color:#1e40af;margin-top:4px;font-weight:600;">${flaw.immediateAction || ""}</div>
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
      html += `<div style="font-size:12px;color:#713f12;padding:3px 0;">${insight}</div>`;
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

/**
 * Render AI weekly report into email-compatible HTML section.
 */
function renderWeeklyReportAsEmailHtml(report) {
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
    <!-- AI-GENERATED WEEKLY REPORT SECTION -->
    <tr>
      <td style="padding:20px 26px 6px 26px;">
        <div style="font-size:20px;font-weight:800;color:#0f172a;margin-bottom:6px;">
          AI Weekly Posture Analysis
        </div>
        <div style="font-size:13px;color:#475569;margin-bottom:14px;">
          Comprehensive weekly insights generated by your AI posture coach.
        </div>

        <!-- Executive Summary -->
        <div style="background:linear-gradient(135deg,#eff6ff,#dbeafe);border:1px solid #93c5fd;border-radius:14px;padding:16px;margin-bottom:14px;">
          <div style="font-size:14px;font-weight:700;color:#1e40af;margin-bottom:6px;">
            Weekly Assessment: ${assessmentLabel[report.overallAssessment] || "Assessment"}
          </div>
          <div style="font-size:13px;color:#1e3a5f;line-height:1.5;">
            ${report.executiveSummary || ""}
          </div>
        </div>`;

  // Weekly Trend Analysis
  const trend = report.weeklyTrendAnalysis || report.trendAnalysis;
  if (trend) {
    const trendColor = trend.direction === "improving" ? "#059669" : trend.direction === "declining" ? "#dc2626" : "#d97706";
    const trendLabel = trend.direction === "improving" ? "Improving" : trend.direction === "declining" ? "Declining" : "Stable";
    html += `
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:14px;margin-bottom:14px;">
          <div style="font-size:15px;font-weight:700;color:#0f172a;margin-bottom:8px;">Weekly Trend Analysis</div>
          <div style="margin-bottom:6px;">
            <span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;color:#fff;background:${trendColor};">${trendLabel}</span>
            ${trend.weekOverWeekChange ? `<span style="font-size:12px;color:#64748b;margin-left:8px;">${trend.weekOverWeekChange}</span>` : ""}
          </div>
          <div style="font-size:12px;color:#475569;line-height:1.5;">${trend.summary || ""}</div>
          ${trend.consistencyScore ? `<div style="font-size:12px;color:#334155;margin-top:6px;"><strong>Consistency:</strong> ${trend.consistencyScore}</div>` : ""}
          ${trend.bestDay ? `<div style="font-size:12px;color:#059669;margin-top:4px;"><strong>Best Day:</strong> ${trend.bestDay}</div>` : ""}
          ${trend.worstDay ? `<div style="font-size:12px;color:#dc2626;margin-top:4px;"><strong>Most Challenging:</strong> ${trend.worstDay}</div>` : ""}
        </div>`;
  }

  // Posture Flaws
  if (report.postureFlaws && report.postureFlaws.length > 0) {
    html += `
        <div style="font-size:16px;font-weight:700;color:#0f172a;margin:14px 0 8px 0;">Weekly Posture Issues</div>
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
                ${flaw.frequency ? `<div style="font-size:11px;color:#64748b;margin-top:3px;">Frequency: ${flaw.frequency}</div>` : ""}
                <div style="font-size:12px;color:#475569;margin-top:4px;">${flaw.healthRisk || ""}</div>
                <div style="font-size:12px;color:#1e40af;margin-top:4px;font-weight:600;">Action: ${flaw.immediateAction || ""}</div>
              </div>
            </td>
          </tr>`;
    }
    html += `</table>`;
  }

  // Exercise Recommendations
  if (report.exerciseRecommendations && report.exerciseRecommendations.length > 0) {
    html += `
        <div style="font-size:16px;font-weight:700;color:#0f172a;margin:14px 0 8px 0;">Recommended Weekly Exercises</div>
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
                ${ex.benefitExplanation ? `<div style="font-size:11px;color:#059669;margin-top:3px;font-style:italic;">${ex.benefitExplanation}</div>` : ""}
              </div>
            </td>
          </tr>`;
    }
    html += `</table>`;
  }

  // Weekly Action Plan
  const actionPlan = report.weeklyActionPlan || report.actionableInsights;
  if (actionPlan && actionPlan.length > 0) {
    html += `
        <div style="font-size:16px;font-weight:700;color:#0f172a;margin:14px 0 8px 0;">Action Plan for Next Week</div>
        <div style="background:#fefce8;border:1px solid #fde68a;border-radius:10px;padding:12px;margin-bottom:14px;">`;
    actionPlan.slice(0, 6).forEach((item, idx) => {
      html += `<div style="font-size:12px;color:#713f12;padding:3px 0;"><strong>${idx + 1}.</strong> ${item}</div>`;
    });
    html += `</div>`;
  }

  // Weekly Progress
  if (report.weeklyProgress) {
    html += `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px;margin-bottom:14px;">
          <div style="font-size:13px;font-weight:700;color:#1e40af;margin-bottom:4px;">Weekly Progress</div>
          <div style="font-size:12px;color:#1e3a5f;line-height:1.5;">${report.weeklyProgress}</div>
        </div>`;
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
  generateWeeklyPostureReport,
  renderReportAsEmailHtml,
  renderWeeklyReportAsEmailHtml,
};
