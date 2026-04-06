const { DailySummary, PostureSession, TrackedTime, User } = require("../models");
const logger = require("../utils/logger");

const clampScore = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
};

const normalizeMinutes = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n > 1000) return n / 60;
  return n;
};

const formatMinutes = (mins) => {
  const safe = Math.max(0, Math.round(mins || 0));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${h}h ${m}m`;
};

const formatDateLong = (date) =>
  date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

const formatDateShort = (date) =>
  date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const average = (values) => {
  const valid = values
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (!valid.length) return 0;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
};

const scoreColor = (score) => {
  if (score >= 85) return "#059669";
  if (score >= 70) return "#d97706";
  return "#dc2626";
};

const scoreLabel = (score) => {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 55) return "Needs Attention";
  return "Critical Focus";
};

const extractSessionScore = (session, key) => {
  const candidates = [session?.scores?.[key], session?.[key]];
  for (const candidate of candidates) {
    const n = Number(candidate);
    if (Number.isFinite(n)) return clampScore(n);
  }
  return 0;
};

const getSessionDurationMinutes = (session, now) => {
  const MAX_SESSION_MINUTES = 120;
  if (session?.startTime && session?.endTime) {
    const start = new Date(session.startTime).getTime();
    const end = new Date(session.endTime).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      return Math.min((end - start) / (1000 * 60), MAX_SESSION_MINUTES);
    }
  }
  const stored = normalizeMinutes(session?.duration || 0);
  if (stored > 0) return Math.min(stored, MAX_SESSION_MINUTES);
  if (session?.startTime && session?.status === "active") {
    const start = new Date(session.startTime).getTime();
    if (!Number.isFinite(start)) return 0;
    const elapsed = (now.getTime() - start) / (1000 * 60);
    if (elapsed < 0) return 0;
    return Math.min(elapsed, MAX_SESSION_MINUTES);
  }
  return 0;
};

const dedupeSessions = (sessions, now) => {
  const map = new Map();
  sessions.forEach((session) => {
    const key = session?.deviceInfo?.sessionId || String(session?._id);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, session);
      return;
    }
    const existingDuration = getSessionDurationMinutes(existing, now);
    const nextDuration = getSessionDurationMinutes(session, now);
    if (nextDuration > existingDuration) {
      map.set(key, session);
    }
  });
  return Array.from(map.values());
};

/* ====================================================================
 *  Core data collection — aggregates the last 7 days
 * ==================================================================== */
async function collectWeeklyEmailData(userId) {
  const now = new Date();
  const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  weekEnd.setDate(weekEnd.getDate() + 1); // end of today (exclusive)
  const weekStart = new Date(weekEnd);
  weekStart.setDate(weekStart.getDate() - 7);

  // Previous week for comparison
  const prevWeekStart = new Date(weekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);

  const [dailySummaries, prevDailySummaries, rawSessions, trackedTimeDocs] =
    await Promise.all([
      DailySummary.find({ userId, date: { $gte: weekStart, $lt: weekEnd } })
        .sort({ date: 1 })
        .lean(),
      DailySummary.find({
        userId,
        date: { $gte: prevWeekStart, $lt: weekStart },
      }).lean(),
      PostureSession.find({
        userId,
        startTime: { $gte: weekStart, $lt: weekEnd },
        status: { $in: ["completed", "active", "paused"] },
      })
        .sort({ startTime: 1 })
        .lean(),
      TrackedTime.find({ userId, date: { $gte: weekStart, $lt: weekEnd } })
        .lean(),
    ]);

  const sessions = dedupeSessions(rawSessions, now);

  // ---- Per-day breakdown ----
  const dayLabels = [];
  const dayData = [];
  for (let i = 0; i < 7; i++) {
    const dayStart = new Date(weekStart);
    dayStart.setDate(dayStart.getDate() + i);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const label = dayStart.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    dayLabels.push(label);

    const daySummary = dailySummaries.find((s) => {
      const sDate = new Date(s.date);
      return sDate >= dayStart && sDate < dayEnd;
    });

    const daySessions = sessions.filter((s) => {
      const st = new Date(s.startTime);
      return st >= dayStart && st < dayEnd;
    });

    const trackedDoc = trackedTimeDocs.find((t) => {
      const tDate = new Date(t.date);
      return tDate >= dayStart && tDate < dayEnd;
    });

    // Determine time tracked for the day
    const trackedMinutes = Math.max(
      0,
      Number(trackedDoc?.todaysTimeTrackedSeconds || 0) / 60
    );
    const sessionMinutes = daySessions.reduce(
      (sum, s) => sum + getSessionDurationMinutes(s, now),
      0
    );
    const summaryMinutes = normalizeMinutes(daySummary?.totalTimeTracked || 0);
    const totalMinutes = Math.min(
      1440,
      trackedMinutes > 0
        ? trackedMinutes
        : sessionMinutes > 0
        ? sessionMinutes
        : summaryMinutes
    );

    // Score
    const summaryScore = Number(daySummary?.averageScores?.overall || 0);
    const sessionScores = daySessions
      .map((s) => extractSessionScore(s, "overallScore"))
      .filter((v) => v > 0);
    const dayAvgScore = clampScore(
      summaryScore > 0 ? summaryScore : average(sessionScores)
    );

    // Sessions count
    const sessionsCount =
      daySessions.length > 0
        ? daySessions.length
        : Number(daySummary?.sessionsCount || 0);

    // Corrections
    const summaryCorr = Number(daySummary?.totalCorrections?.total || 0);
    const sessionCorr = daySessions.reduce(
      (sum, s) =>
        sum + Math.max(0, Number(s?.postureMetrics?.totalCorrections || 0)),
      0
    );
    const corrections = Math.max(summaryCorr, sessionCorr);

    // Component scores for this day
    const componentFromSummaryOrSessions = (summaryKey, sessionKey) => {
      const sv = Number(daySummary?.averageScores?.[summaryKey] || 0);
      if (Number.isFinite(sv) && sv > 0) return clampScore(sv);
      const avg = average(
        daySessions
          .map((s) => extractSessionScore(s, sessionKey))
          .filter((v) => v > 0)
      );
      return clampScore(avg);
    };

    dayData.push({
      label,
      date: new Date(dayStart),
      avgScore: dayAvgScore,
      timeTracked: totalMinutes,
      sessionsCount,
      corrections,
      headTilt: componentFromSummaryOrSessions("headTilt", "headTiltScore"),
      shoulderAlignment: componentFromSummaryOrSessions(
        "shoulderAlignment",
        "shoulderAlignmentScore"
      ),
      spinalPosture: componentFromSummaryOrSessions(
        "spinalPosture",
        "spinalPostureScore"
      ),
    });
  }

  // ---- Weekly aggregates ----
  const activeDays = dayData.filter((d) => d.sessionsCount > 0);
  const totalTimeTracked = dayData.reduce((sum, d) => sum + d.timeTracked, 0);
  const totalSessions = dayData.reduce((sum, d) => sum + d.sessionsCount, 0);
  const totalCorrections = dayData.reduce((sum, d) => sum + d.corrections, 0);
  const weeklyAvgScore = clampScore(
    average(activeDays.map((d) => d.avgScore))
  );
  const weeklyBestDay =
    activeDays.length > 0
      ? [...activeDays].sort((a, b) => b.avgScore - a.avgScore)[0]
      : null;
  const weeklyWorstDay =
    activeDays.length > 0
      ? [...activeDays].sort((a, b) => a.avgScore - b.avgScore)[0]
      : null;

  // Component averages across the week
  const weekHeadTilt = clampScore(
    average(activeDays.map((d) => d.headTilt).filter((v) => v > 0))
  );
  const weekShoulder = clampScore(
    average(
      activeDays.map((d) => d.shoulderAlignment).filter((v) => v > 0)
    )
  );
  const weekSpinal = clampScore(
    average(activeDays.map((d) => d.spinalPosture).filter((v) => v > 0))
  );

  // Previous week comparison
  const prevScores = prevDailySummaries
    .map((s) => Number(s?.averageScores?.overall || 0))
    .filter((v) => v > 0);
  const prevAvgScore = clampScore(average(prevScores));
  const prevTotalTime = prevDailySummaries.reduce(
    (sum, s) => sum + normalizeMinutes(s?.totalTimeTracked || 0),
    0
  );
  const prevTotalSessions = prevDailySummaries.reduce(
    (sum, s) => sum + Number(s?.sessionsCount || 0),
    0
  );
  const prevTotalCorrections = prevDailySummaries.reduce(
    (sum, s) => sum + Number(s?.totalCorrections?.total || 0),
    0
  );

  const scoreDiff = weeklyAvgScore - prevAvgScore;
  const trend =
    scoreDiff > 3 ? "improving" : scoreDiff < -3 ? "declining" : "stable";

  // Insights
  const insights = buildWeeklyInsights({
    weeklyAvgScore,
    totalSessions,
    totalTimeTracked,
    totalCorrections,
    activeDays: activeDays.length,
    weekHeadTilt,
    weekShoulder,
    weekSpinal,
    scoreDiff,
    trend,
    weeklyBestDay,
    weeklyWorstDay,
  });

  return {
    weekStart,
    weekEnd: new Date(weekEnd.getTime() - 1), // inclusive end
    overview: {
      averageScore: weeklyAvgScore,
      totalTimeTracked,
      totalSessions,
      totalCorrections,
      activeDays: activeDays.length,
      performanceLabel: scoreLabel(weeklyAvgScore),
    },
    components: {
      headTilt: weekHeadTilt,
      shoulderAlignment: weekShoulder,
      spinalPosture: weekSpinal,
    },
    dayData,
    comparison: {
      prevAvgScore,
      prevTotalTime,
      prevTotalSessions,
      prevTotalCorrections,
      scoreDiff,
      trend,
    },
    bestDay: weeklyBestDay,
    worstDay: weeklyWorstDay,
    insights,
  };
}

function buildWeeklyInsights(stats) {
  const insights = [];

  if (stats.totalSessions === 0) {
    insights.push(
      "No posture tracking sessions were recorded this week. Start tracking to see weekly insights."
    );
    return insights;
  }

  // Overall assessment
  if (stats.weeklyAvgScore >= 85) {
    insights.push(
      `Outstanding week! Your average posture score of ${stats.weeklyAvgScore}% is in the excellent range.`
    );
  } else if (stats.weeklyAvgScore >= 70) {
    insights.push(
      `Solid week with an average score of ${stats.weeklyAvgScore}%. Push towards 85% for the excellent range.`
    );
  } else {
    insights.push(
      `Your weekly average of ${stats.weeklyAvgScore}% indicates consistent posture issues that need attention.`
    );
  }

  // Trend comparison
  if (stats.trend === "improving") {
    insights.push(
      `Great progress! Your score improved by ${Math.abs(stats.scoreDiff)} points compared to last week.`
    );
  } else if (stats.trend === "declining") {
    insights.push(
      `Your score dropped by ${Math.abs(stats.scoreDiff)} points versus last week. Consider revisiting your posture habits.`
    );
  } else if (stats.scoreDiff !== 0) {
    insights.push(
      `Consistent performance — your week-over-week score change was minimal (${stats.scoreDiff > 0 ? "+" : ""}${stats.scoreDiff}).`
    );
  }

  // Active days
  if (stats.activeDays < 5) {
    insights.push(
      `You tracked posture on ${stats.activeDays} out of 7 days. Try to track at least 5 days next week for better outcomes.`
    );
  } else {
    insights.push(
      `Excellent consistency — you tracked posture on ${stats.activeDays} out of 7 days this week.`
    );
  }

  // Best/worst day
  if (stats.weeklyBestDay) {
    insights.push(
      `Your best day was ${stats.weeklyBestDay.label} with a score of ${stats.weeklyBestDay.avgScore}%.`
    );
  }

  // Weakest component
  const weakest = [
    { key: "Head Position", value: stats.weekHeadTilt },
    { key: "Shoulder Alignment", value: stats.weekShoulder },
    { key: "Spinal Posture", value: stats.weekSpinal },
  ]
    .filter((c) => c.value > 0)
    .sort((a, b) => a.value - b.value)[0];

  if (weakest) {
    insights.push(
      `Your biggest improvement area this week is ${weakest.key.toLowerCase()} (${weakest.value}%). Focus exercises on this area.`
    );
  }

  return insights;
}

/* ====================================================================
 *  HTML Renderer
 * ==================================================================== */
function renderProgressRow(label, value, color) {
  return `
    <tr>
      <td style="padding:8px 0 4px 0;font-size:13px;color:#334155;font-weight:600;">${escapeHtml(
        label
      )}</td>
      <td style="padding:8px 0 4px 12px;font-size:13px;color:#0f172a;font-weight:700;text-align:right;white-space:nowrap;">${value}%</td>
    </tr>
    <tr>
      <td colspan="2" style="padding:0 0 10px 0;">
        <div style="height:10px;background:#e2e8f0;border-radius:999px;overflow:hidden;">
          <div style="height:10px;width:${Math.max(0, Math.min(100, value))}%;background:${color};border-radius:999px;"></div>
        </div>
      </td>
    </tr>
  `;
}

function renderDayTrendRows(dayData) {
  return dayData
    .map((day) => {
      const barWidth = Math.max(0, Math.min(100, day.avgScore));
      const color = scoreColor(day.avgScore);
      return `
        <tr>
          <td style="padding:6px 0;font-size:12px;color:#334155;white-space:nowrap;width:120px;">${escapeHtml(
            day.label
          )}</td>
          <td style="padding:6px 8px;">
            <div style="height:8px;background:#e2e8f0;border-radius:999px;overflow:hidden;">
              <div style="height:8px;width:${barWidth}%;background:${color};border-radius:999px;"></div>
            </div>
          </td>
          <td style="padding:6px 0;font-size:12px;color:#0f172a;font-weight:700;text-align:right;white-space:nowrap;width:50px;">${
            day.avgScore > 0 ? day.avgScore + "%" : "—"
          }</td>
          <td style="padding:6px 0 6px 10px;font-size:12px;color:#64748b;text-align:right;white-space:nowrap;width:80px;">${
            day.sessionsCount
          } sess · ${formatMinutes(day.timeTracked)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderComparisonRow(label, current, previous, unit, higherIsBetter) {
  const diff = current - previous;
  const arrow =
    diff > 0 ? "&#9650;" : diff < 0 ? "&#9660;" : "&#8212;";
  const arrowColor =
    diff === 0
      ? "#64748b"
      : (diff > 0) === higherIsBetter
      ? "#059669"
      : "#dc2626";
  return `
    <tr>
      <td style="padding:8px 0;font-size:13px;color:#334155;">${escapeHtml(
        label
      )}</td>
      <td style="padding:8px 0;font-size:13px;color:#0f172a;font-weight:700;text-align:center;">${current}${unit}</td>
      <td style="padding:8px 0;font-size:13px;color:#64748b;text-align:center;">${previous}${unit}</td>
      <td style="padding:8px 0;font-size:13px;color:${arrowColor};font-weight:700;text-align:right;">${arrow} ${
    diff > 0 ? "+" : ""
  }${diff}${unit}</td>
    </tr>
  `;
}

function renderWeeklyEmailHtml({ user, data }) {
  const {
    weekStart,
    weekEnd,
    overview,
    components,
    dayData,
    comparison,
    bestDay,
    worstDay,
    insights,
  } = data;
  const displayName = user.firstName || user.username || "there";
  const dateRange = `${formatDateShort(weekStart)} — ${formatDateShort(
    weekEnd
  )}`;
  const scoreTone = scoreColor(overview.averageScore);

  const componentRows = [
    renderProgressRow("Head Position", components.headTilt, "#2563eb"),
    renderProgressRow(
      "Shoulder Alignment",
      components.shoulderAlignment,
      "#16a34a"
    ),
    renderProgressRow("Spinal Posture", components.spinalPosture, "#0ea5e9"),
  ].join("");

  const insightRows = insights
    .map(
      (insight) => `
        <tr>
          <td style="padding:0 0 8px 0;font-size:13px;line-height:1.45;color:#334155;">- ${escapeHtml(
            insight
          )}</td>
        </tr>
      `
    )
    .join("");

  const comparisonRows = [
    renderComparisonRow(
      "Avg. Score",
      overview.averageScore,
      comparison.prevAvgScore,
      "%",
      true
    ),
    renderComparisonRow(
      "Time Tracked",
      Math.round(overview.totalTimeTracked),
      Math.round(comparison.prevTotalTime),
      "m",
      true
    ),
    renderComparisonRow(
      "Sessions",
      overview.totalSessions,
      comparison.prevTotalSessions,
      "",
      true
    ),
    renderComparisonRow(
      "Corrections",
      overview.totalCorrections,
      comparison.prevTotalCorrections,
      "",
      false
    ),
  ].join("");

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Weekly Posture Report</title>
    </head>
    <body style="margin:0;padding:0;background:#edf2ff;font-family:Segoe UI, Arial, Helvetica, sans-serif;color:#0f172a;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#edf2ff;padding:28px 12px;">
        <tr>
          <td align="center">
            <table role="presentation" width="760" cellspacing="0" cellpadding="0" style="max-width:760px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #dbeafe;box-shadow:0 14px 40px rgba(30,64,175,0.16);">
              <tr>
                <td style="padding:28px;background:linear-gradient(135deg,#1e3a8a 0%,#2563eb 60%,#38bdf8 100%);color:#ffffff;">
                  <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9;margin-bottom:8px;">Weekly Report</div>
                  <div style="font-size:30px;font-weight:800;line-height:1.2;margin-bottom:8px;">Your Weekly Performance Summary</div>
                  <div style="font-size:14px;line-height:1.6;opacity:0.95;">
                    Hi ${escapeHtml(
                      displayName
                    )}, here's your comprehensive posture report for the week of <strong>${escapeHtml(
    dateRange
  )}</strong>.
                  </div>
                </td>
              </tr>

              <!-- Overview Cards -->
              <tr>
                <td style="padding:24px 26px 10px 26px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                    <tr>
                      <td width="50%" valign="top" style="padding:0 10px 12px 0;">
                        <div style="background:#f8fbff;border:1px solid #dbeafe;border-radius:14px;padding:16px;">
                          <div style="font-size:12px;color:#475569;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">Weekly Average Score</div>
                          <div style="font-size:40px;font-weight:800;color:${scoreTone};line-height:1;">${
    overview.averageScore
  }%</div>
                          <div style="margin-top:6px;font-size:13px;color:#334155;">${
                            overview.performanceLabel
                          }</div>
                        </div>
                      </td>
                      <td width="50%" valign="top" style="padding:0 0 12px 10px;">
                        <div style="background:#f8fbff;border:1px solid #dbeafe;border-radius:14px;padding:16px;">
                          <div style="font-size:12px;color:#475569;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">Weekly Core Metrics</div>
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                            <tr><td style="font-size:13px;color:#64748b;padding:4px 0;">Time Tracked</td><td style="font-size:14px;color:#0f172a;font-weight:700;padding:4px 0;text-align:right;">${formatMinutes(
                              overview.totalTimeTracked
                            )}</td></tr>
                            <tr><td style="font-size:13px;color:#64748b;padding:4px 0;">Sessions</td><td style="font-size:14px;color:#0f172a;font-weight:700;padding:4px 0;text-align:right;">${
                              overview.totalSessions
                            }</td></tr>
                            <tr><td style="font-size:13px;color:#64748b;padding:4px 0;">Corrections</td><td style="font-size:14px;color:#0f172a;font-weight:700;padding:4px 0;text-align:right;">${
                              overview.totalCorrections
                            }</td></tr>
                            <tr><td style="font-size:13px;color:#64748b;padding:4px 0;">Active Days</td><td style="font-size:14px;color:#0f172a;font-weight:700;padding:4px 0;text-align:right;">${
                              overview.activeDays
                            } / 7</td></tr>
                          </table>
                        </div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Daily Trend Graph -->
              <tr>
                <td style="padding:8px 26px 4px 26px;">
                  <div style="font-size:18px;font-weight:800;color:#0f172a;margin-bottom:10px;">Day-by-Day Performance</div>
                  <div style="font-size:13px;color:#475569;margin-bottom:10px;">Your average posture score and activity for each day of the week.</div>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fbff;border:1px solid #dbeafe;border-radius:14px;padding:14px;">
                    ${renderDayTrendRows(dayData)}
                  </table>
                </td>
              </tr>

              <!-- Component Scores -->
              <tr>
                <td style="padding:12px 26px 4px 26px;">
                  <div style="font-size:18px;font-weight:800;color:#0f172a;margin-bottom:10px;">Weekly Component Averages</div>
                  <div style="font-size:13px;color:#475569;margin-bottom:10px;">Average breakdown of each posture component across the week.</div>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fbff;border:1px solid #dbeafe;border-radius:14px;padding:14px;">
                    ${componentRows}
                  </table>
                </td>
              </tr>

              <!-- Week-over-Week Comparison -->
              <tr>
                <td style="padding:12px 26px 4px 26px;">
                  <div style="font-size:18px;font-weight:800;color:#0f172a;margin-bottom:10px;">Week-over-Week Comparison</div>
                  <div style="font-size:13px;color:#475569;margin-bottom:10px;">How this week compares to the previous week.</div>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fbff;border:1px solid #dbeafe;border-radius:14px;padding:14px;border-collapse:collapse;">
                    <tr style="border-bottom:2px solid #dbeafe;">
                      <th align="left" style="padding:8px 0;font-size:12px;color:#1e3a8a;text-transform:uppercase;letter-spacing:0.05em;">Metric</th>
                      <th style="padding:8px 0;font-size:12px;color:#1e3a8a;text-transform:uppercase;letter-spacing:0.05em;text-align:center;">This Week</th>
                      <th style="padding:8px 0;font-size:12px;color:#1e3a8a;text-transform:uppercase;letter-spacing:0.05em;text-align:center;">Last Week</th>
                      <th align="right" style="padding:8px 0;font-size:12px;color:#1e3a8a;text-transform:uppercase;letter-spacing:0.05em;">Change</th>
                    </tr>
                    ${comparisonRows}
                  </table>
                </td>
              </tr>

              ${
                bestDay
                  ? `
              <!-- Best & Worst Day -->
              <tr>
                <td style="padding:12px 26px 4px 26px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                    <tr>
                      <td width="50%" valign="top" style="padding:0 6px 0 0;">
                        <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:14px;">
                          <div style="font-size:12px;color:#059669;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;">Best Day</div>
                          <div style="font-size:16px;font-weight:700;color:#065f46;">${escapeHtml(
                            bestDay.label
                          )}</div>
                          <div style="font-size:24px;font-weight:800;color:#059669;">${
                            bestDay.avgScore
                          }%</div>
                        </div>
                      </td>
                      ${
                        worstDay
                          ? `
                      <td width="50%" valign="top" style="padding:0 0 0 6px;">
                        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:14px;">
                          <div style="font-size:12px;color:#dc2626;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;">Most Challenging Day</div>
                          <div style="font-size:16px;font-weight:700;color:#991b1b;">${escapeHtml(
                            worstDay.label
                          )}</div>
                          <div style="font-size:24px;font-weight:800;color:#dc2626;">${
                            worstDay.avgScore
                          }%</div>
                        </div>
                      </td>
                      `
                          : ""
                      }
                    </tr>
                  </table>
                </td>
              </tr>
              `
                  : ""
              }

              <!-- Insights -->
              <tr>
                <td style="padding:14px 26px 6px 26px;">
                  <div style="font-size:18px;font-weight:800;color:#0f172a;margin-bottom:10px;">Weekly Insights</div>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fbff;border:1px solid #dbeafe;border-radius:14px;padding:14px;">
                    ${insightRows}
                  </table>
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="padding:16px 26px 22px 26px;">
                  <div style="font-size:12px;line-height:1.6;color:#64748b;">
                    Generated on ${escapeHtml(
                      formatDateShort(new Date())
                    )}. This weekly report covers ${escapeHtml(dateRange)}.
                    Keep your monitor at eye level, shoulders relaxed, and take micro-breaks every 30 minutes.
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>`;
}

/* ====================================================================
 *  Plain-text Renderer
 * ==================================================================== */
function renderWeeklyEmailText({ user, data }) {
  const name = user.firstName || user.username || "there";
  const {
    weekStart,
    weekEnd,
    overview,
    components,
    dayData,
    comparison,
    bestDay,
    worstDay,
    insights,
  } = data;
  const dateRange = `${formatDateShort(weekStart)} — ${formatDateShort(
    weekEnd
  )}`;

  const dayLines = dayData
    .map(
      (d) =>
        `  - ${d.label}: ${
          d.avgScore > 0 ? d.avgScore + "%" : "—"
        } (${d.sessionsCount} sessions, ${formatMinutes(d.timeTracked)})`
    )
    .join("\n");

  return [
    `Weekly Posture Report for ${name}`,
    `Period: ${dateRange}`,
    "",
    `Average Score: ${overview.averageScore}% (${overview.performanceLabel})`,
    `Total Time Tracked: ${formatMinutes(overview.totalTimeTracked)}`,
    `Total Sessions: ${overview.totalSessions}`,
    `Total Corrections: ${overview.totalCorrections}`,
    `Active Days: ${overview.activeDays} / 7`,
    "",
    "Component Averages:",
    `  - Head Position: ${components.headTilt}%`,
    `  - Shoulder Alignment: ${components.shoulderAlignment}%`,
    `  - Spinal Posture: ${components.spinalPosture}%`,
    "",
    "Day-by-Day Trend:",
    dayLines,
    "",
    "Week-over-Week Comparison:",
    `  - Score: ${overview.averageScore}% vs ${comparison.prevAvgScore}% (${
      comparison.scoreDiff > 0 ? "+" : ""
    }${comparison.scoreDiff})`,
    `  - Time: ${formatMinutes(overview.totalTimeTracked)} vs ${formatMinutes(
      comparison.prevTotalTime
    )}`,
    `  - Sessions: ${overview.totalSessions} vs ${comparison.prevTotalSessions}`,
    `  - Corrections: ${overview.totalCorrections} vs ${comparison.prevTotalCorrections}`,
    "",
    bestDay ? `Best Day: ${bestDay.label} (${bestDay.avgScore}%)` : "",
    worstDay
      ? `Most Challenging Day: ${worstDay.label} (${worstDay.avgScore}%)`
      : "",
    "",
    "Insights:",
    ...insights.map((line) => `  - ${line}`),
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

/* ====================================================================
 *  Public entry-point
 * ==================================================================== */
async function buildWeeklyEmail(userId) {
  const user = await User.findById(userId).lean();
  if (!user) throw new Error("User not found");
  if (!user.email) throw new Error("User email is not configured");

  const data = await collectWeeklyEmailData(userId);

  const html = renderWeeklyEmailHtml({ user, data });
  const text = renderWeeklyEmailText({ user, data });
  const dateRange = `${formatDateShort(data.weekStart)} — ${formatDateShort(
    data.weekEnd
  )}`;
  const subject = `Weekly Posture Report — ${dateRange} | ${data.overview.averageScore}%`;

  logger.info(`Weekly email built for ${user.email}`, {
    activeDays: data.overview.activeDays,
    totalSessions: data.overview.totalSessions,
    timeTrackedMinutes: data.overview.totalTimeTracked,
    averageScore: data.overview.averageScore,
  });

  return { to: user.email, subject, html, text };
}

module.exports = { buildWeeklyEmail };
