// modules/providerScoring.js
"use strict";

const SCORE_INITIAL    = 100;
const SCORE_MAX        = 100;
const SCORE_MIN        = 0;
const CB_THRESHOLD     = 20;   // score < 20 → circuit breaker aperto
const CB_OPEN_TTL_SECS = 900;  // 15 minuti

const PROVIDERS = ["ALPACA", "POLYGON", "FMP", "IBKR"];

class ProviderScoring {
  /**
   * @param {object} opts
   * @param {object} opts.bus    RedisBus condiviso
   * @param {object} opts.logger Logger condiviso
   */
  constructor({ bus, logger }) {
    this.bus    = bus;
    this.logger = logger;
  }

  _scoreKey(provider) {
    return this.bus.key("provider", "score", provider.toLowerCase());
  }

  _cbKey(provider) {
    return this.bus.key("provider", "cb-open", provider.toLowerCase());
  }

  // ---------------------------------------------------------------------------
  // Read / write score
  // ---------------------------------------------------------------------------

  async _getScore(provider) {
    if (!this.bus?.pub?.isOpen) return SCORE_INITIAL;
    try {
      const raw = await this.bus.pub.get(this._scoreKey(provider));
      if (raw === null) {
        // Prima lettura: inizializza a 100
        await this.bus.pub.set(this._scoreKey(provider), String(SCORE_INITIAL));
        return SCORE_INITIAL;
      }
      return parseFloat(raw);
    } catch {
      return SCORE_INITIAL;
    }
  }

  async _setScore(provider, score) {
    if (!this.bus?.pub?.isOpen) return;
    const clamped = Math.max(SCORE_MIN, Math.min(SCORE_MAX, score));
    try {
      await this.bus.pub.set(this._scoreKey(provider), String(clamped));

      // Apri circuit breaker se lo score scende sotto la soglia
      if (clamped < CB_THRESHOLD) {
        const alreadyOpen = await this.bus.pub.get(this._cbKey(provider));
        if (!alreadyOpen) {
          await this.bus.pub.set(this._cbKey(provider), "1", { EX: CB_OPEN_TTL_SECS });
          this.logger.warning(
            `[ProviderScoring] Circuit breaker OPEN per ${provider} ` +
            `(score=${Math.round(clamped)}) — saltato per ${CB_OPEN_TTL_SECS / 60} min`
          );
        }
      }
    } catch (err) {
      this.logger.warning(`[ProviderScoring] _setScore error: ${err.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Circuit breaker
  // ---------------------------------------------------------------------------

  /**
   * Ritorna true se il circuit breaker del provider è aperto (provider da saltare).
   */
  async isCircuitOpen(provider) {
    if (!this.bus?.pub?.isOpen) return false;
    try {
      const v = await this.bus.pub.get(this._cbKey(provider));
      return v !== null;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Score recording
  // ---------------------------------------------------------------------------

  /** Chiamata completata con successo: +2 (max 100). */
  async recordSuccess(provider) {
    if (!this.bus?.pub?.isOpen) return;
    try {
      const current = await this._getScore(provider);
      await this._setScore(provider, current + 2);
    } catch (err) {
      this.logger.warning(`[ProviderScoring] recordSuccess error: ${err.message}`);
    }
  }

  /**
   * Errore API esplicito (status "ERROR"/"NOT_AUTHORIZED", messaggio rate-limit):
   * penalità -30.
   */
  async recordApiError(provider) {
    if (!this.bus?.pub?.isOpen) return;
    try {
      const current = await this._getScore(provider);
      await this._setScore(provider, current - 30);
      this.logger.warning(`[ProviderScoring] ${provider} API error — score: ${Math.round(current)} → ${Math.round(current - 30)}`);
    } catch (err) {
      this.logger.warning(`[ProviderScoring] recordApiError error: ${err.message}`);
    }
  }

  /**
   * Errore generico (timeout, rete, parsing): penalità -10.
   */
  async recordGenericError(provider) {
    if (!this.bus?.pub?.isOpen) return;
    try {
      const current = await this._getScore(provider);
      await this._setScore(provider, current - 10);
      this.logger.warning(`[ProviderScoring] ${provider} generic error — score: ${Math.round(current)} → ${Math.round(current - 10)}`);
    } catch (err) {
      this.logger.warning(`[ProviderScoring] recordGenericError error: ${err.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  /**
   * Ritorna score e stato circuit breaker per ogni provider.
   */
  async getStatus() {
    if (!this.bus?.pub?.isOpen) return {};
    const result = {};
    for (const p of PROVIDERS) {
      try {
        const [score, cbOpen] = await Promise.all([
          this._getScore(p),
          this.isCircuitOpen(p),
        ]);
        result[p] = { score: Math.round(score), cbOpen };
      } catch {
        result[p] = { score: null, cbOpen: false };
      }
    }
    return result;
  }
}

module.exports = { ProviderScoring };
