// LightLog.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { LightLog } from "../src/log/light-log.js";

test("LightLog: debug false should not log anything", () => {
  const log = new LightLog({ debug: false });

  log.info("hello");
  log.warn("warning");
  log.error("error");

  assert.equal(log.getLogs().length, 0);
});

test("LightLog: info and warn should log entries when debug enabled", () => {
  const log = new LightLog({ debug: true });

  log.info("info message");
  log.warn("warn message");

  const entries = log.getLogs();

  assert.equal(entries.length, 2);
  assert.equal(entries[0].level, "INFO");
  assert.equal(entries[1].level, "WARN");
  assert.equal(entries[0].message, "info message");
});

test("LightLog: error should normalize Error objects", () => {
  const log = new LightLog({ debug: true });

  const err = new Error("boom");
  log.error("something failed", err);

  const entry = log.getLogs()[0];

  assert.equal(entry.level, "ERROR");
  assert.equal(entry.message, "something failed");
  assert.equal(entry.data.name, "Error");
  assert.equal(entry.data.message, "boom");
  assert.ok(entry.data.stack);
});

test("LightLog: should handle circular references", () => {
  const log = new LightLog({ debug: true });

  const obj = { name: "test" };
  obj.self = obj;

  log.info("circular test", obj);

  const entry = log.getLogs()[0];

  assert.equal(entry.data.self, "[Circular]");
});

test("LightLog: should stringify BigInt values", () => {
  const log = new LightLog({ debug: true });

  log.info("bigint test", { value: 10n });

  const entry = log.getLogs()[0];

  assert.equal(entry.data.value, "10");
});

test("LightLog: should cap entries at MAX_ENTRIES", () => {
  const log = new LightLog({ debug: true });

  // MAX_ENTRIES = 100, push 105
  for (let i = 0; i < 105; i++) {
    log.info(`msg-${i}`);
  }

  const entries = log.getLogs();

  assert.equal(entries.length, LightLog.MAX_ENTRIES);
  assert.equal(entries[0].message, "msg-5"); // first 5 removed
});

test("LightLog: clear should remove all logs", () => {
  const log = new LightLog({ debug: true });

  log.info("one");
  log.info("two");

  assert.equal(log.getLogs().length, 2);

  log.clear();

  assert.equal(log.getLogs().length, 0);
});

test("LightLog: logs() should not throw", () => {
  const log = new LightLog({ debug: true });

  log.info("test");

  assert.doesNotThrow(() => log.logs());
});