import { insist } from "../../../smep/src/util/util.js";
import { RealClock } from "../lib/clock.js";

export class Scheduler {

    static DEFAULTS = Object.freeze({
        concurrency: 6,
        maxStepsPerRound: 50,
    });

    constructor({
        concurrency = Scheduler.DEFAULTS.concurrency,
        maxStepsPerRound = Scheduler.DEFAULTS.maxStepsPerRound,
        clock = RealClock,
        onError = () => {},
        onCapped = () => {},
    } = {}) {

        if (!Number.isInteger(concurrency) || concurrency <= 0) {
            throw new Error("Scheduler concurrency must be a positive integer");
        }

        if (!Number.isInteger(maxStepsPerRound) || maxStepsPerRound <= 0) {
            throw new Error("Scheduler maxStepsPerRound must be a positive integer");
        }

        insist(onError, "function");
        insist(onCapped, "function");

        this.concurrency = concurrency;
        this.maxStepsPerRound = maxStepsPerRound;
        this.clock = clock;
        this.onError = onError;
        this.onCapped = onCapped;

        this.idle = new Set();
        this.pending = new Set();
        this.running = new Map();
        this.stepsThisRound = new Map();
        this.cancelTimer = null;
        this.done = null;
        this.stopped = false;
    }

    add(session) {

        insist(session.step, "function");
        insist(session.notBefore, "function");

        this.idle.add(session);
    }

    wake() {

        if (this.stopped) {
            return Promise.resolve();
        }

        for (const session of this.idle) {
            if (!this.usedRound(session)) {
                this.idle.delete(session);
                this.pending.add(session);
            }
        }

        const done = this.whenDone();

        this.startDueSessions();

        return done;
    }

    async stop() {

        this.stopped = true;
        this.cancelTimer?.();
        this.cancelTimer = null;

        for (const session of this.pending) {
            this.idle.add(session);
        }
        this.pending.clear();

        await Promise.all(this.running.values());

        this.resolveIfDone();
    }

    startDueSessions() {

        if (!this.stopped) {

            const now = this.clock.now();

            for (const session of this.pending) {

                if (this.running.size >= this.concurrency) {
                    break;
                }

                if (session.notBefore() <= now) {
                    this.startStep(session);
                }
            }
        }

        this.setTimerForNextDue();
        this.resolveIfDone();
    }

    startStep(session) {

        this.pending.delete(session);
        this.stepsThisRound.set(session, (this.stepsThisRound.get(session) ?? 0) + 1);

        const step = Promise.resolve()
            .then(() => session.step())
            .then(
                more => more === true,
                error => {
                    this.onError(error, session);
                    return false;
                }
            )
            .then(more => this.finishStep(session, more));

        this.running.set(session, step);
    }

    finishStep(session, more) {

        this.running.delete(session);

        if (more && !this.stopped && this.usedRound(session)) {
            this.onCapped(session);
            this.idle.add(session);
        }
        else if (more && !this.stopped) {
            this.pending.add(session);
        }
        else {
            this.idle.add(session);
        }

        this.startDueSessions();
    }

    setTimerForNextDue() {

        this.cancelTimer?.();
        this.cancelTimer = null;

        if (this.stopped || this.running.size >= this.concurrency) {
            return;
        }

        let next = Infinity;

        for (const session of this.pending) {
            next = Math.min(next, session.notBefore());
        }

        if (next === Infinity) {
            return;
        }

        this.cancelTimer = this.clock.timer(
            Math.max(0, next - this.clock.now()),
            () => this.startDueSessions()
        );
    }

    whenDone() {

        if (!this.done) {
            let resolve;
            const promise = new Promise(r => { resolve = r; });
            this.done = { promise, resolve };
        }

        return this.done.promise;
    }

    usedRound(session) {
        return (this.stepsThisRound.get(session) ?? 0) >= this.maxStepsPerRound;
    }

    resolveIfDone() {

        if (!this.done || this.pending.size > 0 || this.running.size > 0) {
            return;
        }

        this.stepsThisRound.clear();

        const { resolve } = this.done;
        this.done = null;
        resolve();
    }
}
