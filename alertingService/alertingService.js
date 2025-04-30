// AlertingService.js
const nodemailer = require('nodemailer');
const axios = require('axios');

const MODULE_NAME = 'AlertingService';
const MODULE_VERSION = '1.0';

class AlertingService {
  constructor() {
    this.transporter = null;
  }

  // Recupera configurazione SMTP da DBManager
  async loadSettings() {
    const keys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'];
    const settings = {};
    const dbManagerUrl = process.env.DBMANAGER_URL || 'http://dbmanager:3002';

    for (const key of keys) {
      try {
        const res = await axios.get(`${dbManagerUrl}/getSetting/${key}`);
        settings[key] = res.data.value;
      } catch (err) {
        console.error(`[${MODULE_NAME}][loadSettings] Errore nella chiave ${key}: ${err.message}`);
        throw err;
      }
    }

    this.smtpFrom = settings.SMTP_FROM;

    this.transporter = nodemailer.createTransport({
      host: settings.SMTP_HOST,
      port: parseInt(settings.SMTP_PORT, 10),
      secure: false,
      auth: {
        user: settings.SMTP_USER,
        pass: settings.SMTP_PASSWORD
      }
    });

    console.log(`[${MODULE_NAME}] Configurazione SMTP caricata.`);
  }

  // Invio email
  async sendEmail({ to, subject, body }) {
    try {
      const info = await this.transporter.sendMail({
        from: this.smtpFrom,
        to:to,
        subject:subject,
        text: body
      });
      console.log(`[${MODULE_NAME}][sendEmail] Email inviata a ${to}: ${info.messageId}`);
      return info;
    } catch (err) {
      console.error(`[${MODULE_NAME}][sendEmail] Errore invio email: ${err.message}`);
      throw err;
    }
  }

  // Informazioni sul modulo
  getInfo() {
    return {
      module: MODULE_NAME,
      version: MODULE_VERSION,
      status: 'OK'
    };
  }
}

module.exports = AlertingService;
