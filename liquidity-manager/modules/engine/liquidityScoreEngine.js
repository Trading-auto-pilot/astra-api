"use strict";

const defaultVixProvider = require("../../providers/vixProvider");
const defaultSpyProvider = require("../../providers/spyProvider");
const defaultDxyProvider = require("../../providers/dxyProvider");
const defaultCreditProvider = require("../../providers/creditProvider");
const { getStatus: getProviderHealthStatus } = require("../../providers/providerHealthRegistry");
const { normalizeVix } = require("../normalizers/vixNormalizer");
const { normalizeSpyTrend } = require("../normalizers/spyTrendNormalizer");
const { normalizeDxy } = require("../normalizers/dxyNormalizer");
const { normalizeCreditSpread } = require("../normalizers/creditNormalizer");
const { runComponent, classifyErrorStatus } = require("../components/runComponent");
const { getConfigNumber, getConfigString } = require("../../../shared/loadSettings");

const DEFAULT_WEIGHTS = {
  vix: 0.35,
  spyTrend: 0.35,
  dxy: 0.15,
  credit: 0.15,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, precision = 2) {
  const f = 10 ** precision;
  return Math.round(value * f) / f;
}

function resolveRiskRegime(score, confidence, minConfidenceForRegime) {
  if (!Number.isFinite(Number(score)) || confidence < minConfidenceForRegime) return "UNKNOWN";
  if (score < 30) return "RISK_OFF";
  if (score > 60) return "RISK_ON";
  return "NEUTRAL";
}

function resolveVolatilityRegime(vixComponent) {
  if (!vixComponent || vixComponent.status !== "OK") return "UNKNOWN";
  const vixRaw = Number(vixComponent.raw);
  const vixNormalized = Number(vixComponent.normalized);
  if (Number.isFinite(vixRaw)) {
    if (vixRaw <= 15) return "LOW";
    if (vixRaw >= 25) return "HIGH";
    return "NORMAL";
  }
  if (Number.isFinite(vixNormalized)) {
    if (vixNormalized >= 70) return "LOW";
    if (vixNormalized <= 35) return "HIGH";
  }
  return "UNKNOWN";
}

class LiquidityScoreEngine {
  constructor({
    logger,
    mode = getConfigString("LIQUIDITY_PROVIDER_MODE", "live"),
    weights,
    providers,
    normalizers,
    minConfidenceForRegime,
    providerTimeoutMs,
  } = {}) {
    this.logger = logger || console;
    this.mode = mode;
    this.weights = { ...DEFAULT_WEIGHTS, ...(weights || {}) };
    this.providers = {
      vix: defaultVixProvider,
      spyTrend: defaultSpyProvider,
      dxy: defaultDxyProvider,
      credit: defaultCreditProvider,
      ...(providers || {}),
    };
    this.normalizers = {
      vix: normalizers?.vix || normalizeVix,
      spyTrend: normalizers?.spyTrend || normalizeSpyTrend,
      dxy: normalizers?.dxy || normalizeDxy,
      credit: normalizers?.credit || normalizeCreditSpread,
    };
    this.minConfidenceForRegime =
      Number(minConfidenceForRegime ?? getConfigNumber("LIQ_MIN_CONFIDENCE_FOR_REGIME", 0.6)) || 0.6;
    this.providerTimeoutMs = Number(providerTimeoutMs ?? getConfigNumber("LIQ_PROVIDER_TIMEOUT_MS", 5000)) || 5000;
  }

