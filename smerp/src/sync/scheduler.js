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
 * A round runs from a wake() on an idle scheduler until nothing is
 * pending or running. Each session gets at most maxStepsPerRound steps
 * per round: a session that still has more after that goes idle until
 * the next round (onCapped is told), so a relay that always has more
 * (a hostile one, or a huge backlog) cannot hold a round open. A wake()
 * during the round does not give it more.
 *
 * The scheduler owns no interval and has no remove: the caller wakes it
 * when it wants a sync, and on a relay change stops it and builds a new
 * one from the same session objects.
 */
export class Scheduler {

    static DEFAULTS = Object.freeze({
        concurrency: 6,
        maxStepsPerRound: 50,
    });

    constructor({
        concurrency = Scheduler.DEFAULTS.concurrency,
        maxStepsPerRound = Scheduler.DEFAULTS.maxStepsPerRound,
        // { now(), timer(ms, fn) → cancel }
        clock = RealClock,
        // (error, session) for a step that rejected
        onError = () => {},
        // (session) that used its steps for the round while it had more
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
        this.running = new Map();   // session -> promise of its step
        this.stepsThisRound = new Map();    // session -> steps started
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
     * Make every idle session that has steps left this round pending,
     * and start what fits. Resolves
     * once nothing is pending or running. Never rejects.
     */
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

    usedRound(session) {
        return (this.stepsThisRound.get(session) ?? 0) >= this.maxStepsPerRound;
    }

    // The round ends: every session gets its steps back.
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
