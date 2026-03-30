const nodemailer = require("nodemailer");
const logger = require("../utils/logger");

let transporter;

function createTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    logger.warn(
      "Email disabled: missing SMTP configuration (SMTP_HOST/USER/PASS)."
    );
    return null;
  }

  logger.info(
    `SMTP configured for host ${host}:${port} as ${
      user?.split("@")[0]
    } (secure=${port === 465})`
  );

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465, false for other ports
    auth: { user, pass },
  });

  return transporter;
}

async function sendMail({ to, subject, html, text, from }) {
  const tx = createTransporter();
  if (!tx) {
    logger.warn(`Skipping email to ${to} (transporter not configured).`);
    return { skipped: true };
  }

  const mailFrom =
    from || process.env.MAIL_FROM || `Posture Coach <no-reply@posture.local>`;

  const info = await tx.sendMail({ from: mailFrom, to, subject, html, text });
  logger.info(`Email sent to ${to}: ${info.messageId}`);
  return info;
}

module.exports = { sendMail };
