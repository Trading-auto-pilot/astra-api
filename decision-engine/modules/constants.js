"use strict";

// ---------------------------------------------------------------------------
// constants – tutte le costanti nominate per decision-engine
// ---------------------------------------------------------------------------

// --- Timeout (ms) ----------------------------------------------------------
const CACHEMANAGER_TIMEOUT_MS = 60000;
const TICKERSCANNER_TIMEOUT_MS = 20000;
const AUTH_TIMEOUT_MS = 10000;
const SUBSCRIPTION_TIMEOUT_MS = 10000;
const ALERT_TIMEOUT_MS = 10000;

// --- Redis -----------------------------------------------------------------
const SNAPSHOT_TTL_SECONDS = 60 * 60 * 12; // 43200 (12h)

// --- Job -------------------------------------------------------------------
const MAX_CONCURRENCY = 6;
const DEFAULT_CONCURRENCY = 3;
const MIN_CONCURRENCY = 1;
const DEFAULT_JOB_LIMIT = 0; // 0 = unlimited
const MAX_JOB_LIMIT = 0;

// --- Virtual pipe IDs -------------------------------------------------------
// pipeId=0 is reserved for the ranking-daily virtual pipe:
// reads tickers from AST_RANKING_DAILY via GET /fundamentals/ranking/daily
const RANKING_DAILY_PIPE_ID = 0;

// --- Ranking Daily pipe pre-filter -----------------------------------------
// Applied in fetchRankingDailyTickers before calling spot-finder
const RANKING_DAILY_MAX_ATR_PCT    = 8.0;   // skip if atr_14_pct missing or > this
const RANKING_DAILY_REQUIRE_SMA50  = false; // if true: skip if price < SMA50
const RANKING_DAILY_REQUIRE_SMA200 = false; // if true: skip if SMA50 < SMA200

// --- Volatility tiers (atr_14_pct %) ----------------------------------------
const VOL_TIER_LOW_THRESHOLD  = 1.5; // atr_14_pct < 1.5  → LOW
const VOL_TIER_HIGH_THRESHOLD = 4.0; // atr_14_pct >= 4.0 → HIGH (else NORMAL)

// --- Adaptive spot-finder params per tier ----------------------------------
const RANKING_DAILY_VOL_LOW    = { maxLevelDistanceAtr: 2, volatilityK: 1.0, flagAtrK: 1.1 };
const RANKING_DAILY_VOL_NORMAL = { maxLevelDistanceAtr: 3, volatilityK: 1.2, flagAtrK: 1.3 };
const RANKING_DAILY_VOL_HIGH   = { maxLevelDistanceAtr: 4, volatilityK: 1.5, flagAtrK: 1.6 };

// --- Lookback defaults (per timeframe) -------------------------------------
const DEFAULT_LOOKBACK_DAYS = 120;
const DEFAULT_LOOKBACK_BARS = 90;
const DEFAULT_TF = "1day";

const CONFIRM_LOOKBACK_DAYS = 365;
const CONFIRM_LOOKBACK_BARS = 52;
const DEFAULT_CONFIRM_TF = "1week";

const RECENT_LOOKBACK_DAYS = 14;
const RECENT_LOOKBACK_BARS = 336;
const DEFAULT_RECENT_TF = "1h";

const INTRADAY_LOOKBACK_DAYS = 1;
const INTRADAY_LOOKBACK_BARS = 390;
const DEFAULT_INTRADAY_TF = "1min";

const SIGNAL_LOOKBACK_DAYS = 28;
const SIGNAL_LOOKBACK_BARS = 800;
const DEFAULT_SIGNAL_TF = "1h";

const MIN_LOOKBACK_BARS = 10;

// --- Zone analysis ---------------------------------------------------------
const DEFAULT_SWING_WINDOW = 3;
const DEFAULT_ATR_PERIOD = 20;
const DEFAULT_CLUSTER_MULTIPLIER = 0.4;
const DEFAULT_REACTION_LOOKAHEAD = 15;
const DEFAULT_MIN_TOUCHES = 2;
const DEFAULT_MIN_SCORE = 1;
const DEFAULT_RECENT_BARS = 60;
const DEFAULT_RECENCY_RECENT = 30;
const DEFAULT_RECENCY_MID = 90;
const DEFAULT_WEIGHT_RECENT = 1;
const DEFAULT_WEIGHT_MID = 0.6;
const DEFAULT_WEIGHT_OLD = 0.3;

// --- Pattern detection (detectTrendFlagBreakout) ---------------------------
const DEFAULT_TREND_BARS = 12;
const DEFAULT_TREND_MIN_ABOVE = 8;
const DEFAULT_PIVOT_LOOKBACK = 60;
const DEFAULT_IMPULSE_BARS = 80;
const DEFAULT_FLAG_BARS = 20;
const DEFAULT_BREAKOUT_LOOKBACK = 20;
const DEFAULT_FLAG_ATR_K = 1.3;
const DEFAULT_FLAG_PCT_K = 0.0025;
const DEFAULT_VOL_MULT = 1.2;
const DEFAULT_TRAILING_ATR_K = 2;

// --- Relaxed params --------------------------------------------------------
const RELAXED_LOOKBACK_DAYS = 180;
const RELAXED_MIN_TOUCHES = 1;
const RELAXED_MIN_SCORE = 0;
const RELAXED_RECENT_BARS = 180;
const RELAXED_SWING_WINDOW = 2;
const RELAXED_CLUSTER_MULTIPLIER = 0.5;

