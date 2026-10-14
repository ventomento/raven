export class SmerpError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NotStartedError extends SmerpError {
  constructor() {
    super("smerp client not started");
  }
}

export class DispatchError extends SmerpError {
  constructor(failed) {
    super(
      failed.length === 0
        ? "no relays configured"
        : `dispatch failed to all ${failed.length} relays`
    );
    this.failed = failed;
  }
}
