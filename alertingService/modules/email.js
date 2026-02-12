"use strict";

const nodemailer = require("nodemailer");

class EmailClient {
  constructor({ logger }) {
    this.logger = logger;
    this.smtpHost = process.env.SMTP_HOST;
    this.smtpPort = process.env.SMTP_PORT;
    this.smtpUser = process.env.SMTP_USER;
    this.smtpPassword = process.env.SMTP_PASSWORD;
    this.smtpFrom = process.env.SMTP_FROM;

    const port = Number(this.smtpPort);
    if (this.smtpHost && this.smtpUser && this.smtpPassword && Number.isFinite(port)) {
      this.transporter = nodemailer.createTransport({
        host: this.smtpHost,
        port,
        secure: port === 465,
        auth: {
          user: this.smtpUser,
          pass: this.smtpPassword,
        },
        connectionTimeout: 10000,
        greetingTimeout: 5000,
        socketTimeout: 10000,
      });
    } else {
      this.transporter = null;
    }
  }

  isReady() {
    return Boolean(this.transporter && this.smtpFrom);
  }

  async sendEmail({ to, subject, body }) {
    if (!this.transporter || !this.smtpFrom) {
      const error = "SMTP client not configured";
      this.logger?.error?.(`[email] ${error}`);
      throw new Error(error);
    }
    if (!to || !subject || !body) {
      throw new Error("Missing to/subject/body");
    }

    this.logger?.info?.(`[email] sending to=${to} subject="${subject}"`);
    try {
      const info = await this.transporter.sendMail({
        from: this.smtpFrom,
        to,
        subject,
        text: body,
      });
      this.logger?.debug?.(`[email] sent messageId=${info.messageId}`);
      return info;
    } catch (err) {
      this.logger?.error?.(`[email] send failed ${err?.message || String(err)}`);
      throw err;
    }
  }
}

module.exports = EmailClient;
