"use strict";

const { randomUUID } = require("crypto");

function nowIso() {
  return new Date().toISOString();
}

class RecomputeTaskManager {
  constructor({ maxTasks = 500 } = {}) {
    this.maxTasks = Number.isFinite(maxTasks) && maxTasks > 0 ? Math.floor(maxTasks) : 500;
    this.tasks = [];
    this.byId = new Map();
    this.runningTaskId = null;
  }

  createTask({ reason = "manual", trigger = "api" } = {}) {
    if (this.runningTaskId) {
      const running = this.byId.get(this.runningTaskId) || null;
      return {
        started: false,
        task: running,
      };
    }

    const task = {
      taskId: randomUUID(),
      kind: "LIQUIDITY_RECOMPUTE",
      status: "RUNNING",
      reason,
      trigger,
      createdAt: nowIso(),
      startedAt: nowIso(),
      endedAt: null,
      durationMs: null,
      currentStep: "TASK.STARTED",
      progress: [
        {
          ts: nowIso(),
          step: "TASK.STARTED",
          detail: "Task created",
        },
      ],
      result: null,
      error: null,
    };

    this.tasks.unshift(task);
    this.byId.set(task.taskId, task);
    this.runningTaskId = task.taskId;
    this.trim();
    return {
      started: true,
      task,
    };
  }

  completeTask(taskId, result) {
    const task = this.byId.get(taskId);
    if (!task) return null;
    task.status = "SUCCESS";
    task.currentStep = "TASK.COMPLETED";
    task.progress.push({
      ts: nowIso(),
      step: "TASK.COMPLETED",
      detail: "Recompute completed",
    });
    task.result = result || null;
    task.endedAt = nowIso();
    task.durationMs = Date.now() - new Date(task.startedAt).getTime();
    if (this.runningTaskId === taskId) this.runningTaskId = null;
    return task;
  }

  failTask(taskId, err) {
    const task = this.byId.get(taskId);
    if (!task) return null;
    task.status = "FAILED";
    task.currentStep = "TASK.FAILED";
    task.progress.push({
      ts: nowIso(),
      step: "TASK.FAILED",
      detail: err ? String(err.message || err) : "unknown error",
    });
    task.error = err ? String(err.message || err) : "unknown error";
    task.endedAt = nowIso();
    task.durationMs = Date.now() - new Date(task.startedAt).getTime();
    if (this.runningTaskId === taskId) this.runningTaskId = null;
    return task;
  }

  getTask(taskId) {
    return this.byId.get(String(taskId)) || null;
  }

  updateStep(taskId, step, detail) {
    const task = this.byId.get(String(taskId));
    if (!task || task.status !== "RUNNING") return null;
    const safeStep = String(step || "").trim() || "TASK.PROGRESS";
    const safeDetail = detail == null ? "" : String(detail);
    task.currentStep = safeStep;
    task.progress.push({
      ts: nowIso(),
      step: safeStep,
      detail: safeDetail,
    });
    if (task.progress.length > 200) {
      task.progress = task.progress.slice(task.progress.length - 200);
    }
    return task;
  }

  getRunningTasks() {
    return this.tasks.filter((task) => task.status === "RUNNING");
  }

  listTasks({ status, limit = 50 } = {}) {
    const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(500, Number(limit))) : 50;
    const normalizedStatus = status ? String(status).toUpperCase() : null;
    const items = this.tasks.filter((task) => {
      if (!normalizedStatus) return true;
      return task.status === normalizedStatus;
    });
    return items.slice(0, safeLimit);
  }

  trim() {
    if (this.tasks.length <= this.maxTasks) return;
    const toDrop = this.tasks.slice(this.maxTasks);
    this.tasks = this.tasks.slice(0, this.maxTasks);
    toDrop.forEach((task) => this.byId.delete(task.taskId));
  }
}

module.exports = RecomputeTaskManager;
