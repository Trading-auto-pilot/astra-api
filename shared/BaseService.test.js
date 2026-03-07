// BaseService.test.js - Tests for BaseService
"use strict";

const BaseService = require("./BaseService");
const path = require("path");
const fs = require("fs").promises;

// =========================================================
// MOCK SETUP
// =========================================================

// Mock process.exit to prevent tests from exiting
const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
  throw new Error(`process.exit called with ${code}`);
});

// Mock dependencies
jest.mock("./logger", () => {
  return jest.fn(() => ({
    trace: jest.fn(),
    log: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    setLevel: jest.fn(),
    getLevel: jest.fn(() => "info"),
    getDbLogStatus: jest.fn(() => false),
    setDbLogStatus: jest.fn((status) => ({ success: true, setDbLogStatus: status })),
    attachBus: jest.fn(),
    forModule: jest.fn(function (moduleName) {
      return this;
    }),
  }));
});

jest.mock("./redisBus", () => ({
  RedisBus: jest.fn().mockImplementation(function() {
    const mockBus = {
      connect: jest.fn().mockResolvedValue(true),
      close: jest.fn().mockResolvedValue(true),
      publish: jest.fn().mockResolvedValue(1),
      subscribe: jest.fn().mockResolvedValue(true),
      setLogger: jest.fn(function() { return this; }),
      setChannelConfig: jest.fn(),
      applyChannels: jest.fn(),
      status: jest.fn(() => ({ connected: true })),
    };
    return mockBus;
  }),
}));

jest.mock("./loadSettings", () => ({
  initializeSettings: jest.fn().mockResolvedValue(true),
  getSetting: jest.fn((key) => {
    if (key === "PROCESS_DELAY_BETWEEN_MESSAGES") return "1000";
    return null;
  }),
  reloadSettings: jest.fn().mockResolvedValue(true),
  getAllSettings: jest.fn(() => ({ PROCESS_DELAY_BETWEEN_MESSAGES: "1000" })),
  setSetting: jest.fn((key, value) => true),
}));

jest.mock("./eventsManifestRegistry", () => ({
  publishEventsManifest: jest.fn().mockResolvedValue(true),
}));

jest.mock("./helpers", () => ({
  asBool: jest.fn((val, def) => {
    if (val === "true") return true;
    if (val === "false") return false;
    return def;
  }),
  asInt: jest.fn((val, def) => {
    const num = parseInt(val);
    return isNaN(num) ? def : num;
  }),
}));

// =========================================================
// TEST SUITES
// =========================================================

