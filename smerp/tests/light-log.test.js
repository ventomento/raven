// lightlog.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { LightLog } from "../src/log/light-log.js";

test("debugLog and info are ignored when debug=false", () => {
  const logger = new LightLog({ debug: false });

  logger.debugLog("debug message");
  logger.info("info message");

  assert.equal(logger.getLogs().length, 0);
});

test("debugLog and info are stored when debug=true", () => {
  const logger = new LightLog({ debug: true });

  logger.debugLog("debug message");
  logger.info("info message");

  const logs = logger.getLogs();

  assert.equal(logs.length, 2);

  assert.equal(logs[0].level, "DEBUG");
  assert.equal(logs[0].message, "debug message");

  assert.equal(logs[1].level, "INFO");
  assert.equal(logs[1].message, "info message");
});

test("error logs are always stored", () => {
  const logger = new LightLog({ debug: false });

  logger.error("Something failed");

  const logs = logger.getLogs();

  assert.equal(logs.length, 1);
  assert.equal(logs[0].level, "ERROR");
  assert.equal(logs[0].message, "Something failed");
});

test("structured objects are stored correctly", () => {
  const logger = new LightLog({ debug: true });

  logger.info("User login", {
    userId: 123,
    role: "admin",
  });

  const log = logger.getLogs()[0];

  assert.deepEqual(log.data, {
    userId: 123,
    role: "admin",
  });
});

test("Error objects are normalized", () => {
  const logger = new LightLog({ debug: true });

  const err = new Error("Boom");

  logger.error("Unhandled exception", err);

  const log = logger.getLogs()[0];

  assert.equal(log.data.name, "Error");
  assert.equal(log.data.message, "Boom");

  assert.ok(typeof log.data.stack === "string");
});

test("log entries are capped at 100", () => {
  const logger = new LightLog({ debug: true });

  for (let i = 0; i < 105; i++) {
    logger.info(`message-${i}`);
  }

  const logs = logger.getLogs();

  assert.equal(logs.length, 100);

  // First 5 should be removed
  assert.equal(logs[0].message, "message-5");

  // Last should remain
  assert.equal(logs[99].message, "message-104");
});

test("clear removes all log entries", () => {
  const logger = new LightLog({ debug: true });

  logger.info("hello");
  logger.error("oops");

  assert.equal(logger.getLogs().length, 2);

  logger.clear();

  assert.equal(logger.getLogs().length, 0);
});

test("timestamps are valid ISO strings", () => {
  const logger = new LightLog({ debug: true });

  logger.info("test");

  const log = logger.getLogs()[0];

  const date = new Date(log.timestamp);

  assert.equal(Number.isNaN(date.getTime()), false);
});