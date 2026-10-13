import { insist } from "../../../smep/src/util/util.js";
import { RealClock } from "../lib/clock.js";

/**
 * What the scheduler needs from a session. Everything about the relay
 * (requests, cursor, token bucket, 429 pauses, backoff, health) lives in
 * the session; the scheduler only asks:
 *
 *   step()        make at most one request. Resolves true if the session
 *                 has more to do (e.g. it got a batch), false if it is
 *                 done for now (caught up, failed, throttled). A session
 *                 that should not be asked yet (backing off, or told to
 *                 wait by a 429) resolves false without a request. A
 *                 rejection counts as false and is passed to onError.
 *
 *   notBefore()   earliest time (ms, clock.now() scale) of the session's
 *                 next rate-limit token: a short wait. Must be finite, or
 *                 a pending session never starts. Longer waits (backoff,
 *                 429) are step()'s business, so they cannot hold a sync
 *                 open.
 *
 * A step that finds it cannot make a request after all (its token was
 * used elsewhere) resolves true without one; it then waits for its
 * notBefore() like any other pending session.
 */

/**
 * Runs the steps of the sessions it is given, at most `concurrency` at
 * once. Each session is in exactly one of:
 *
 *   idle      done for now; wake() makes it pending
 *   pending   wants to run; starts once its notBefore() has passed and a
 *             slot is free. Sets keep insertion order, so this is FIFO.
 *   running   one step() in flight
 *
 * The number of steps in flight is running.size. startDueSessions() is
 * the only place steps start, it checks running.size before each one and
 * has no await, so nothing can start a step between the check and the
 * start. A slot is held for one step, not one session: after its step a
 * session goes to the back of pending, so a backlog cannot starve others.
 *
 * The scheduler owns no interval and has no remove: the caller wakes it
 * when it wants a sync, and on a relay change stops it and builds a new
 * one from the same session objects.
 */
export class Scheduler {

    static DEFAULTS = Object.freeze({
        concurrency: 6,
    });

    constructor({
        concurrency = Scheduler.DEFAULTS.concurrency,
        // { now(), timer(ms, fn) → cancel }
        clock = RealClock,
        // (error, session) for a step that rejected
        onError = () => {},
    } = {}) {

        if (!Number.isInteger(concurrency) || concurrency <= 0) {
            throw new Error("Scheduler concurrency must be a positive integer");
        }

        insist(onError, "function");

        this.concurrency = concurrency;
        this.clock = clock;
        this.onError = onError;

        this.idle = new Set();
        this.pending = new Set();
        this.running = new Map();   // session -> promise of its step
        this.cancelTimer = null;
        this.done = null;           // { promise, resolve } while busy
        this.stopped = false;
    }

    // =====================================================
    // Public
    // =====================================================

    // Register a session. It starts idle and runs on the next wake().
    add(session) {

        insist(session.step, "function");
        insist(session.notBefore, "function");

        this.idle.add(session);
    }

    /**
     * Make every idle session pending, and start what fits. Resolves
     * once nothing is pending or running. Never rejects.
     */
    wake() {

        if (this.stopped) {
            return Promise.resolve();
        }

        for (const session of this.idle) {
            this.pending.add(session);
        }
        this.idle.clear();

        const done = this.whenDone();

        this.startDueSessions();

        return done;
    }

    /**
     * Start no more steps and wait for the running ones. Pending wake()
     * promises resolve. Not restartable: build a new scheduler.
     */
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

    // =====================================================
    // Internal
    // =====================================================

    // Start steps for pending sessions whose time has come, oldest first,
    // while slots are free.
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

    // Starting from a resolved promise makes sure the step ends after it
    // was recorded in running, even if step() throws synchronously.
    startStep(session) {

        this.pending.delete(session);

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

        if (more && !this.stopped) {
            this.pending.add(session);
        }
        else {
            this.idle.add(session);
        }

        this.startDueSessions();
    }

    // One timer, for the earliest pending session not due yet. Not needed
    // while every slot is taken: the next finishing step looks again.
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

    // The promise wake() returns; one shared while busy.
    whenDone() {

        if (!this.done) {
            let resolve;
            const promise = new Promise(r => { resolve = r; });
            this.done = { promise, resolve };
        }

        return this.done.promise;
    }

    resolveIfDone() {

        if (!this.done || this.pending.size > 0 || this.running.size > 0) {
            return;
        }

        const { resolve } = this.done;
        this.done = null;
        resolve();
    }
}