describe("BaseService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExit.mockClear();
  });

  afterAll(() => {
    mockExit.mockRestore();
  });

  // =========================================================
  // CONSTRUCTOR TESTS
  // =========================================================

  describe("Constructor", () => {
    test("should throw error if microservice name is not provided", () => {
      expect(() => {
        new BaseService({});
      }).toThrow("BaseService requires 'microservice' parameter in config");
    });

    test("should initialize with minimal config", () => {
      const service = new BaseService({ microservice: "test-service" });

      expect(service.microservice).toBe("test-service");
      expect(service.moduleName).toBe("main");
      expect(service.moduleVersion).toBe("0.1.0");
      expect(service.status).toBe("STARTING");
      expect(service.env).toBe("DEV");
    });

    test("should initialize with full config", () => {
      const service = new BaseService({
        microservice: "my-service",
        moduleName: "custom-module",
        moduleVersion: "2.0.0",
        defaultPort: 4000,
      });

      expect(service.microservice).toBe("my-service");
      expect(service.moduleName).toBe("custom-module");
      expect(service.moduleVersion).toBe("2.0.0");
      expect(service._defaultPort).toBe(4000);
    });

    test("should initialize standard service URLs", () => {
      const service = new BaseService({ microservice: "test-service" });

      expect(service.dbmanagerUrl).toBe("http://dbmanager:3002");
      expect(service.cachemanagerUrl).toBe("http://cachemanager:3006");
      expect(service.schedulerUrl).toBe("http://scheduler:3014");
    });

    test("should respect environment variable overrides", () => {
      process.env.DBMANAGER_URL = "http://custom-db:5000";
      const service = new BaseService({ microservice: "test-service" });

      expect(service.dbmanagerUrl).toBe("http://custom-db:5000");

      delete process.env.DBMANAGER_URL;
    });

    test("should initialize Redis channel names with environment prefix", () => {
      process.env.ENV = "PAPER";
      const service = new BaseService({ microservice: "my-service" });

      expect(service.redisTelemetryChannel).toBe("PAPER.my-service.telemetry");
      expect(service.redisStatusChannel).toBe("PAPER.my-service.status");
      expect(service.redisDataChannel).toBe("PAPER.my-service.data");
      expect(service.redisLogsChannel).toBe("PAPER.my-service.logs");
      expect(service.redisEventsChannel).toBe("PAPER.my-service.events");

      delete process.env.ENV;
    });

    test("should initialize communication channels configuration", () => {
      const service = new BaseService({ microservice: "test-service" });

      expect(service.communicationChannels).toEqual({
        telemetry: { on: true, params: { intervalsMs: 1000 } },
        metrics: { on: true, params: { intervalsMs: 1000 } },
        data: { on: true, params: { intervalsMs: 0 } },
        logs: { on: true, params: { intervalsMs: 0 } },
        events: { on: true, params: { intervalsMs: 0 } },
      });
    });

    test("should initialize RedisBus instance", () => {
      const service = new BaseService({ microservice: "test-service" });

      expect(service.bus).toBeDefined();
      expect(service.bus.setLogger).toHaveBeenCalled();
    });

    test("should initialize logger instance", () => {
      const service = new BaseService({ microservice: "test-service" });

      expect(service.logger).toBeDefined();
      expect(service.logger.info).toBeDefined();
    });

    test("should initialize empty metrics array", () => {
      const service = new BaseService({ microservice: "test-service" });

      expect(service.metrics).toEqual([]);
    });

    test("should support additional service URLs", () => {
      const service = new BaseService({
        microservice: "test-service",
        additionalServiceUrls: {
          customServiceUrl: "http://custom:9000",
        },
      });

      expect(service.customServiceUrl).toBe("http://custom:9000");
    });
  });

  // =========================================================
  // INITIALIZATION TESTS
  // =========================================================

  describe("Initialization", () => {
    test("should initialize successfully", async () => {
      const service = new BaseService({ microservice: "test-service" });

      await service.init();

      expect(service.status).toBe("READY");
      expect(service.statusDetails).toBe("Initialization complete");
      expect(service.bus.connect).toHaveBeenCalled();
      expect(service.logger.attachBus).toHaveBeenCalled();
    });

    test("should call _onInit hook during initialization", async () => {
      class TestService extends BaseService {
        async _onInit() {
          this.customInitCalled = true;
        }
      }

      const service = new TestService({ microservice: "test-service" });
      await service.init();

      expect(service.customInitCalled).toBe(true);
    });

    test("should publish events manifest during init", async () => {
      const { publishEventsManifest } = require("./eventsManifestRegistry");
      const service = new BaseService({ microservice: "test-service" });

      await service.init();

      expect(publishEventsManifest).toHaveBeenCalledWith(
        expect.objectContaining({
          bus: service.bus,
          logger: service.logger,
          microserviceName: "test-service",
        })
      );
    });

    test("should load settings from DB during init", async () => {
      const { initializeSettings } = require("./loadSettings");
      const service = new BaseService({ microservice: "test-service" });

      await service.init();

      expect(initializeSettings).toHaveBeenCalledWith(service.dbmanagerUrl);
    });

    test("should set delayBetweenMessages from settings", async () => {
      const service = new BaseService({ microservice: "test-service" });

      await service.init();

      expect(service.delayBetweenMessages).toBe(1000); // From mock getSetting
    });

    test("should publish status updates during init", async () => {
      const service = new BaseService({ microservice: "test-service" });

      await service.init();

      expect(service.bus.publish).toHaveBeenCalledWith(
        service.redisStatusChannel,
        expect.objectContaining({ status: "STARTING" })
      );

      expect(service.bus.publish).toHaveBeenCalledWith(
        service.redisStatusChannel,
        expect.objectContaining({ status: "READY" })
      );
    });

    test("should handle DB initialization failure", async () => {
      const { initializeSettings } = require("./loadSettings");
      initializeSettings.mockResolvedValueOnce(false);

      const service = new BaseService({ microservice: "test-service" });

      // Should call process.exit(1) when DB fails
      await expect(service.init()).rejects.toThrow('process.exit called with 1');

      expect(service.status).toBe("ERROR");
      expect(service.statusDetails).toBe("DB unreachable");
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    test("should handle Redis connection failure gracefully", async () => {
      const service = new BaseService({ microservice: "test-service" });
      service.bus.connect = jest.fn().mockRejectedValue(new Error("Connection failed"));

      await service.init();

      // Should continue initialization despite Redis failure
      expect(service.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Redis connection failed")
      );
    });

    test("should handle _onInit hook failure", async () => {
      class TestService extends BaseService {
        async _onInit() {
          throw new Error("Custom init failed");
        }
      }

      const service = new TestService({ microservice: "test-service" });

      await expect(service.init()).rejects.toThrow("Custom init failed");
      expect(service.status).toBe("ERROR");
    });

    test("should skip DB settings if disabled", async () => {
      const { initializeSettings } = require("./loadSettings");
      const service = new BaseService({
        microservice: "test-service",
        enableDbSettings: false,
      });

      await service.init();

      expect(initializeSettings).not.toHaveBeenCalled();
      expect(service.status).toBe("READY");
    });

    test("should skip events manifest if disabled", async () => {
      const { publishEventsManifest } = require("./eventsManifestRegistry");
      const service = new BaseService({
        microservice: "test-service",
        enableEventsManifest: false,
      });

      await service.init();

      expect(publishEventsManifest).not.toHaveBeenCalled();
    });
  });

  // =========================================================
  // RELEASE INFO TESTS
  // =========================================================

  describe("Release Info", () => {
    test("should load release.json if found", async () => {
      const mockReleaseData = {
        version: "1.2.3",
        microservice: "test-service",
        lastUpdate: "2024-01-15",
        note: ["Initial release"],
      };

      // Mock fs.access and fs.readFile
      const originalAccess = fs.access;
      const originalReadFile = fs.readFile;

      fs.access = jest.fn().mockResolvedValue(true);
      fs.readFile = jest.fn().mockResolvedValue(JSON.stringify(mockReleaseData));

      const service = new BaseService({ microservice: "test-service" });
      const releaseInfo = await service.getReleaseInfo();

      expect(releaseInfo).toEqual(mockReleaseData);

      // Restore
      fs.access = originalAccess;
      fs.readFile = originalReadFile;
    });

    test("should return default if release.json not found", async () => {
      const originalAccess = fs.access;
      fs.access = jest.fn().mockRejectedValue(new Error("Not found"));

      const service = new BaseService({ microservice: "test-service" });
      const releaseInfo = await service.getReleaseInfo();

      expect(releaseInfo).toEqual({
        lastUpdate: null,
        version: "unknown",
        microservice: "test-service",
        note: ["release.json not found"],
      });

      fs.access = originalAccess;
    });

    test("should cache release info after first load", async () => {
      const originalAccess = fs.access;
      const originalReadFile = fs.readFile;

      fs.access = jest.fn().mockResolvedValue(true);
      fs.readFile = jest.fn().mockResolvedValue(JSON.stringify({ version: "1.0.0" }));

      const service = new BaseService({ microservice: "test-service" });

      const info1 = await service.getReleaseInfo();
      const info2 = await service.getReleaseInfo();

      expect(info1).toBe(info2); // Same object reference
      expect(fs.readFile).toHaveBeenCalledTimes(1); // Only called once

      fs.access = originalAccess;
      fs.readFile = originalReadFile;
    });
  });

  // =========================================================
  // SETTINGS MANAGEMENT TESTS
  // =========================================================

  describe("Settings Management", () => {
    test("should reload settings", async () => {
      const { reloadSettings } = require("./loadSettings");
      const service = new BaseService({ microservice: "test-service" });

      const result = await service.reloadSettings();

      expect(reloadSettings).toHaveBeenCalledWith(service.dbmanagerUrl);
      expect(result.ok).toBe(true);
    });

    test("should call _onSettingsReload hook if defined", async () => {
      class TestService extends BaseService {
        async _onSettingsReload() {
          this.settingsReloadCalled = true;
        }
      }

      const service = new TestService({ microservice: "test-service" });
      await service.reloadSettings();

      expect(service.settingsReloadCalled).toBe(true);
    });

    test("should throw error if reload fails", async () => {
      const { reloadSettings } = require("./loadSettings");
      reloadSettings.mockResolvedValueOnce(false);

      const service = new BaseService({ microservice: "test-service" });

      await expect(service.reloadSettings()).rejects.toThrow("reloadSettings failed");
    });

    test("should get all settings", () => {
      const service = new BaseService({ microservice: "test-service" });
      const settings = service.getAllSettings();

      expect(settings).toEqual({ PROCESS_DELAY_BETWEEN_MESSAGES: "1000" });
    });

    test("should set a setting", () => {
      const { setSetting } = require("./loadSettings");
      const service = new BaseService({ microservice: "test-service" });

      service.setSetting("TEST_KEY", "test_value");

      expect(setSetting).toHaveBeenCalledWith("TEST_KEY", "test_value");
    });
  });

  // =========================================================
  // METRICS TESTS
  // =========================================================

  describe("Metrics", () => {
    test("should push metric with timestamp", () => {
      const service = new BaseService({ microservice: "test-service" });

      service.pushMetric({ type: "test", value: 100 });

      expect(service.metrics).toHaveLength(1);
      expect(service.metrics[0].type).toBe("test");
      expect(service.metrics[0].value).toBe(100);
      expect(service.metrics[0].ts).toBeDefined();
    });

    test("should limit metrics array to 2000 items", () => {
      const service = new BaseService({ microservice: "test-service" });

      // Push 2500 metrics
      for (let i = 0; i < 2500; i++) {
        service.pushMetric({ index: i });
      }

      expect(service.metrics).toHaveLength(2000);
      expect(service.metrics[0].index).toBe(500); // First 500 removed
    });

    test("should get metrics snapshot", () => {
      const service = new BaseService({ microservice: "test-service" });

      for (let i = 0; i < 150; i++) {
        service.pushMetric({ index: i });
      }

      const snapshot = service.getMetricsSnapshot(50);

      expect(snapshot).toHaveLength(50);
      expect(snapshot[0].index).toBe(100); // Last 50
    });
  });

  // =========================================================
  // COMMUNICATION CHANNELS TESTS
  // =========================================================

  describe("Communication Channels", () => {
    test("should normalize channel configuration", () => {
      const service = new BaseService({ microservice: "test-service" });

      const normalized = service.normalizeChannels({
        telemetry: { on: false, params: { intervalsMs: 2000 } },
      });

      expect(normalized.telemetry.on).toBe(false);
      expect(normalized.telemetry.params.intervalsMs).toBe(2000);
      expect(normalized.metrics.on).toBe(true); // Default
    });

    test("should update communication channels", async () => {
      const service = new BaseService({ microservice: "test-service" });

      const result = await service.updateCommunicationChannel({
        data: { on: false },
      });

      expect(result.ok).toBe(true);
      expect(result.channels.data.on).toBe(false);
      expect(service.bus.setChannelConfig).toHaveBeenCalledWith("data", expect.any(Object));
    });

    test("should call _onChannelUpdate hook if defined", async () => {
      class TestService extends BaseService {
        async _onChannelUpdate(cfg) {
          this.channelUpdateCalled = true;
          this.updatedConfig = cfg;
        }
      }

      const service = new TestService({ microservice: "test-service" });
      await service.updateCommunicationChannel({ metrics: { on: false } });

      expect(service.channelUpdateCalled).toBe(true);
      expect(service.updatedConfig).toBeDefined();
    });
  });

  // =========================================================
  // SERVICE INFO TESTS
  // =========================================================

  describe("Service Info", () => {
    test("should return standardized info", () => {
      const service = new BaseService({
        microservice: "test-service",
        moduleName: "custom",
        moduleVersion: "2.0.0",
      });

      const info = service.getInfo();

      expect(info).toEqual({
        MICROSERVICE: "test-service",
        MODULE_NAME: "custom",
        MODULE_VERSION: "2.0.0",
        STATUS: "STARTING",
        STATUS_DETAILS: null,
        ENV: "DEV",
        communicationChannels: expect.any(Object),
        BusChannels: {
          telemetry: "DEV.test-service.telemetry",
          status: "DEV.test-service.status",
          data: "DEV.test-service.data",
          logs: "DEV.test-service.logs",
          events: "DEV.test-service.events",
        },
      });
    });
  });

  // =========================================================
  // LOGGING CONTROLS TESTS
  // =========================================================

  describe("Logging Controls", () => {
    test("should get log level", () => {
      const service = new BaseService({ microservice: "test-service" });
      const level = service.getLogLevel();

      expect(level).toBe("info");
    });

    test("should set log level", () => {
      const service = new BaseService({ microservice: "test-service" });
      const result = service.setLogLevel("debug");

      expect(service.logger.setLevel).toHaveBeenCalledWith("debug");
      expect(result.level).toBe("debug");
    });

    test("should get DB log status", () => {
      const service = new BaseService({ microservice: "test-service" });
      const status = service.getDbLogStatus();

      expect(service.logger.getDbLogStatus).toHaveBeenCalled();
      expect(status).toBe(false);
    });

    test("should set DB log status", () => {
      const service = new BaseService({ microservice: "test-service" });
      const result = service.setDbLogStatus(true);

      expect(service.logger.setDbLogStatus).toHaveBeenCalledWith(true);
    });
  });

  // =========================================================
  // SHUTDOWN TESTS
  // =========================================================

  describe("Shutdown", () => {
    test("should disconnect gracefully", async () => {
      const service = new BaseService({ microservice: "test-service" });

      const status = await service.disconnect();

      expect(service.bus.close).toHaveBeenCalled();
      expect(status).toBe("STOPPED");
      expect(service.status).toBe("STOPPED");
    });

    test("should call _onShutdown hook", async () => {
      class TestService extends BaseService {
        async _onShutdown() {
          this.shutdownCalled = true;
        }
      }

      const service = new TestService({ microservice: "test-service" });
      await service.disconnect();

      expect(service.shutdownCalled).toBe(true);
    });

    test("should handle shutdown hook errors gracefully", async () => {
      class TestService extends BaseService {
        async _onShutdown() {
          throw new Error("Shutdown failed");
        }
      }

      const service = new TestService({ microservice: "test-service" });
      const status = await service.disconnect();

      expect(service.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Error in shutdown hook"),
        expect.any(Error)
      );
      expect(status).toBe("STOPPED");
    });

    test("should handle bus close errors gracefully", async () => {
      const service = new BaseService({ microservice: "test-service" });
      service.bus.close = jest.fn().mockRejectedValue(new Error("Close failed"));

      const status = await service.disconnect();

      expect(service.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Error closing RedisBus"),
        expect.any(Error)
      );
      expect(status).toBe("STOPPED");
    });

    test("should clear retry timers on shutdown", async () => {
      const service = new BaseService({ microservice: "test-service" });
      service._initRetryTimer = setTimeout(() => {}, 10000);

      await service.disconnect();

      expect(service._initRetryTimer).toBe(null);
    });
  });

  // =========================================================
  // ACCESSOR TESTS
  // =========================================================

  describe("Accessors", () => {
    test("should get bus instance", () => {
      const service = new BaseService({ microservice: "test-service" });
      expect(service.getBus()).toBe(service.bus);
    });

    test("should get logger instance", () => {
      const service = new BaseService({ microservice: "test-service" });
      expect(service.getLogger()).toBe(service.logger);
    });

    test("should get status", () => {
      const service = new BaseService({ microservice: "test-service" });
      expect(service.status).toBe("STARTING");
    });

    test("should get microservice name", () => {
      const service = new BaseService({ microservice: "test-service" });
      expect(service.microservice).toBe("test-service");
    });

    test("should get module name", () => {
      const service = new BaseService({ microservice: "test-service" });
      expect(service.moduleName).toBe("main");
    });

    test("should get module version", () => {
      const service = new BaseService({ microservice: "test-service" });
      expect(service.moduleVersion).toBe("0.1.0");
    });
  });

  // =========================================================
  // INTEGRATION TEST
  // =========================================================

  describe("Integration", () => {
    test("should complete full lifecycle", async () => {
      class TestService extends BaseService {
        constructor() {
          super({ microservice: "integration-test", moduleVersion: "1.0.0" });
          this.data = [];
        }

        async _onInit() {
          this.data.push("initialized");
        }

        async _onShutdown() {
          this.data = [];
        }
      }

      const service = new TestService();

      // Initialize
      await service.init();
      expect(service.status).toBe("READY");
      expect(service.data).toContain("initialized");

      // Use service
      service.pushMetric({ type: "test", value: 42 });
      expect(service.metrics).toHaveLength(1);

      // Shutdown
      await service.disconnect();
      expect(service.status).toBe("STOPPED");
      expect(service.data).toHaveLength(0);
    });
  });
});
