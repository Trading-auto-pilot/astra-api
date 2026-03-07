// statusRouterFactory.test.js - Tests for statusRouterFactory
"use strict";

const express = require('express');
const request = require('supertest');
const buildStatusRouter = require('./statusRouterFactory');

describe('statusRouterFactory', () => {
  let app;
  let mockService;
  let mockLogger;

  beforeEach(() => {
    // Create mock service
    mockService = {
      microservice: 'test-service',
      _microservice: 'test-service',
      getInfo: jest.fn(() => ({
        MICROSERVICE: 'test-service',
        STATUS: 'READY',
        communicationChannels: {
          telemetry: { on: true, params: { intervalsMs: 1000 } },
          metrics: { on: true, params: { intervalsMs: 1000 } },
          data: { on: true, params: { intervalsMs: 0 } },
          logs: { on: true, params: { intervalsMs: 0 } },
          events: { on: true, params: { intervalsMs: 0 } },
        }
      })),
      updateCommunicationChannel: jest.fn(async (cfg) => ({
        ok: true,
        channels: cfg
      })),
      getMetricsSnapshot: jest.fn(() => [
        { ts: Date.now(), type: 'test', value: 100 }
      ]),
      getLogLevel: jest.fn(() => 'info'),
      setLogLevel: jest.fn(),
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warning: jest.fn(),
    };

    // Create Express app with router
    app = express();
    app.use(express.json());
  });

  describe('API Compatibility', () => {
    test('should work with old API (object with service)', async () => {
      app.use('/status', buildStatusRouter({
        service: mockService,
        logger: mockLogger,
        moduleName: 'test'
      }));

      const response = await request(app).get('/status/health');
      expect(response.status).toBe(200);
    });

    test('should work with new API (function getter)', async () => {
      app.use('/status', buildStatusRouter({
        getServiceInstance: () => mockService,
        logger: mockLogger,
        moduleName: 'test'
      }));

      const response = await request(app).get('/status/health');
      expect(response.status).toBe(200);
    });

    test('should work with minimal API (function only)', async () => {
      app.use('/status', buildStatusRouter(() => mockService));

      const response = await request(app).get('/status/health');
      expect(response.status).toBe(200);
    });

    test('should throw error if no service provided', () => {
      expect(() => {
        buildStatusRouter({});
      }).toThrow();
    });
  });

  describe('GET /health', () => {
    beforeEach(() => {
      app.use('/status', buildStatusRouter({
        getServiceInstance: () => mockService,
        logger: mockLogger,
        moduleName: 'TestModule'
      }));
    });

    test('should return OK when service is available', async () => {
      const response = await request(app).get('/status/health');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: 'OK',
        module: 'TestModule'
      });
      expect(response.body.uptime).toBeGreaterThan(0);
    });

    test('should return 503 when service is unavailable', async () => {
      app = express();
      app.use('/status', buildStatusRouter({
        getServiceInstance: () => null,
        logger: mockLogger,
        moduleName: 'TestModule'
      }));

      const response = await request(app).get('/status/health');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('unavailable');
    });
  });

  describe('GET /info', () => {
    beforeEach(() => {
      app.use('/status', buildStatusRouter({
        getServiceInstance: () => mockService,
        logger: mockLogger
      }));
    });

    test('should return service info', async () => {
      const response = await request(app).get('/status/info');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        MICROSERVICE: 'test-service',
        STATUS: 'READY'
      });
      expect(mockService.getInfo).toHaveBeenCalled();
    });

    test('should return 501 if getInfo not implemented', async () => {
      delete mockService.getInfo;

      const response = await request(app).get('/status/info');

      expect(response.status).toBe(501);
      expect(response.body.error).toBe('getInfo() not implemented');
    });

    test('should handle getInfo errors', async () => {
      mockService.getInfo.mockImplementation(() => {
        throw new Error('Info error');
      });

      const response = await request(app).get('/status/info');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Info error');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('GET /communicationChannels', () => {
    beforeEach(() => {
      app.use('/status', buildStatusRouter({
        getServiceInstance: () => mockService,
        logger: mockLogger
      }));
    });

    test('should return communication channels', async () => {
      const response = await request(app).get('/status/communicationChannels');

      expect(response.status).toBe(200);
      expect(response.body.communicationChannels).toMatchObject({
        telemetry: { on: true },
        metrics: { on: true },
        data: { on: true }
      });
    });

    test('should return 404 if channels not available', async () => {
      mockService.getInfo.mockReturnValue({});

      const response = await request(app).get('/status/communicationChannels');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('communicationChannels not available');
    });
  });

  describe('PUT /communicationChannels', () => {
    beforeEach(() => {
      app.use('/status', buildStatusRouter({
        getServiceInstance: () => mockService,
        logger: mockLogger
      }));
    });

    test('should update communication channels', async () => {
      const payload = {
        telemetry: { on: false, params: { intervalsMs: 2000 } }
      };

      const response = await request(app)
        .put('/status/communicationChannels')
        .send(payload);

      expect(response.status).toBe(200);
      expect(mockService.updateCommunicationChannel).toHaveBeenCalledWith({
        telemetry: { on: false, params: { intervalsMs: 2000 } }
      });
    });

    test('should accept payload wrapped in communicationChannels', async () => {
      const payload = {
        communicationChannels: {
          metrics: { on: false, params: { intervalsMs: 5000 } }
        }
      };

      const response = await request(app)
        .put('/status/communicationChannels')
        .send(payload);

      expect(response.status).toBe(200);
    });

    test('should validate on parameter is boolean', async () => {
      const payload = {
        telemetry: { on: 'true', params: { intervalsMs: 1000 } }
      };

      const response = await request(app)
        .put('/status/communicationChannels')
        .send(payload);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('"on" must be boolean');
    });

    test('should validate intervalsMs is non-negative integer', async () => {
      const payload = {
        telemetry: { on: true, params: { intervalsMs: -100 } }
      };

      const response = await request(app)
        .put('/status/communicationChannels')
        .send(payload);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('must be non-negative integer');
    });

    test('should clamp intervalsMs to maxInterval', async () => {
      const payload = {
        telemetry: { on: true, params: { intervalsMs: 999999 } }
      };

      const response = await request(app)
        .put('/status/communicationChannels')
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body.maxAllowedIntervalMs).toBeDefined();
    });

    test('should return 501 if updateCommunicationChannel not implemented', async () => {
      delete mockService.updateCommunicationChannel;

      const response = await request(app)
        .put('/status/communicationChannels')
        .send({ telemetry: { on: false, params: { intervalsMs: 1000 } } });

      expect(response.status).toBe(501);
    });
  });

  describe('GET /metrics', () => {
    beforeEach(() => {
      app.use('/status', buildStatusRouter({
        getServiceInstance: () => mockService,
        logger: mockLogger
      }));
    });

    test('should return metrics snapshot', async () => {
      const response = await request(app).get('/status/metrics');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body[0]).toMatchObject({
        type: 'test',
        value: 100
      });
      expect(mockService.getMetricsSnapshot).toHaveBeenCalledWith(100);
    });

    test('should return 501 if getMetricsSnapshot not implemented', async () => {
      delete mockService.getMetricsSnapshot;

      const response = await request(app).get('/status/metrics');

      expect(response.status).toBe(501);
      expect(response.body.error).toBe('getMetricsSnapshot() not implemented');
    });
  });

  describe('GET /logLevel', () => {
    beforeEach(() => {
      app.use('/status', buildStatusRouter({
        getServiceInstance: () => mockService,
        logger: mockLogger
      }));
    });

    test('should return current log level', async () => {
      const response = await request(app).get('/status/logLevel');

      expect(response.status).toBe(200);
      expect(response.body['test-service']).toBe('info');
      expect(mockService.getLogLevel).toHaveBeenCalled();
    });

    test('should handle missing getLogLevel', async () => {
      delete mockService.getLogLevel;

      const response = await request(app).get('/status/logLevel');

      expect(response.status).toBe(200);
      expect(response.body.service).toBeNull();
    });
  });

  describe('PUT /logLevel', () => {
    beforeEach(() => {
      app.use('/status', buildStatusRouter({
        getServiceInstance: () => mockService,
        logger: mockLogger
      }));
    });

    test('should set log level', async () => {
      const response = await request(app)
        .put('/status/logLevel')
        .send({ logLevel: 'debug' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body['test-service']).toBe('info');
      expect(mockService.setLogLevel).toHaveBeenCalledWith('debug');
    });

    test('should return 400 if logLevel missing', async () => {
      const response = await request(app)
        .put('/status/logLevel')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Missing logLevel');
    });

    test('should return 501 if setLogLevel not implemented', async () => {
      delete mockService.setLogLevel;

      const response = await request(app)
        .put('/status/logLevel')
        .send({ logLevel: 'debug' });

      expect(response.status).toBe(501);
      expect(response.body.success).toBe(false);
    });
  });
});
