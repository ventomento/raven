import { insist } from "../../../smep/src/util/util.js";
import { EventBus, EventTypes } from "../event/event-bus.js";
import { RealClock } from "../lib/clock.js";
import { Ingestor } from "../inbox/ingestor.js";
import { RelayDirectory } from "../state/relay-directory.js";
import { SessionOutcome } from "./relay-session.js";

// Where a session is. Each session is in exactly one state, so it never
// runs two requests at once and its cursor needs no lock.
export const SessionState = Object.freeze({
    IDLE: "idle",          // caught up, or nothing to do until woken
    READY: "ready",        // may run now, waiting for a slot
    RUNNING: "running",    // holds a slot, one get() in flight
    WAITING: "waiting",    // may run at entry.until (token, 429 or backoff)
});

/**
 * Runs the relay sessions of the enabled relays.
 *
 *   IDLE ──wakeIdle──► READY, or WAITING if notBefore is in the future
 *   READY ──slot──► RUNNING: one session.get(ingestBatch)
 *   RUNNING ─► MORE      READY, or WAITING for a token (IDLE at the step cap)
 *           ─► EMPTY     IDLE
 *           ─► THROTTLED WAITING until the 429 pause ends
 *           ─► FAILURE   WAITING until backoff ends; publishes ERROR
 *           ─► ERROR     IDLE (local fault); publishes ERROR
 *   WAITING ──timer──► READY
 *
 * A slot is held for one request, not one relay: after every step the
 * session gives it back and queues again, so a relay with a backlog
 * cannot starve the others and a waiting relay holds no slot.
 *
 * A round is the time the pool is busy: it starts on wakeIdle (or a
 * parked session waking up) with a SYNC "start" event and ends with
 * "end" once nothing is READY or RUNNING and every WAITING session is
 * parked (throttled or backing off, not just waiting for a token).
 *
 * The client tells the pool about relay changes with upsert/remove.
 */
export class RelayPool {

    static DEFAULTS = Object.freeze({
        slots: 6,
        // Safety net against a relay that never answers 204. Reset by wakeIdle.
        maxStepsPerWake: 1000,
    });

    constructor({
        // (relay, onChange) => RelaySession
        createSession,
        ingestor,
        directory,
        eventBus,
        logger,
        clock = RealClock,
        slots = RelayPool.DEFAULTS.slots,
        maxStepsPerWake = RelayPool.DEFAULTS.maxStepsPerWake,
    }) {

        insist(createSession, "function");
        insist(ingestor, Ingestor);
        insist(directory, RelayDirectory);
        insist(eventBus, EventBus);
        insist(logger);

        this.createSession = createSession;
        this.ingestor = ingestor;
        this.directory = directory;
        this.eventBus = eventBus;
        this.logger = logger;
        this.clock = clock;
        this.slots = slots;
        this.maxStepsPerWake = maxStepsPerWake;

        this.entries = new Map();   // relayUrl -> entry
        this.ready = [];            // READY entries, FIFO
        this.active = 0;            // slots in use, by steps and sends
        this.sendQueue = [];        // sends waiting for a slot
        this.running = new Map();   // RUNNING entry -> its step promise
        this.round = null;          // { promise, resolve } while busy
        this.cancelTimer = null;
        this.timerAt = Infinity;
        this.stopped = false;
    }

    // =====================================================
    // Relays
    // =====================================================

    // Add the session for a relay, or refresh its config. A disabled
    // relay has no session.
    upsert(relay) {

        if (relay.disabled) {
            this.remove(relay.relayUrl);
            return;
        }

        const entry = this.entries.get(relay.relayUrl);

        if (entry) {
            entry.session.configure(relay);
            return;
        }

        this.#add(relay);
    }

    remove(relayUrl) {

        const entry = this.entries.get(relayUrl);

        if (entry) {
            this.#remove(entry);
        }
    }

    // Relays with a session, i.e. the enabled ones.
    relayUrls() {
        return [...this.entries.keys()];
    }

