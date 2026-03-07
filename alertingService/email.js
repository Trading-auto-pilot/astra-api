"use strict";

const { Router } = require("express");
const EmailClient = require("./modules/email");

module.exports = function buildEmailRouter({ logger }) {
  const router = Router();
  const emailClient = new EmailClient({ logger });

  router.post("/send", async (req, res) => {
    const payload = req.body || {};

    if (!emailClient.isReady()) {
      logger?.error?.(
        `[POST /email/send] SMTP client not configured | ` +
        `Has transporter: ${!!emailClient.transporter} | ` +
        `Has SMTP_FROM: ${!!emailClient.smtpFrom} | ` +
        `Request payload: ${JSON.stringify({ to: payload.to, subject: payload.subject, hasBody: !!payload.body })}`
      );
      return res.status(500).json({
        ok: false,
        error: "SMTP client not configured",
        details: {
          hasTransporter: !!emailClient.transporter,
          hasSmtpFrom: !!emailClient.smtpFrom,
        }
      });
    }

    try {
      const info = await emailClient.sendEmail(payload);
      return res.json({
        ok: true,
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
      });
    } catch (err) {
      logger?.warning?.(
        `[email] send failed ${err?.message || String(err)}`
      );
      return res.status(500).json({
        ok: false,
        error: "Errore invio email",
        message: err?.message || String(err),
      });
    }
  });

  return router;
};
