export const EventTypes = Object.freeze({
    ENVELOPE: "envelope",
    CONVERSATION: "conversation",
    RELAY: "relay",
    SYNC: "sync",
    STATUS: "status",
    ERROR: "error",
    REJECTED: "rejected",
})

export function isValidEventType(eventType) {
    if (typeof eventType !== 'string') {
        return false;
    }

    return Object.values(EventTypes).includes(eventType);
}

export class EventBus {
    constructor() {
        this.listeners = new Map()
    }

    subscribe(eventType, callback) {

        if (!isValidEventType(eventType)) {
            throw new Error("EventBus subscribe: invalid eventType"); 
        }

        if (!this.listeners.has(eventType)) {
            this.listeners.set(eventType, new Set())
        }

        const callbacks = this.listeners.get(eventType)

        callbacks.add(callback)

        return () => {
            callbacks.delete(callback)

            if (callbacks.size === 0) {
                this.listeners.delete(eventType)
            }
        }
    }

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