  _componentDefinitions() {
    return [
      {
        name: "vix",
        weight: this.weights.vix,
        fetchFn: () =>
          this.providers.vix.getLatest({
            mode: this.mode,
            timeoutMs: this.providerTimeoutMs,
            logger: this.logger,
          }),
        normalizeFn: (latest) => {
          const raw = Number(latest?.value);
          const n = this.normalizers.vix(raw);
          return {
            raw,
            normalized: n.normalized,
            timestamp: latest?.timestamp,
            source: latest?.source,
            details: n.details,
            note: n.note,
          };
        },
      },
      {
        name: "spyTrend",
        weight: this.weights.spyTrend,
        fetchFn: () =>
          this.providers.spyTrend.getHistory(undefined, undefined, {
            mode: this.mode,
            timeoutMs: this.providerTimeoutMs,
            logger: this.logger,
          }),
        normalizeFn: (series) => {
          const data = Array.isArray(series) ? series : [];
          const latest = data[data.length - 1];
          const n = this.normalizers.spyTrend(data);
          return {
            raw: Number(latest?.value),
            normalized: n.normalized,
            timestamp: latest?.timestamp,
            source: latest?.source,
            details: n.details,
            note: n.note,
          };
        },
      },
      {
        name: "dxy",
        weight: this.weights.dxy,
        fetchFn: () =>
          this.providers.dxy.getHistory(undefined, undefined, {
            mode: this.mode,
            timeoutMs: this.providerTimeoutMs,
            logger: this.logger,
          }),
        normalizeFn: (series) => {
          const data = Array.isArray(series) ? series : [];
          const latest = data[data.length - 1];
          const n = this.normalizers.dxy(data);
          return {
            raw: Number(latest?.value),
            normalized: n.normalized,
            timestamp: latest?.timestamp,
            source: latest?.source,
            details: n.details,
            note: n.note,
          };
        },
      },
      {
        name: "credit",
        weight: this.weights.credit,
        fetchFn: () =>
          this.providers.credit.getLatest({
            mode: this.mode,
            timeoutMs: this.providerTimeoutMs,
            logger: this.logger,
          }),
        normalizeFn: (latest) => {
          const raw = Number(latest?.value);
          const n = this.normalizers.credit(raw);
          return {
            raw,
            normalized: n.normalized,
            timestamp: latest?.timestamp,
            source: latest?.source,
            details: n.details,
            note: n.note,
          };
        },
      },
    ];
  }

  _buildNotes(components) {
    const notes = [];
    Object.entries(components).forEach(([name, component]) => {
      if (component.status !== "OK") {
        const reason = component?.error?.message || component?.note || "not available";
        notes.push(`${name} ${String(component.status).toLowerCase()}: ${reason}`);
      } else if (component.note) {
        notes.push(`${name}: ${component.note}`);
      }
    });
    return notes;
  }

