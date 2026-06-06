// event-bus.js

// ======================================================
// Event Types
// ======================================================
//
// Best practice:
// - use SCREAMING_SNAKE_CASE constants
// - event names describe facts that happened
// - event payloads carry the data
//

export const EventTypes = Object.freeze({
    NEW_CONVERSATION: "new.conversation",
    NEW_ENVELOPE: "new.envelope",
    RESULTS_DISPATCH: "results.dispatch"
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
// "EventBus" is the most common and appropriate naming.
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