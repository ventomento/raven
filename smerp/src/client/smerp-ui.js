import { SmerpClient } from "./smerp-client.js";
import {
    PrivateIdentity,
    insist,
} from "../../../smep/src/index.js";
import { StateTypes } from "./states.js";

// Essentially a presentation state machine over smerpClient.

export class SmerpUi {

    constructor({
        identity,
        el,
        storage,
        render,
        debug = false,
    }) {

        insist(identity, PrivateIdentity);

        this.el = el;
        this.debug = debug;
        this.identity = identity;

        this.render = 
            this.debug ? 
            (state) => {console.log(state)} : 
            (state) => (new render(this.el, this)).render(state) 
        // renderClass need to know container and statemachin (this) to set next state.

        this.smerpClient = new SmerpClient({
            identity,
            storage
        });

        // -------------------------------------------------
        // Persistent SDK event bindings
        // -------------------------------------------------
        this.smerpClient.onConversation =
            (event) => void this.onConversation(event);

        this.smerpClient.onEnvelope =
            (event) => void this.onEnvelope(event);

        this.smerpClient.onDispatch =
            (event) => this.onDispatch(event);

        // -------------------------------------------------
        // UI state
        // -------------------------------------------------
        this.state = {
            type: null,
            list: [],
            publicKeyHex: null,
        };

    }

    // =====================================================
    // Public API
    // =====================================================

    async start() {

        await this.stateSet(
            StateTypes.IDENTITY
        );

        return this.smerpClient.start();
    }

    stop() {
        return this.smerpClient.stop();
    }

    async stateSet(
        type,
        options = {},
    ) {

        insist(type);
        
        this.state.type = type;
        this.state.publicKeyHex = options.publicKeyHex;

        switch (type) {

            case StateTypes.CONVERSATIONS:

                this.state.list =
                    await this.smerpClient.conversationsGet();

                break;

            case StateTypes.ENVELOPES:

                insist(this.state.publicKeyHex);

                this.state.list =
                    await this.smerpClient.envelopesGet({
                        publicKeyHex: this.state.publicKeyHex 
                    });

                await this.touchConversation();

                break;

            case StateTypes.ENVELOPES_STAGE:
                    
                break;// Html creation by render is NOT dependent on any internal data.

            case StateTypes.ENVELOPES_POST:

                const {recipientHex, message} = options;

                if (! (recipientHex && message)) {
                    throw new Error("StateTypes.ENVELOPES_POST : invalid options");
                }

                this.state.list = ["dispacthing"];

                Promise.resolve(this.smerpClient.sendData(recipientHex, message)) 
                .then( () => {
                    this.stateSet(
                        StateTypes.CONVERSATIONS
                    );
                })
                .catch(error => {
                    this.stateSet(
                        StateTypes.ERROR,
                        {error: error}
                    )
                })

                break;

            case StateTypes.RELAYS:

                this.state.list = 
                    await this.smerpClient.relaysGet();
                
                break;

            case StateTypes.RELAYS_POST:

                const {
                    relayUrl,
                    relayPkh, 
                    relayType
                } = options;

                Promise.resolve(this.smerpClient.relaysPut({
                    relayUrl,
                    relayPkh,
                    relayType
                }))
                .then(() => {
                    this.stateSet(
                        StateTypes.RELAYS
                    )
                })
                .catch((error) => {
                    this.stateSet(
                        StateTypes.ERROR,
                        {error: error}
                    )
                })

                break;

            case StateTypes.IDENTITY:

                this.state.list = [
                    {
                        privateKeyHex: await this.identity.exportPrivateHex(),
                        publicKeyHex: await this.identity.exportPublicHex()
                    }
                ]

                break;

            case StateTypes.ERROR:

                this.state.list = [options.error];
                break;
                
            default:

                throw new TypeError(
                    `Invalid state type: ${type}`
                );
        }

        this.stateRender();
    }


    // =====================================================
    // Rendering
    // =====================================================

    stateRender() {

        switch (this.state.type) {

            case StateTypes.CONVERSATIONS:
                this.sortConversations();
                break;

            case StateTypes.ENVELOPES:
                this.sortEnvelopes();
                break;
        }

        this.render(this.state);
    }

    async touchConversation(){
        const [conversation] = await this.smerpClient.conversationsGet({
            publicKeyHex: this.state.publicKeyHex
        });

        conversation.unreadCount = 0;
        this.smerpClient.storage.conversationsPut(conversation);
    }

    sortConversations(){
        this.state.list.sort((a, b) => {

            if (a.lastMessageAt === b.lastMessageAt) {
                return 0;
            }

            return a.lastMessageAt < b.lastMessageAt //desc
                ? 1
                : -1;
        });
    }

    sortEnvelopes() {
        this.state.list.sort((a, b) => {

            if (a.timestamp === b.timestamp) {
                return 0;
            }

            return a.timestamp < b.timestamp
                ? 1
                : -1;
        });
    }

    // =====================================================
    // Internal Event Handlers
    // =====================================================

    async onConversation(event) {

        // Ignore if current view is not conversations
        if (
            this.state.type !==
            StateTypes.CONVERSATIONS
        ) {
            return;
        }

        const conversations = await this.smerpClient.conversationsGet({publicKeyHex: event.publicKeyHex});

        if (conversations[0]){
            this.state.list.push(conversations[0]);
        }

        this.stateRender();
    }

    async onEnvelope(event) {

        // Ignore if current view is not envelopes
        if (
            this.state.type !==
            StateTypes.ENVELOPES
        ) {
            return;
        }

        // Ignore envelopes for other conversations
        if (
            event.publicKeyHex !==
            this.state.publicKeyHex
        ) {

            return;
        }

        const [envelope] = (await this.smerpClient.envelopesGet({uuid: event.uuid}));

        if (envelope){
            this.state.list.push(envelope);
        }

        this.stateRender();
    }

    onDispatch(event) {
        console.log(
            "Successfully dispatched to relays:",
            event.relayUrls
        );
    }
}