  async computeScore({ onProgress } = {}) {
    this.logger?.info?.(`compute start mode=${this.mode}`);
    onProgress?.("ENGINE.START", `Compute start mode=${this.mode}`);
    const nowIso = new Date().toISOString();

    const definitions = this._componentDefinitions();
    const results = await Promise.all(
      definitions.map((definition) =>
        runComponent({
          name: definition.name,
          weight: definition.weight,
          fetchFn: async () => {
            onProgress?.(`FETCH.${definition.name}.START`, `Fetching source ${definition.name}`);
            const result = await definition.fetchFn();
            onProgress?.(`FETCH.${definition.name}.OK`, `Fetched source ${definition.name}`);
            return result;
          },
          normalizeFn: async (payload) => {
            onProgress?.(`NORMALIZE.${definition.name.toUpperCase()}.START`, `Normalizing ${definition.name}`);
            return definition.normalizeFn(payload);
          },
          logger: this.logger,
          timeoutMs: this.providerTimeoutMs,
        })
      )
    );

    const components = {};
    results.forEach((result, idx) => {
      const name = definitions[idx].name;
      components[name] = {
        raw: result.raw,
        normalized: result.normalized,
        weight: result.weight,
        timestamp: result.timestamp || nowIso,
        source: result.source || "unknown",
        details: result.details,
        status: result.status,
        error: result.error || null,
      };
    });

    const totalWeight = Object.values(this.weights).reduce((acc, w) => acc + Number(w || 0), 0);
    let availableWeight = 0;
    let weightedAvailableSum = 0;

    Object.entries(this.weights).forEach(([key, weight]) => {
      const component = components[key];
      const normalized = Number(component?.normalized);
      const componentWeight = Number(weight || 0);
      if (component?.status === "OK" && Number.isFinite(normalized)) {
        availableWeight += componentWeight;
        weightedAvailableSum += normalized * componentWeight;
      }
    });

    const score =
      availableWeight > 0 ? clamp(round(weightedAvailableSum / availableWeight, 2), 0, 100) : null;
    const confidence =
      totalWeight > 0 ? clamp(round(availableWeight / totalWeight, 2), 0, 1) : 0;
    const riskRegime = resolveRiskRegime(score, confidence, this.minConfidenceForRegime);
    const volatilityRegime = resolveVolatilityRegime(components.vix);
    const notes = this._buildNotes(components);
    if (confidence < this.minConfidenceForRegime) {
      notes.push(
        `confidence below threshold (${confidence} < ${round(this.minConfidenceForRegime, 2)}): regime set to UNKNOWN`
      );
    }
    onProgress?.("ENGINE.AGGREGATE", "Aggregating weighted score and regimes");
    this.logger?.info?.(
      `compute done score=${score == null ? "null" : score} riskRegime=${riskRegime} volatilityRegime=${volatilityRegime} confidence=${confidence} availableWeight=${round(
        availableWeight,
        4
      )}/${round(totalWeight, 4)}`
    );
    onProgress?.("ENGINE.DONE", `Done score=${score == null ? "null" : score} riskRegime=${riskRegime}`);

    return {
      ok: true,
      timestamp: nowIso,
      score,
      riskRegime,
      volatilityRegime,
      confidence,
      components,
      weights: this.weights,
      notes,
    };
  }

  async getProvidersStatus({ timeoutMs } = {}) {
    const effectiveTimeout = Number(timeoutMs || this.providerTimeoutMs) || this.providerTimeoutMs;
    const checks = [
      {
        name: "vix",
        exec: () =>
          this.providers.vix.getLatest({
            mode: this.mode,
            timeoutMs: effectiveTimeout,
            logger: this.logger,
          }),
      },
      {
        name: "spyTrend",
        exec: () =>
          this.providers.spyTrend.getLatest({
            mode: this.mode,
            timeoutMs: effectiveTimeout,
            logger: this.logger,
          }),
      },
      {
        name: "dxy",
        exec: () =>
          this.providers.dxy.getLatest({
            mode: this.mode,
            timeoutMs: effectiveTimeout,
            logger: this.logger,
          }),
      },
      {
        name: "credit",
        exec: () =>
          this.providers.credit.getLatest({
            mode: this.mode,
            timeoutMs: effectiveTimeout,
            logger: this.logger,
          }),
      },
    ];

    const providers = {};
    await Promise.all(
      checks.map(async (check) => {
        try {
          const latest = await check.exec();
          const health = getProviderHealthStatus(check.name);
          providers[check.name] = {
            status: "OK",
            value: Number.isFinite(Number(latest?.value)) ? Number(latest.value) : null,
            timestamp: latest?.timestamp || null,
            source: latest?.source || null,
            lastSuccessTimestamp: health.lastSuccessTimestamp,
            lastError: health.lastError,
          };
        } catch (err) {
          const health = getProviderHealthStatus(check.name);
          providers[check.name] = {
            status: classifyErrorStatus(err),
            value: null,
            timestamp: null,
            source: null,
            error: {
              code: err?.code || "UNKNOWN",
              message: err?.message || String(err),
              details: err?.details,
            },
            lastSuccessTimestamp: health.lastSuccessTimestamp,
            lastError: health.lastError,
          };
        }
      })
    );

    return {
      ok: true,
      timestamp: new Date().toISOString(),
      timeoutMs: effectiveTimeout,
      providers,
    };
  }
}

module.exports = LiquidityScoreEngine;
