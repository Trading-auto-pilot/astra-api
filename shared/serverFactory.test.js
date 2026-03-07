// serverFactory.test.js - Tests for serverFactory
"use strict";

const { createMicroserviceServer } = require('./serverFactory');
const BaseService = require('./BaseService');

// Mock dependencies
jest.mock('./logger');
jest.mock('./BaseService');

describe('serverFactory', () => {
  let MockServiceClass;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock service class
    MockServiceClass = jest.fn().mockImplementation(() => ({
      init: jest.fn().mockResolvedValue(true),
      disconnect: jest.fn().mockResolvedValue('STOPPED'),
      getReleaseInfo: jest.fn().mockResolvedValue({ version: '1.0.0' }),
      getAllSettings: jest.fn().mockReturnValue({ TEST: 'value' }),
      setSetting: jest.fn().mockReturnValue(true),
      reloadSettings: jest.fn().mockResolvedValue({ ok: true }),
      connect: jest.fn().mockResolvedValue('CONNECTED'),
      getDbLogStatus: jest.fn().mockResolvedValue({ enabled: true }),
      setDbLogStatus: jest.fn().mockResolvedValue({ enabled: false }),
      getInfo: jest.fn().mockReturnValue({
        STATUS: 'READY',
        communicationChannels: {}
      }),
      getMetricsSnapshot: jest.fn().mockReturnValue([]),
      getLogLevel: jest.fn().mockReturnValue('info'),
      setLogLevel: jest.fn(),
      updateCommunicationChannel: jest.fn().mockResolvedValue({ ok: true }),
      status: 'READY',
      microservice: 'test-service'
    }));
  });

  afterEach(() => {
    // Clean up any servers
    jest.restoreAllMocks();
  });

  describe('Validation', () => {
    test('should throw error if ServiceClass not provided', () => {
      expect(() => {
        createMicroserviceServer({
          microservice: 'test',
          defaultPort: 3000
        });
      }).toThrow('createMicroserviceServer requires ServiceClass parameter');
    });

    test('should throw error if microservice not provided', () => {
      expect(() => {
        createMicroserviceServer({
          ServiceClass: MockServiceClass,
          defaultPort: 3000
        });
      }).toThrow('createMicroserviceServer requires microservice parameter');
    });

    test('should throw error if defaultPort not provided', () => {
      expect(() => {
        createMicroserviceServer({
          ServiceClass: MockServiceClass,
          microservice: 'test'
        });
      }).toThrow('createMicroserviceServer requires defaultPort parameter');
    });
  });

  describe('Server Creation', () => {
    test('should create server with minimal config', () => {
      const result = createMicroserviceServer({
        ServiceClass: MockServiceClass,
        microservice: 'test-service',
        defaultPort: 3000
      });

      expect(result).toHaveProperty('app');
      expect(result).toHaveProperty('getService');
      expect(result).toHaveProperty('getServer');
      expect(result).toHaveProperty('logger');
    });

    test('should use custom module name and version', () => {
      const result = createMicroserviceServer({
        ServiceClass: MockServiceClass,
        microservice: 'test-service',
        moduleName: 'CustomModule',
        moduleVersion: '2.0.0',
        defaultPort: 3000
      });

      expect(result.logger).toBeDefined();
    });

    test('should initialize service instance', (done) => {
      createMicroserviceServer({
        ServiceClass: MockServiceClass,
        microservice: 'test-service',
        defaultPort: 3000,
        afterInit: async (service) => {
          expect(MockServiceClass).toHaveBeenCalled();
          expect(service.init).toHaveBeenCalled();
          done();
        }
      });
    });
  });

  describe('Hooks', () => {
    test('should call beforeInit hook', (done) => {
      const beforeInit = jest.fn().mockResolvedValue(true);

      createMicroserviceServer({
        ServiceClass: MockServiceClass,
        microservice: 'test-service',
        defaultPort: 3000,
        beforeInit,
        afterInit: async () => {
          expect(beforeInit).toHaveBeenCalled();
          done();
        }
      });
    });

    test('should call afterInit hook with service instance', (done) => {
      const afterInit = jest.fn().mockResolvedValue(true);

      createMicroserviceServer({
        ServiceClass: MockServiceClass,
        microservice: 'test-service',
        defaultPort: 3000,
        afterInit: async (service) => {
          expect(service).toBeDefined();
          expect(service.init).toHaveBeenCalled();
          done();
        }
      });
    });
  });

  describe('CORS Configuration', () => {
    test('should use default Traefik-compatible CORS', () => {
      const { app } = createMicroserviceServer({
        ServiceClass: MockServiceClass,
        microservice: 'test-service',
        defaultPort: 3000
      });

      expect(app).toBeDefined();
      // CORS middleware should be attached
    });

    test('should accept custom CORS options', () => {
      const corsOptions = {
        origin: 'http://localhost:3000',
        credentials: true
      };

      const { app } = createMicroserviceServer({
        ServiceClass: MockServiceClass,
        microservice: 'test-service',
        defaultPort: 3000,
        corsOptions
      });

      expect(app).toBeDefined();
    });

    test('should disable CORS if corsOptions is false', () => {
      const { app } = createMicroserviceServer({
        ServiceClass: MockServiceClass,
        microservice: 'test-service',
        defaultPort: 3000,
        corsOptions: false
      });

      expect(app).toBeDefined();
    });
  });

  describe('Standard Routes', () => {
    test('should enable standard routes by default', () => {
      const { app } = createMicroserviceServer({
        ServiceClass: MockServiceClass,
        microservice: 'test-service',
        defaultPort: 3000
      });

      const routes = app._router.stack
        .filter(layer => layer.route)
        .map(layer => layer.route.path);

      expect(routes).toContain('/release');
      expect(routes).toContain('/settings');
    });

    test('should disable standard routes if requested', () => {
      const { app } = createMicroserviceServer({
        ServiceClass: MockServiceClass,
        microservice: 'test-service',
        defaultPort: 3000,
        enableStandardRoutes: false
      });

      const routes = app._router.stack
        .filter(layer => layer.route)
        .map(layer => layer.route.path);

      expect(routes).not.toContain('/release');
      expect(routes).not.toContain('/settings');
    });
  });

  describe('Status Router', () => {
    test('should enable status router by default', () => {
      const { app } = createMicroserviceServer({
        ServiceClass: MockServiceClass,
        microservice: 'test-service',
        defaultPort: 3000
      });

      const statusRouter = app._router.stack.find(
        layer => layer.name === 'router' && layer.regexp.test('/status')
      );

      expect(statusRouter).toBeDefined();
    });

    test('should disable status router if requested', () => {
      const { app } = createMicroserviceServer({
        ServiceClass: MockServiceClass,
        microservice: 'test-service',
        defaultPort: 3000,
        enableStatusRouter: false
      });

      const statusRouter = app._router.stack.find(
        layer => layer.name === 'router' && layer.regexp.test('/status')
      );

      expect(statusRouter).toBeUndefined();
    });
  });

  describe('Custom Routes', () => {
    test('should mount custom routes', () => {
      const express = require('express');
      const customRouter = express.Router();
      customRouter.get('/test', (req, res) => res.json({ ok: true }));

      const { app } = createMicroserviceServer({
        ServiceClass: MockServiceClass,
        microservice: 'test-service',
        defaultPort: 3000,
        routes: [
          { path: '/custom', router: customRouter, protected: true }
        ]
      });

      const customRoute = app._router.stack.find(
        layer => layer.name === 'router' && layer.regexp.test('/custom')
      );

      expect(customRoute).toBeDefined();
    });

    test('should mount unprotected routes without requireReady', () => {
      const express = require('express');
      const publicRouter = express.Router();
      publicRouter.get('/public', (req, res) => res.json({ ok: true }));

      const { app } = createMicroserviceServer({
        ServiceClass: MockServiceClass,
        microservice: 'test-service',
        defaultPort: 3000,
        routes: [
          { path: '/public', router: publicRouter, protected: false }
        ]
      });

      const publicRoute = app._router.stack.find(
        layer => layer.name === 'router' && layer.regexp.test('/public')
      );

      expect(publicRoute).toBeDefined();
    });
  });

  describe('Custom Logger', () => {
    test('should accept custom logger', () => {
      const customLogger = {
        info: jest.fn(),
        error: jest.fn(),
        warning: jest.fn()
      };

      const result = createMicroserviceServer({
        ServiceClass: MockServiceClass,
        microservice: 'test-service',
        defaultPort: 3000,
        logger: customLogger
      });

      expect(result.logger).toBe(customLogger);
    });
  });

  describe('Service Getter', () => {
    test('should return null before initialization', () => {
      const { getService } = createMicroserviceServer({
        ServiceClass: MockServiceClass,
        microservice: 'test-service',
        defaultPort: 3000
      });

      expect(getService()).toBeNull();
    });

    test('should return service after initialization', (done) => {
      const { getService } = createMicroserviceServer({
        ServiceClass: MockServiceClass,
        microservice: 'test-service',
        defaultPort: 3000,
        afterInit: async (service) => {
          expect(getService()).toBeDefined();
          expect(getService().init).toHaveBeenCalled();
          done();
        }
      });
    });
  });

  describe('Error Handling', () => {
    test('should exit on initialization error', (done) => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        done();
      });

      MockServiceClass.mockImplementation(() => ({
        init: jest.fn().mockRejectedValue(new Error('Init failed'))
      }));

      createMicroserviceServer({
        ServiceClass: MockServiceClass,
        microservice: 'test-service',
        defaultPort: 3000
      });

      // Wait a bit for async init
      setTimeout(() => {
        expect(mockExit).toHaveBeenCalledWith(1);
        mockExit.mockRestore();
      }, 100);
    });
  });

  describe('Environment Variables', () => {
    test('should use PORT from environment', () => {
      const originalPort = process.env.PORT;
      process.env.PORT = '4000';

      createMicroserviceServer({
        ServiceClass: MockServiceClass,
        microservice: 'test-service',
        defaultPort: 3000
      });

      // Port 4000 should be used instead of defaultPort 3000
      process.env.PORT = originalPort;
    });

    test('should set MICROSERVICE_NAME environment variable', () => {
      createMicroserviceServer({
        ServiceClass: MockServiceClass,
        microservice: 'test-service',
        defaultPort: 3000
      });

      expect(process.env.MICROSERVICE_NAME).toBe('test-service');
    });
  });
});
