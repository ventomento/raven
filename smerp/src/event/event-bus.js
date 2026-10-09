// event-bus.js

// ======================================================
// Event Types
// ======================================================
//
// - event names describe facts that happened
// - event payloads carry the data
//

export const EventTypes = Object.freeze({
    ENVELOPE: "envelope",          // { envelope }                   envelope stored
    CONVERSATION: "conversation",  // { conversation, created }      conversation stored
    RELAY: "relay",                // { relay, deleted }             relay stored or deleted
    SYNC: "sync",                  // { phase: "start" | "end" }
    STATUS: "status",              // { status }                     client lifecycle changed
    ERROR: "error",                // { error, relayUrl? }           background failure
})

export function isValidEventType(eventType) {
    if (typeof eventType !== 'string') {
        return false;
    }

    // Check if the value exists in EventTypes
    return Object.values(EventTypes).includes(eventType);
}


// ======================================================
// Event Bus
// ======================================================
//
// Responsibilities:
// - receive published events
// - notify matching subscribers
// - allow subscribe/unsubscribe
//

export class EventBus {
    constructor() {
        // Map<eventType, Set<callback>>
        this.listeners = new Map()
    }


    // --------------------------------------------------
    // Subscribe
    // --------------------------------------------------
    //
    // Returns unsubscribe function
    //
    subscribe(eventType, callback) {

        if (!isValidEventType(eventType)) {
            throw new Error("EventBus subscribe: invalid eventType"); 
        }

        if (!this.listeners.has(eventType)) {
            this.listeners.set(eventType, new Set())
        }

        const callbacks = this.listeners.get(eventType)

        callbacks.add(callback)

        // unsubscribe function
        return () => {
            callbacks.delete(callback)

            // cleanup empty sets
            if (callbacks.size === 0) {
                this.listeners.delete(eventType)
            }
        }
    }


    // --------------------------------------------------
    // Publish Event
    // --------------------------------------------------
    //
    // event = {
    //     type: EventTypes.MESSAGE_CREATED,
    //     add whatever key value pair needed - flat object structure,
    // }
    //
    publish(event) {

        const callbacks = this.listeners.get(event.type);
        if (!callbacks) return;

        const enrichedEvent = {
            ...event,
            timestamp: Date.now()
        };

        for (const callback of callbacks) {
            queueMicrotask(() => {
            try {
                const result = callback(enrichedEvent);

                if (result?.catch) {
                result.catch(err =>
                    console.error("async handler failed", err)
                );
                }
            } catch (err) {
                console.error("sync handler failed", err);
            }
            });
        }
    }

}