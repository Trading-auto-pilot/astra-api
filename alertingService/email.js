"use strict";

const { Router } = require("express");
const EmailClient = require("./modules/email");

module.exports = function buildEmailRouter({ logger }) {
  const router = Router();
  const emailClient = new EmailClient({ logger });

  router.post("/send", async (req, res) => {
    const payload = req.body || {};

    if (!emailClient.isReady()) {
      return res.status(500).json({
        ok: false,
        error: "SMTP client not configured",
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