// --- Live mode -------------------------------------------------------------
const LIVE_MIN_INTERVAL_MS = 60000;
const ALERT_COOLDOWN_MS = 600000;

// --- Entry levels ----------------------------------------------------------
const DEFAULT_ZONE_FILL_K = 0.55;
const DEFAULT_BREAKOUT_K = 0.25;
const DEFAULT_STRUCTURAL_K = 0.2;
const DEFAULT_VOLATILITY_K = 1.2;
const DEFAULT_TP_ATR_K = 5;
const DEFAULT_MIN_STOP_ATR_K = 1.0;
const DEFAULT_MIN_TP2_ATR_K = 3.0;
const DEFAULT_MAX_LEVEL_DISTANCE_ATR = 3;

// --- Indicatori -----------------------------------------------------------
const DEFAULT_EMA_FAST = 20;
const DEFAULT_EMA_SLOW = 50;
const DEFAULT_VOL_MA_PERIOD = 20;
const PRICE_EPS_FACTOR = 0.0001;
const MIN_EPS = 1e-6;
const MIN_CANDLES_FOR_PATTERN = 60;

module.exports = {
  // Timeout
  CACHEMANAGER_TIMEOUT_MS,
  TICKERSCANNER_TIMEOUT_MS,
  AUTH_TIMEOUT_MS,
  SUBSCRIPTION_TIMEOUT_MS,
  ALERT_TIMEOUT_MS,

  // Redis
  SNAPSHOT_TTL_SECONDS,

  // Job
  MAX_CONCURRENCY,
  DEFAULT_CONCURRENCY,
  MIN_CONCURRENCY,
  DEFAULT_JOB_LIMIT,
  MAX_JOB_LIMIT,

  // Virtual pipes
  RANKING_DAILY_PIPE_ID,
  RANKING_DAILY_MAX_ATR_PCT,
  RANKING_DAILY_REQUIRE_SMA50,
  RANKING_DAILY_REQUIRE_SMA200,
  VOL_TIER_LOW_THRESHOLD,
  VOL_TIER_HIGH_THRESHOLD,
  RANKING_DAILY_VOL_LOW,
  RANKING_DAILY_VOL_NORMAL,
  RANKING_DAILY_VOL_HIGH,

  // Lookback
  DEFAULT_LOOKBACK_DAYS,
  DEFAULT_LOOKBACK_BARS,
  DEFAULT_TF,
  CONFIRM_LOOKBACK_DAYS,
  CONFIRM_LOOKBACK_BARS,
  DEFAULT_CONFIRM_TF,
  RECENT_LOOKBACK_DAYS,
  RECENT_LOOKBACK_BARS,
  DEFAULT_RECENT_TF,
  INTRADAY_LOOKBACK_DAYS,
  INTRADAY_LOOKBACK_BARS,
  DEFAULT_INTRADAY_TF,
  SIGNAL_LOOKBACK_DAYS,
  SIGNAL_LOOKBACK_BARS,
  DEFAULT_SIGNAL_TF,
  MIN_LOOKBACK_BARS,

  // Zone analysis
  DEFAULT_SWING_WINDOW,
  DEFAULT_ATR_PERIOD,
  DEFAULT_CLUSTER_MULTIPLIER,
  DEFAULT_REACTION_LOOKAHEAD,
  DEFAULT_MIN_TOUCHES,
  DEFAULT_MIN_SCORE,
  DEFAULT_RECENT_BARS,
  DEFAULT_RECENCY_RECENT,
  DEFAULT_RECENCY_MID,
  DEFAULT_WEIGHT_RECENT,
  DEFAULT_WEIGHT_MID,
  DEFAULT_WEIGHT_OLD,

  // Pattern detection
  DEFAULT_TREND_BARS,
  DEFAULT_TREND_MIN_ABOVE,
  DEFAULT_PIVOT_LOOKBACK,
  DEFAULT_IMPULSE_BARS,
  DEFAULT_FLAG_BARS,
  DEFAULT_BREAKOUT_LOOKBACK,
  DEFAULT_FLAG_ATR_K,
  DEFAULT_FLAG_PCT_K,
  DEFAULT_VOL_MULT,
  DEFAULT_TRAILING_ATR_K,

  // Relaxed
  RELAXED_LOOKBACK_DAYS,
  RELAXED_MIN_TOUCHES,
  RELAXED_MIN_SCORE,
  RELAXED_RECENT_BARS,
  RELAXED_SWING_WINDOW,
  RELAXED_CLUSTER_MULTIPLIER,

  // Live
  LIVE_MIN_INTERVAL_MS,
  ALERT_COOLDOWN_MS,

  // Entry levels
  DEFAULT_ZONE_FILL_K,
  DEFAULT_BREAKOUT_K,
  DEFAULT_STRUCTURAL_K,
  DEFAULT_VOLATILITY_K,
  DEFAULT_TP_ATR_K,
  DEFAULT_MIN_STOP_ATR_K,
  DEFAULT_MIN_TP2_ATR_K,
  DEFAULT_MAX_LEVEL_DISTANCE_ATR,

  // Indicatori
  DEFAULT_EMA_FAST,
  DEFAULT_EMA_SLOW,
  DEFAULT_VOL_MA_PERIOD,
  PRICE_EPS_FACTOR,
  MIN_EPS,
  MIN_CANDLES_FOR_PATTERN,
};
