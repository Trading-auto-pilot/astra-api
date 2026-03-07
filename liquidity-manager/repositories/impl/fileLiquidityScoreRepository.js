"use strict";

const fs = require("fs").promises;
const path = require("path");
const InMemoryLiquidityScoreRepository = require("./inMemoryLiquidityScoreRepository");

class FileLiquidityScoreRepository extends InMemoryLiquidityScoreRepository {
  constructor({ logger, filePath } = {}) {
    super({ logger });
    this.filePath = filePath || path.resolve(process.cwd(), "data", "liquidity-score-history.json");
  }

  async init() {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this.latest = parsed?.latest || null;
      this.history = Array.isArray(parsed?.history) ? parsed.history : [];
      this.logger?.info?.(`[repository] loaded ${this.history.length} items from ${this.filePath}`);
    } catch (err) {
      if (err?.code !== "ENOENT") {
        this.logger?.warning?.(`[repository] load failed (${this.filePath}): ${err?.message || String(err)}`);
      }
      await this.persist();
    }
    return true;
  }

  async persist() {
    const payload = {
      latest: this.latest,
      history: this.history,
    };
    await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), "utf8");
  }

  async saveSnapshot(snapshot) {
    const saved = await super.saveSnapshot(snapshot);
    await this.persist();
    return saved;
  }

  async prune({ historyDays }) {
    const count = await super.prune({ historyDays });
    await this.persist();
    return count;
  }
}

module.exports = FileLiquidityScoreRepository;