    #add(relay) {

        const entry = {
            relayUrl: relay.relayUrl,
            state: SessionState.IDLE,
            steps: 0,
            until: 0,
            parked: false,
            removed: false,
            session: null,
        };

        entry.session = this.createSession(
            relay,
            state => this.#recordProgress(entry, state)
        );

        this.entries.set(relay.relayUrl, entry);
    }

    // A removed session's late progress is dropped, so a relay deleted and
    // added again under the same URL is not overwritten by the old one.
    async #recordProgress(entry, state) {

        if (entry.removed) {
            return;
        }

        const stored = await this.directory.recordProgress(entry.relayUrl, state);

        // Deleted while syncing: stop, do not resurrect it.
        if (!stored) {
            this.#remove(entry);
        }
    }

    // A RUNNING session finishes its step and is dropped after it.
    #remove(entry) {

        entry.removed = true;

        if (this.entries.get(entry.relayUrl) === entry) {
            this.entries.delete(entry.relayUrl);
        }

        this.ready = this.ready.filter(e => e !== entry);

        if (entry.state !== SessionState.RUNNING) {
            entry.state = SessionState.IDLE;
        }

        this.#arm();
        this.#settle();
    }

    // =====================================================
    // Sync
    // =====================================================

    /**
     * Wake every IDLE session: it moves to READY, or to WAITING if it may
     * not run yet. Sessions in other states are already busy and are left
     * alone. Resolves when the round ends. Never rejects: failures are
     * published as ERROR events.
     */
    wakeIdle() {

        if (this.stopped) {
            return Promise.resolve();
        }

        const { promise } = this.#beginRound();

        for (const entry of this.entries.values()) {

            if (entry.state === SessionState.IDLE) {
                entry.steps = 0;
                this.#schedule(entry);
            }
        }

        this.#pump();

        return promise;
    }

    /**
     * Run fn(session) for a send: ahead of sync steps for the next free
     * slot, after taking a token from the relay's bucket. Fails fast if
     * the relay asked us to wait (429), rather than hold the send.
     */
    async runNow(relayUrl, fn) {

        const entry = this.entries.get(relayUrl);

        if (!entry) {
            throw new Error(`Relay not enabled: ${relayUrl}`);
        }

        const { session } = entry;

        while (!session.bucket.tryTake()) {

            if (session.isThrottled()) {
                throw new Error(`Relay asked to wait: ${relayUrl}`);
            }

            await this.clock.sleep(session.bucket.nextTokenAt() - this.clock.now());
        }

        await this.#acquireSendSlot();

        try {
            return await fn(session);
        }
        finally {
            this.active--;
            this.#pump();
        }
    }

    /**
     * Stop dispatching, wait for running steps and end the round. The pool
     * is not restarted: the client builds a new one on start.
     */
    async stop() {

        this.stopped = true;
        this.ready = [];
        this.cancelTimer?.();
        this.cancelTimer = null;

        await Promise.all(this.running.values());

        this.#endRound();
    }

    // =====================================================
    // Scheduling
    // =====================================================

    // READY if the session may run now, else WAITING until it may.
    #schedule(entry) {

        const now = this.clock.now();
        const { session } = entry;

        entry.until = session.notBefore();

        if (entry.until <= now) {
            entry.state = SessionState.READY;
            this.ready.push(entry);
            return;
        }

        entry.state = SessionState.WAITING;
        entry.parked = session.isThrottled() || session.backoffUntil() > now;
        this.#arm();
    }

    // Fill free slots: sends first, then READY sessions in order. Once
    // stopped, only sends already waiting still get a slot.
    #pump() {

        while (this.active < this.slots) {

            if (this.sendQueue.length > 0) {
                this.active++;
                this.sendQueue.shift()();
                continue;
            }

            const entry = this.stopped ? null : this.ready.shift();

            if (!entry) {
                break;
            }

            // A send may have taken the token, or a 429 paused the relay,
            // since the session was queued.
            if (!entry.session.bucket.tryTake()) {
                this.#schedule(entry);
                continue;
            }

            this.#run(entry);
        }

        this.#arm();
        this.#settle();
    }

    #run(entry) {

        entry.state = SessionState.RUNNING;
        this.active++;

        this.running.set(entry, this.#step(entry));
    }

    async #step(entry) {

        let result;

        try {
            result = await entry.session.get(
                (frames, cursor) => this.ingestor.ingestBatch(
                    frames,
                    { relayUrl: entry.relayUrl, cursor }
                )
            );
        }
        catch (error) {
            // A bug or a failed relay record write: treat as local.
            result = { outcome: SessionOutcome.ERROR, error };
        }

        this.active--;
        this.running.delete(entry);
        entry.steps++;

        if (result.error) {
            this.logger.warn("Relay step failed:", result.error.message);

            this.eventBus.publish({
                type: EventTypes.ERROR,
                error: result.error,
                relayUrl: entry.relayUrl,
            });
        }

        if (entry.removed) {
            entry.state = SessionState.IDLE;
        }
        else {
            this.#place(entry, result.outcome);
        }

        this.#pump();
    }

    #place(entry, outcome) {

        switch (outcome) {

            case SessionOutcome.MORE:
                if (entry.steps >= this.maxStepsPerWake) {
                    entry.state = SessionState.IDLE;
                }
                else {
                    this.#schedule(entry);
                }
                return;

            case SessionOutcome.THROTTLED:
            case SessionOutcome.FAILURE:
                this.#schedule(entry);
                return;

            case SessionOutcome.EMPTY:
            case SessionOutcome.ERROR:
            default:
                entry.state = SessionState.IDLE;
        }
    }

    // One timer, for the earliest WAITING session.
    #arm() {

        if (this.stopped) {
            return;
        }

        let earliest = Infinity;

        for (const entry of this.entries.values()) {
            if (entry.state === SessionState.WAITING) {
                earliest = Math.min(earliest, entry.until);
            }
        }

        if (earliest === this.timerAt) {
            return;
        }

        this.cancelTimer?.();
        this.cancelTimer = null;
        this.timerAt = earliest;

        if (earliest === Infinity) {
            return;
        }

        this.cancelTimer = this.clock.timer(
            Math.max(0, earliest - this.clock.now()),
            () => this.#wakeDue()
        );
    }

    #wakeDue() {

        this.cancelTimer = null;
        this.timerAt = Infinity;

        const now = this.clock.now();

        for (const entry of this.entries.values()) {

            if (entry.state !== SessionState.WAITING || entry.until > now) {
                continue;
            }

            // A parked session waking outside a round starts one.
            this.#beginRound();
            this.#schedule(entry);
        }

        this.#pump();
    }

    #acquireSendSlot() {

        if (this.active < this.slots) {
            this.active++;
            return Promise.resolve();
        }

        // #pump counts the slot before resolving.
        return new Promise(resolve => this.sendQueue.push(resolve));
    }

    // =====================================================
    // Rounds
    // =====================================================

    #beginRound() {

        if (!this.round) {

            let resolve;
            const promise = new Promise(r => { resolve = r; });

            this.round = { promise, resolve };

            this.eventBus.publish({ type: EventTypes.SYNC, phase: "start" });
        }

        return this.round;
    }

    #settle() {

        if (!this.round) {
            return;
        }

        // running also holds removed sessions finishing their step.
        if (this.running.size > 0 || this.ready.length > 0) {
            return;
        }

        for (const entry of this.entries.values()) {
            if (entry.state === SessionState.WAITING && !entry.parked) {
                return;
            }
        }

        this.#endRound();
    }

    #endRound() {

        if (!this.round) {
            return;
        }

        const { resolve } = this.round;

        this.round = null;

        this.eventBus.publish({ type: EventTypes.SYNC, phase: "end" });

        resolve();
    }
}
