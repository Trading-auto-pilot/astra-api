"use strict";

const { Router } = require("express");
const TwilioClient = require("./modules/twilio");

module.exports = function buildWhatsappRouter({ logger }) {
  const router = Router();
  const twilioClient = new TwilioClient({ logger });

  router.post("/send", async (req, res) => {
    const payload = req.body || {};

    if (!twilioClient.isReady()) {
      return res.status(500).json({
        ok: false,
        error: "Twilio client not configured",
      });
    }

    try {
      const message = await twilioClient.sendWhatsAppMessage(payload);
      return res.json({
        ok: true,
        sid: message.sid,
        status: message.status,
        to: message.to,
      });
    } catch (err) {
      logger?.warning?.(
        `[whatsapp] send failed ${err?.message || String(err)}`
      );
      return res.status(500).json({
        ok: false,
        error: "Errore invio WhatsApp",
        message: err?.message || String(err),
      });
    }
  });

  router.post("/template", async (req, res) => {
    const payload = req.body || {};

    if (!twilioClient.isReady()) {
      return res.status(500).json({
        ok: false,
        error: "Twilio client not configured",
      });
    }

    try {
      const message = await twilioClient.sendWhatsAppTemplate(payload);
      return res.json({
        ok: true,
        sid: message.sid,
        status: message.status,
        to: message.to,
      });
    } catch (err) {
      logger?.warning?.(
        `[whatsapp] template failed ${err?.message || String(err)}`
      );
      return res.status(500).json({
        ok: false,
        error: "Errore invio WhatsApp template",
        message: err?.message || String(err),
      });
    }
  });

  return router;
};
