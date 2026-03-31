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
  // Legacy safety: values above 1000 were often stored as seconds.
  if (n > 1000) return n / 60;
  return n;
};

const formatMinutes = (mins) => {
  const safe = Math.max(0, Math.min(1440, Math.round(mins || 0)));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${h}h ${m}m`;
};

const formatHour = (hour) => `${String(hour).padStart(2, "0")}:00`;

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
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const average = (values) => {
  const valid = values
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
  if (!valid.length) return 0;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
};

const extractSessionScore = (session, key) => {
  const candidates = [session?.scores?.[key], session?.[key]];
  for (const candidate of candidates) {
    const n = Number(candidate);
    if (Number.isFinite(n)) return clampScore(n);
  }
  return 0;
};

const getSessionReferenceTime = (session) => {
  const candidate =
    session?.lastUpdate ||
    session?.endTime ||
    session?.startTime ||
    session?.createdAt;
  const parsed = new Date(candidate);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
};

const getSessionDurationMinutes = (session, now) => {
  // Cap any individual session at 120 minutes to prevent runaway values.
  const MAX_SESSION_MINUTES = 120;

  // 1) If we have both startTime and endTime, use that as the most reliable source.
  if (session?.startTime && session?.endTime) {
    const start = new Date(session.startTime).getTime();
    const end = new Date(session.endTime).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      return Math.min((end - start) / (1000 * 60), MAX_SESSION_MINUTES);
    }
  }

  // 2) Use the stored duration field, but normalize and cap it.
  const stored = normalizeMinutes(session?.duration || 0);
  if (stored > 0) return Math.min(stored, MAX_SESSION_MINUTES);

  // 3) For active sessions with only a startTime, compute elapsed but cap it.
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

    const existingRef = getSessionReferenceTime(existing)?.getTime() || 0;
    const nextRef = getSessionReferenceTime(session)?.getTime() || 0;
    if (nextRef > existingRef) {
      map.set(key, session);
      return;
    }

    const existingDuration = getSessionDurationMinutes(existing, now);
    const nextDuration = getSessionDurationMinutes(session, now);
    if (nextDuration > existingDuration) {
      map.set(key, session);
    }
  });

  return Array.from(map.values()).sort(
    (a, b) =>
      (getSessionReferenceTime(a)?.getTime() || 0) -
      (getSessionReferenceTime(b)?.getTime() || 0)
  );
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

const statusBadge = (status) => {
  const normalized = String(status || "completed").toLowerCase();
  if (normalized === "active") return "Active";
  if (normalized === "paused") return "Paused";
  return "Completed";
};

const buildInsights = ({ overview, components, sessions }) => {
  if (!sessions.length) {
    return [
      "No complete session data was captured today, so this report is based on available tracked time records.",
      "Start at least one focused posture session to unlock richer trend insights in tomorrow's report.",
    ];
  }

  const insights = [];
  if (overview.averageScore >= 85) {
    insights.push("Posture quality stayed in the excellent range for today.");
  } else if (overview.averageScore >= 70) {
    insights.push("Posture quality was solid today, with room to push into the excellent range.");
  } else {
    insights.push("Posture quality stayed below target today and needs focused correction work.");
  }

  const weakest = [
    { key: "Head Position", value: components.headTilt },
    { key: "Shoulder Alignment", value: components.shoulderAlignment },
    { key: "Spinal Posture", value: components.spinalPosture },
  ].sort((a, b) => a.value - b.value)[0];

  insights.push(
    `Your biggest improvement opportunity today is ${weakest.key.toLowerCase()} (${weakest.value}%).`
  );

  if (overview.totalCorrections > 0) {
    insights.push(
      `You triggered ${overview.totalCorrections} posture corrections today. Reducing this count over time is a key quality signal.`
    );
  } else {
    insights.push("No corrections were recorded today, which indicates stable posture capture during tracked sessions.");
  }

  return insights;
};

async function collectDailyEmailData(userId, date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const now = new Date();

  const [summary, trackedTimeDoc, rawSessions] = await Promise.all([
    DailySummary.findOne({ userId, date: { $gte: start, $lt: end } }).lean(),
    TrackedTime.findOne({ userId, date: { $gte: start, $lt: end } }).lean(),
    PostureSession.find({
      userId,
      startTime: { $gte: start, $lt: end },
      status: { $in: ["completed", "active", "paused"] },
    })
      .sort({ startTime: 1 })
      .lean(),
  ]);

  const dedupedSessions = dedupeSessions(rawSessions, now);

  const sessions = dedupedSessions
    .map((session) => {
      const referenceTime = getSessionReferenceTime(session);
      const durationMinutes = Math.max(0, getSessionDurationMinutes(session, now));
      const overallScore = extractSessionScore(session, "overallScore");
      const corrections = Math.max(
        0,
        Number(session?.postureMetrics?.totalCorrections || 0)
      );

      const hasSignal =
        durationMinutes > 0.1 ||
        corrections > 0 ||
        overallScore > 0 ||
        Boolean(session?.endTime) ||
        session?.status === "active" ||
        session?.status === "completed";

      return {
        id: String(session?._id || ""),
        status: statusBadge(session?.status),
        startTime: session?.startTime ? new Date(session.startTime) : null,
        endTime: session?.endTime ? new Date(session.endTime) : null,
        referenceTime,
        durationMinutes,
        overallScore,
        headTiltScore: extractSessionScore(session, "headTiltScore"),
        shoulderAlignmentScore: extractSessionScore(session, "shoulderAlignmentScore"),
        spinalPostureScore: extractSessionScore(session, "spinalPostureScore"),
        corrections,
        hasSignal,
      };
    })
    .filter((session) => session.hasSignal);

  const sessionMinutes = sessions.reduce((sum, session) => sum + session.durationMinutes, 0);
  const trackedMinutes = Math.max(
    0,
    Number(trackedTimeDoc?.todaysTimeTrackedSeconds || 0) / 60
  );
  const summaryMinutes = normalizeMinutes(summary?.totalTimeTracked || 0);
  const totalTimeTracked = Math.min(
    1440,
    trackedMinutes > 0 ? trackedMinutes : sessionMinutes > 0 ? sessionMinutes : summaryMinutes
  );

  const summaryCorrections = Math.max(0, Number(summary?.totalCorrections?.total || 0));
  const sessionCorrections = sessions.reduce((sum, s) => sum + s.corrections, 0);
  const totalCorrections = Math.max(summaryCorrections, sessionCorrections);

  const summarySessionsCount = Math.max(0, Number(summary?.sessionsCount || 0));
  const sessionsCount = sessions.length > 0 ? sessions.length : summarySessionsCount;

  const summaryAverage = Number(summary?.averageScores?.overall || 0);
  const sessionAverage = average(
    sessions.map((s) => s.overallScore).filter((score) => score > 0)
  );
  const averageScore = clampScore(summaryAverage > 0 ? summaryAverage : sessionAverage);

  const summaryBest = Number(summary?.qualityMetrics?.bestSessionScore || 0);
  const sessionBest = sessions.length
    ? Math.max(...sessions.map((s) => s.overallScore))
    : 0;
  const bestSessionScore = clampScore(Math.max(summaryBest, sessionBest));

  const componentFromSummaryOrSessions = (summaryKey, sessionKey) => {
    const summaryValue = Number(summary?.averageScores?.[summaryKey] || 0);
    if (Number.isFinite(summaryValue) && summaryValue > 0) {
      return clampScore(summaryValue);
    }
    const avg = average(
      sessions.map((s) => Number(s?.[sessionKey] || 0)).filter((v) => v > 0)
    );
    return clampScore(avg);
  };

  const components = {
    headTilt: componentFromSummaryOrSessions("headTilt", "headTiltScore"),
    shoulderAlignment: componentFromSummaryOrSessions(
      "shoulderAlignment",
      "shoulderAlignmentScore"
    ),
    spinalPosture: componentFromSummaryOrSessions("spinalPosture", "spinalPostureScore"),
  };

  const hourlyBuckets = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    scoreSum: 0,
    scoreCount: 0,
    sessions: 0,
    minutes: 0,
  }));

  sessions.forEach((session) => {
    const reference = session.referenceTime || session.startTime;
    if (!reference) return;
    const hour = new Date(reference).getHours();
    const bucket = hourlyBuckets[hour];
    if (!bucket) return;

    bucket.sessions += 1;
    bucket.minutes += session.durationMinutes;
    if (session.overallScore > 0) {
      bucket.scoreSum += session.overallScore;
      bucket.scoreCount += 1;
    }
  });

  const activeHourly = hourlyBuckets
    .filter((bucket) => bucket.sessions > 0)
    .map((bucket) => ({
      hour: bucket.hour,
      label: formatHour(bucket.hour),
      sessions: bucket.sessions,
      minutes: Math.round(bucket.minutes),
      score: bucket.scoreCount > 0 ? clampScore(bucket.scoreSum / bucket.scoreCount) : 0,
    }));

  const insights = buildInsights({
    overview: {
      averageScore,
      totalCorrections,
      sessionsCount,
    },
    components,
    sessions,
  });

  return {
    date: start,
    overview: {
      averageScore,
      totalTimeTracked,
      sessionsCount,
      totalCorrections,
      bestSessionScore,
      performanceLabel: scoreLabel(averageScore),
    },
    components,
    activeHourly,
    sessions,
    insights,
  };
}

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

function renderHourlyRows(activeHourly) {
  if (!activeHourly.length) {
    return `
      <tr>
        <td style="padding:12px 0;color:#64748b;font-size:13px;">
          No hourly posture snapshots were captured today.
        </td>
      </tr>
    `;
  }

  return activeHourly
    .slice(0, 12)
    .map(
      (slot) => `
        <tr>
          <td style="padding:8px 0;font-size:12px;color:#334155;white-space:nowrap;">${slot.label}</td>
          <td style="padding:8px 12px;">
            <div style="height:8px;background:#e2e8f0;border-radius:999px;overflow:hidden;">
              <div style="height:8px;width:${slot.score}%;background:#3b82f6;border-radius:999px;"></div>
            </div>
          </td>
          <td style="padding:8px 0;font-size:12px;color:#0f172a;font-weight:700;text-align:right;white-space:nowrap;">${slot.score}%</td>
          <td style="padding:8px 0 8px 12px;font-size:12px;color:#64748b;text-align:right;white-space:nowrap;">${slot.sessions} sessions</td>
        </tr>
      `
    )
    .join("");
}

function renderSessionRows(sessions) {
  if (!sessions.length) {
    return `
      <tr>
        <td colspan="5" style="padding:14px 12px;border:1px solid #e2e8f0;border-radius:8px;color:#64748b;font-size:13px;text-align:center;">
          No completed posture sessions were found for today.
        </td>
      </tr>
    `;
  }

  return sessions
    .slice()
    .sort((a, b) => (b.referenceTime?.getTime() || 0) - (a.referenceTime?.getTime() || 0))
    .slice(0, 8)
    .map((session) => {
      const start = session.startTime
        ? session.startTime.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "--:--";

      const end = session.endTime
        ? session.endTime.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : session.status === "Active"
        ? "Now"
        : "--:--";

      return `
        <tr>
          <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#334155;">${start} - ${end}</td>
          <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#334155;text-align:right;">${formatMinutes(
            session.durationMinutes
          )}</td>
          <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;color:${scoreColor(
            session.overallScore
          )};font-weight:700;text-align:right;">${session.overallScore}%</td>
          <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#334155;text-align:right;">${session.corrections}</td>
          <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#334155;text-align:right;">${escapeHtml(
            session.status
          )}</td>
        </tr>
      `;
    })
    .join("");
}

function renderEmailHtml({ user, data }) {
  const { date, overview, components, activeHourly, sessions, insights } = data;
  const displayName = user.firstName || user.username || "there";
  const dateLabel = formatDateLong(date);
  const scoreTone = scoreColor(overview.averageScore);

  const componentRows = [
    renderProgressRow("Head Position", components.headTilt, "#2563eb"),
    renderProgressRow("Shoulder Alignment", components.shoulderAlignment, "#16a34a"),
    renderProgressRow("Spinal Posture", components.spinalPosture, "#0ea5e9"),
  ].join("");

  const insightRows = insights
    .map(
      (insight) => `
        <tr>
          <td style="padding:0 0 8px 0;font-size:13px;line-height:1.45;color:#334155;">- ${escapeHtml(insight)}</td>
        </tr>
      `
    )
    .join("");

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Daily Posture Report</title>
    </head>
    <body style="margin:0;padding:0;background:#edf2ff;font-family:Segoe UI, Arial, Helvetica, sans-serif;color:#0f172a;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#edf2ff;padding:28px 12px;">
        <tr>
          <td align="center">
            <table role="presentation" width="760" cellspacing="0" cellpadding="0" style="max-width:760px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #dbeafe;box-shadow:0 14px 40px rgba(30,64,175,0.16);">
              <tr>
                <td style="padding:28px;background:linear-gradient(135deg,#1e3a8a 0%,#2563eb 60%,#38bdf8 100%);color:#ffffff;">
                  <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9;margin-bottom:8px;">Posture Report</div>
                  <div style="font-size:30px;font-weight:800;line-height:1.2;margin-bottom:8px;">Your Daily Performance Snapshot</div>
                  <div style="font-size:14px;line-height:1.6;opacity:0.95;">
                    Hi ${escapeHtml(displayName)}, this is your accurate report for <strong>${escapeHtml(
    dateLabel
  )}</strong>. Every value below is generated from today's captured posture data.
                  </div>
                </td>
              </tr>

              <tr>
                <td style="padding:24px 26px 10px 26px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                    <tr>
                      <td width="50%" valign="top" style="padding:0 10px 12px 0;">
                        <div style="background:#f8fbff;border:1px solid #dbeafe;border-radius:14px;padding:16px;">
                          <div style="font-size:12px;color:#475569;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">Average Score</div>
                          <div style="font-size:40px;font-weight:800;color:${scoreTone};line-height:1;">${overview.averageScore}%</div>
                          <div style="margin-top:6px;font-size:13px;color:#334155;">${overview.performanceLabel}</div>
                        </div>
                      </td>
                      <td width="50%" valign="top" style="padding:0 0 12px 10px;">
                        <div style="background:#f8fbff;border:1px solid #dbeafe;border-radius:14px;padding:16px;">
                          <div style="font-size:12px;color:#475569;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">Today's Core Metrics</div>
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                            <tr><td style="font-size:13px;color:#64748b;padding:4px 0;">Time Tracked</td><td style="font-size:14px;color:#0f172a;font-weight:700;padding:4px 0;text-align:right;">${formatMinutes(
                              overview.totalTimeTracked
                            )}</td></tr>
                            <tr><td style="font-size:13px;color:#64748b;padding:4px 0;">Sessions</td><td style="font-size:14px;color:#0f172a;font-weight:700;padding:4px 0;text-align:right;">${overview.sessionsCount}</td></tr>
                            <tr><td style="font-size:13px;color:#64748b;padding:4px 0;">Corrections</td><td style="font-size:14px;color:#0f172a;font-weight:700;padding:4px 0;text-align:right;">${overview.totalCorrections}</td></tr>
                            <tr><td style="font-size:13px;color:#64748b;padding:4px 0;">Best Session</td><td style="font-size:14px;color:#0f172a;font-weight:700;padding:4px 0;text-align:right;">${overview.bestSessionScore}%</td></tr>
                          </table>
                        </div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <tr>
                <td style="padding:8px 26px 4px 26px;">
                  <div style="font-size:18px;font-weight:800;color:#0f172a;margin-bottom:10px;">Component Score Graph</div>
                  <div style="font-size:13px;color:#475569;margin-bottom:10px;">A detailed breakdown of today's posture components.</div>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fbff;border:1px solid #dbeafe;border-radius:14px;padding:14px;">
                    ${componentRows}
                  </table>
                </td>
              </tr>

              <tr>
                <td style="padding:12px 26px 4px 26px;">
                  <div style="font-size:18px;font-weight:800;color:#0f172a;margin-bottom:10px;">Hourly Trend Graph (Today)</div>
                  <div style="font-size:13px;color:#475569;margin-bottom:10px;">Each bar represents average posture score by hour based on recorded sessions.</div>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fbff;border:1px solid #dbeafe;border-radius:14px;padding:12px;">
                    ${renderHourlyRows(activeHourly)}
                  </table>
                </td>
              </tr>

              <tr>
                <td style="padding:12px 26px 4px 26px;">
                  <div style="font-size:18px;font-weight:800;color:#0f172a;margin-bottom:10px;">Session Performance Table</div>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#ffffff;border:1px solid #dbeafe;border-radius:14px;overflow:hidden;">
                    <tr style="background:#eff6ff;">
                      <th align="left" style="padding:10px 8px;font-size:12px;color:#1e3a8a;text-transform:uppercase;letter-spacing:0.05em;">Time</th>
                      <th align="right" style="padding:10px 8px;font-size:12px;color:#1e3a8a;text-transform:uppercase;letter-spacing:0.05em;">Duration</th>
                      <th align="right" style="padding:10px 8px;font-size:12px;color:#1e3a8a;text-transform:uppercase;letter-spacing:0.05em;">Score</th>
                      <th align="right" style="padding:10px 8px;font-size:12px;color:#1e3a8a;text-transform:uppercase;letter-spacing:0.05em;">Corrections</th>
                      <th align="right" style="padding:10px 8px;font-size:12px;color:#1e3a8a;text-transform:uppercase;letter-spacing:0.05em;">Status</th>
                    </tr>
                    ${renderSessionRows(sessions)}
                  </table>
                </td>
              </tr>

              <tr>
                <td style="padding:14px 26px 6px 26px;">
                  <div style="font-size:18px;font-weight:800;color:#0f172a;margin-bottom:10px;">Insights Based on Today's Data</div>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fbff;border:1px solid #dbeafe;border-radius:14px;padding:14px;">
                    ${insightRows}
                  </table>
                </td>
              </tr>

              <tr>
                <td style="padding:16px 26px 22px 26px;">
                  <div style="font-size:12px;line-height:1.6;color:#64748b;">
                    Generated on ${escapeHtml(formatDateShort(new Date()))}. This report includes today's posture sessions and tracked-time records only.
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

function renderEmailText({ user, data }) {
  const name = user.firstName || user.username || "there";
  const { date, overview, components, activeHourly, sessions, insights } = data;

  const hourlyLines = activeHourly.length
    ? activeHourly
        .map(
          (slot) =>
            `  - ${slot.label}: ${slot.score}% (${slot.sessions} sessions, ${slot.minutes} min)`
        )
        .join("\n")
    : "  - No hourly snapshots captured today";

  const sessionLines = sessions.length
    ? sessions
        .slice()
        .sort((a, b) => (b.referenceTime?.getTime() || 0) - (a.referenceTime?.getTime() || 0))
        .slice(0, 8)
        .map((session) => {
          const start = session.startTime
            ? session.startTime.toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "--:--";
          const end = session.endTime
            ? session.endTime.toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
              })
            : session.status === "Active"
            ? "Now"
            : "--:--";
          return `  - ${start}-${end} | ${formatMinutes(session.durationMinutes)} | ${
            session.overallScore
          }% | corrections ${session.corrections} | ${session.status}`;
        })
        .join("\n")
    : "  - No completed sessions recorded";

  return [
    `Posture Report for ${name}`,
    `Date: ${formatDateLong(date)}`,
    "",
    `Average Score: ${overview.averageScore}% (${overview.performanceLabel})`,
    `Time Tracked: ${formatMinutes(overview.totalTimeTracked)}`,
    `Sessions: ${overview.sessionsCount}`,
    `Corrections: ${overview.totalCorrections}`,
    `Best Session Score: ${overview.bestSessionScore}%`,
    "",
    "Component Scores:",
    `  - Head Position: ${components.headTilt}%`,
    `  - Shoulder Alignment: ${components.shoulderAlignment}%`,
    `  - Spinal Posture: ${components.spinalPosture}%`,
    "",
    "Hourly Trend:",
    hourlyLines,
    "",
    "Session Details:",
    sessionLines,
    "",
    "Insights:",
    ...insights.map((line) => `  - ${line}`),
  ].join("\n");
}

async function buildDailyEmail(userId, date = new Date()) {
  const user = await User.findById(userId).lean();
  if (!user) throw new Error("User not found");
  if (!user.email) throw new Error("User email is not configured");

  const data = await collectDailyEmailData(userId, date);

  const html = renderEmailHtml({ user, data });
  const text = renderEmailText({ user, data });
  const subject = `Daily Posture Report - ${formatDateShort(data.date)} | ${
    data.overview.averageScore
  }%`;

  logger.info(`Daily email built for ${user.email}`, {
    sessions: data.overview.sessionsCount,
    timeTrackedMinutes: data.overview.totalTimeTracked,
    averageScore: data.overview.averageScore,
  });

  return { to: user.email, subject, html, text };
}

module.exports = { buildDailyEmail };
