"use strict";

const twilio = require("twilio");

const DEFAULT_FROM = "whatsapp:+14155238886";
const DEFAULT_TO = "whatsapp:+971524396227";

class TwilioClient {
  constructor({ logger }) {
    this.logger = logger;
    this.accountSid = process.env.TWILIO_ACCOUNT_SID;
    this.authToken = process.env.TWILIO_AUTH_TOKEN;
    this.templateSid = process.env.TWILIO_CONTENT_SID;
    this.client =
      this.accountSid && this.authToken
        ? twilio(this.accountSid, this.authToken)
        : null;
  }

  isReady() {
    return Boolean(this.client);
  }

  async sendWhatsAppMessage(payload = {}) {
    if (!this.client) {
      const error = "Twilio client not configured";
      this.logger?.error?.(`[twilio] ${error}`);
      throw new Error(error);
    }

    const {
      to = DEFAULT_TO,
      from = DEFAULT_FROM,
      body,
      contentSid,
      contentVariables,
    } = payload;

    if (!to || !from) {
      throw new Error("Missing to/from");
    }

    const messagePayload = { to, from };
    if (contentSid) {
      messagePayload.contentSid = contentSid;
      if (contentVariables) {
        messagePayload.contentVariables =
          typeof contentVariables === "string"
            ? contentVariables
            : JSON.stringify(contentVariables);
      }
    } else if (body) {
      messagePayload.body = body;
    } else {
      throw new Error("Missing body or contentSid");
    }

    this.logger?.info?.(
      `[twilio] sending whatsapp to=${to} from=${from} template=${Boolean(contentSid)}`
    );

    try {
      const message = await this.client.messages.create(messagePayload);
      this.logger?.debug?.(
        `[twilio] message sent sid=${message.sid}`
      );
      return message;
    } catch (err) {
      this.logger?.error?.(
        `[twilio] send failed ${err?.message || String(err)}`
      );
      throw err;
    }
  }

  async sendWhatsAppTemplate(payload = {}) {
    const {
      to = DEFAULT_TO,
      from = DEFAULT_FROM,
      contentSid = this.templateSid,
      contentVariables,
      variables,
    } = payload;

    if (!contentSid) {
      throw new Error("Missing contentSid");
    }

    return this.sendWhatsAppMessage({
      to,
      from,
      contentSid,
      contentVariables: contentVariables ?? variables,
    });
  }
}

module.exports = TwilioClient;
