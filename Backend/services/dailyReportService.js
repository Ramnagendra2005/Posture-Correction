const { DailySummary, PostureSession, User } = require("../models");
const logger = require("../utils/logger");

function formatMinutes(mins) {
  // Units here are minutes; clamp to a max of 24h to avoid bogus 25h+ values in emails
  const safe = Math.max(0, Math.min(1440, Math.round(mins || 0)));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${h}h ${m}m`;
}

function renderEmailHtml({ user, date, overview, components }) {
  const dateStr = date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const style = `
    body { font-family: Arial, sans-serif; background: #f6f7fb; padding: 16px; }
    .card { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; max-width: 640px; margin: 0 auto; }
    .h1 { margin: 0 0 8px; font-size: 20px; color: #111827; }
    .sub { margin: 0 0 16px; color: #6b7280; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .metric { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; }
    .label { font-size: 12px; color: #6b7280; }
    .value { font-size: 18px; font-weight: 600; color: #111827; }
    .footer { margin-top: 16px; font-size: 12px; color: #9ca3af; }
  `;

  return `<!doctype html>
  <html><head><meta charset="utf-8"/><style>${style}</style></head>
  <body>
    <div class="card">
      <h1 class="h1">Your Daily Posture Report</h1>
      <p class="sub">Hi ${
        user.firstName || user.username
      }, here is your summary for ${dateStr}.</p>
      <div class="grid">
        <div class="metric"><div class="label">Average Score</div><div class="value">${
          overview.averageScore
        }%</div></div>
        <div class="metric"><div class="label">Time Tracked</div><div class="value">${formatMinutes(
          overview.totalTimeTracked
        )}</div></div>
        <div class="metric"><div class="label">Sessions</div><div class="value">${
          overview.sessionsCount
        }</div></div>
        <div class="metric"><div class="label">Corrections</div><div class="value">${
          overview.totalCorrections
        }</div></div>
      </div>
      <div class="grid" style="margin-top: 12px;">
        <div class="metric"><div class="label">Head Tilt</div><div class="value">${
          components.headTilt
        }%</div></div>
        <div class="metric"><div class="label">Shoulders</div><div class="value">${
          components.shoulderAlignment
        }%</div></div>
        <div class="metric"><div class="label">Spinal Posture</div><div class="value">${
          components.spinalPosture
        }%</div></div>
        <div class="metric"><div class="label">Best Session</div><div class="value">${
          overview.bestSessionScore
        }%</div></div>
      </div>
      <p class="footer">Tip: Keep your screen at eye level and take short breaks every 30 minutes.</p>
    </div>
  </body></html>`;
}

async function getDailySummaryForUser(userId, date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  // Try DailySummary first (fast path)
  let summary = await DailySummary.findOne({
    userId,
    date: { $gte: start, $lt: end },
  }).lean();

  // If not available, aggregate from sessions (fallback)
  if (!summary) {
    const sessions = await PostureSession.find({
      userId,
      startTime: { $gte: start, $lt: end },
      status: { $in: ["completed", "active", "paused"] },
    }).lean();
    const sessionsCount = sessions.length;
    // duration is stored in minutes across the app
    const totalTimeTracked = sessions.reduce(
      (s, sess) => s + (sess.duration || 0),
      0
    );
    const totalCorrections = sessions.reduce(
      (s, sess) => s + (sess.postureMetrics?.totalCorrections || 0),
      0
    );
    const averageScore =
      sessionsCount > 0
        ? Math.round(
            sessions.reduce(
              (s, sess) => s + (sess.scores?.overallScore || 0),
              0
            ) / sessionsCount
          )
        : 0;

    const headTilt =
      sessionsCount > 0
        ? Math.round(
            sessions.reduce(
              (s, sess) => s + (sess.scores?.headTiltScore || 0),
              0
            ) / sessionsCount
          )
        : 0;
    const shoulderAlignment =
      sessionsCount > 0
        ? Math.round(
            sessions.reduce(
              (s, sess) => s + (sess.scores?.shoulderAlignmentScore || 0),
              0
            ) / sessionsCount
          )
        : 0;
    const spinalPosture =
      sessionsCount > 0
        ? Math.round(
            sessions.reduce(
              (s, sess) => s + (sess.scores?.spinalPostureScore || 0),
              0
            ) / sessionsCount
          )
        : 0;
    const bestSessionScore =
      sessionsCount > 0
        ? Math.max(...sessions.map((s) => s.scores?.overallScore || 0))
        : 0;

    summary = {
      date: start,
      totalTimeTracked,
      sessionsCount,
      totalCorrections: { total: totalCorrections },
      averageScores: {
        overall: averageScore,
        headTilt,
        shoulderAlignment,
        spinalPosture,
      },
      qualityMetrics: { bestSessionScore },
    };
  }

  return summary;
}

async function buildDailyEmail(userId, date = new Date()) {
  const user = await User.findById(userId).lean();
  if (!user) throw new Error("User not found");

  const summary = await getDailySummaryForUser(userId, date);

  const overview = {
    averageScore: Math.round(summary?.averageScores?.overall || 0),
    totalTimeTracked: Math.min(
      1440,
      Math.round(summary?.totalTimeTracked || 0)
    ),
    sessionsCount: Math.round(summary?.sessionsCount || 0),
    totalCorrections: Math.round(summary?.totalCorrections?.total || 0),
    bestSessionScore: Math.round(
      summary?.qualityMetrics?.bestSessionScore || 0
    ),
  };

  const components = {
    headTilt: Math.round(summary?.averageScores?.headTilt || 0),
    shoulderAlignment: Math.round(
      summary?.averageScores?.shoulderAlignment || 0
    ),
    spinalPosture: Math.round(summary?.averageScores?.spinalPosture || 0),
  };

  const html = renderEmailHtml({ user, date, overview, components });
  const subject = `Your Daily Posture Report - ${date.toLocaleDateString(
    "en-US"
  )}`;

  return { to: user.email, subject, html };
}

module.exports = { buildDailyEmail };
