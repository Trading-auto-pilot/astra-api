// modules/fmpRateLimiter.js
"use strict";

const MAX_TOKENS        = 250;
const REFILL_PER_SEC    = 4;          // 4 token/sec → 240/min (conservativo vs limite 250/min)
const REFILL_PER_MS     = REFILL_PER_SEC / 1000;
const BUCKET_TTL_SECS   = 300;        // TTL chiave Redis se non aggiornata
const MONTHLY_TTL_SECS  = 40 * 24 * 3600; // 40 giorni — copre il mese corrente + buffer

// ---------------------------------------------------------------------------
// Lua script atomico per token bucket (GET → refill → consume → SET)
// Nessuna race condition: tutto eseguito in un singolo round-trip Redis.
// ---------------------------------------------------------------------------
const CONSUME_LUA = `
local key          = KEYS[1]
local max_tokens   = tonumber(ARGV[1])
local refill_ms    = tonumber(ARGV[2])
local now_ms       = tonumber(ARGV[3])
local ttl          = tonumber(ARGV[4])

local raw = redis.call('GET', key)
local tokens, last_ms

if not raw then
  tokens  = max_tokens
  last_ms = now_ms
else
  local ok, data = pcall(cjson.decode, raw)
  if ok and data then
    tokens  = tonumber(data.tokens)  or max_tokens
    last_ms = tonumber(data.last_ms) or now_ms
  else
    tokens  = max_tokens
    last_ms = now_ms
  end
end

local elapsed = now_ms - last_ms
if elapsed > 0 then
  tokens  = math.min(max_tokens, tokens + elapsed * refill_ms)
  last_ms = now_ms
end

if tokens < 1 then
  redis.call('SET', key, cjson.encode({tokens=tokens, last_ms=last_ms}), 'EX', ttl)
  return 0
end

tokens = tokens - 1
redis.call('SET', key, cjson.encode({tokens=tokens, last_ms=last_ms}), 'EX', ttl)
return 1
`;

class FmpRateLimiter {
  /**
   * @param {object} opts
   * @param {object} opts.bus    RedisBus condiviso
   * @param {object} opts.logger Logger condiviso
   */
  constructor({ bus, logger }) {
    this.bus    = bus;
    this.logger = logger;
  }

  _bucketKey() {
    return this.bus.key("fmp", "token-bucket");
  }

  _monthlyKey() {
    const d  = new Date();
    const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    return this.bus.key("fmp", "monthly", ym);
  }

  /**
   * Tenta di consumare 1 token dal bucket FMP.
   * Ritorna true se la chiamata è autorizzata, false se il bucket è esaurito.
   * Fail-open: se Redis non è disponibile lascia passare la chiamata.
   */
  async tryConsume() {
    if (!this.bus?.pub?.isOpen) {
      this.logger.warning("[FmpRateLimiter] Redis non disponibile — rate limit bypassato (fail-open)");
      return true;
    }

    try {
      const result = await this.bus.pub.eval(CONSUME_LUA, {
        keys:      [this._bucketKey()],
        arguments: [
          String(MAX_TOKENS),
          String(REFILL_PER_MS),
          String(Date.now()),
          String(BUCKET_TTL_SECS),
        ],
      });

      if (Number(result) === 1) {
        // Incrementa contatore mensile (fire-and-forget)
        const mk = this._monthlyKey();
        this.bus.pub.incr(mk).catch(() => {});
        this.bus.pub.expire(mk, MONTHLY_TTL_SECS).catch(() => {});
        return true;
      }

      this.logger.warning("[FmpRateLimiter] Token bucket esaurito — chiamata FMP rifiutata");
      return false;
    } catch (err) {
      this.logger.warning(`[FmpRateLimiter] Errore Lua eval: ${err.message} — fail-open`);
      return true;
    }
  }

  /**
   * Ritorna lo stato corrente del bucket e il contatore mensile.
   */
  async getStatus() {
    if (!this.bus?.pub?.isOpen) return null;
    try {
      const [bucketRaw, monthlyRaw] = await Promise.all([
        this.bus.pub.get(this._bucketKey()),
        this.bus.pub.get(this._monthlyKey()),
      ]);

      let tokens = MAX_TOKENS;
      if (bucketRaw) {
        try {
          const parsed = JSON.parse(bucketRaw);
          tokens = Math.floor(parsed.tokens ?? MAX_TOKENS);
        } catch { /* usa default */ }
      }

      return {
        tokens,
        maxTokens:        MAX_TOKENS,
        refillRatePerSec: REFILL_PER_SEC,
        monthlyCallCount: parseInt(monthlyRaw ?? "0", 10),
      };
    } catch {
      return null;
    }
  }
}

module.exports = { FmpRateLimiter };
