import { SmerpClient } from "./smerp-client.js";
import {
    PrivateIdentity,
    insist,
} from "../../../smep/src/index.js";
import { StateTypes } from "./states.js";
import { DomForge } from "../domforge/domforge.js"
import { installStyles } from "./web-styles.js";
import { IndexedDbStorage } from "../storage/indexeddb/indexeddb-storage.js";
import { SmerpUi } from "./smerp-ui.js";

export class WebRender {

    constructor(el, smerpUi){

        insist(el);
        insist(smerpUi, SmerpUi);

        this.el = el;
        this.smerpUi = smerpUi;

        installStyles();
    }

    render(state){

        insist(state.type, "string");

        this.el.innerHTML = "";
        if (!this.el.classList.contains("smerpui")) {
            this.el.classList.add("smerpui");
        }

        this.headerEl = DomForge.div(null, "smerpui__header");
        this.contentEl = DomForge.div(null, "smerpui__content");
        
        this.header();

        let lst = [];

        switch (state.type) {

            case StateTypes.CONVERSATIONS:
                
                lst.push(
                    DomForge.h3("Conversations")
                );
                const conversations = 
                    DomForge.conversationList(state.list, "listable clickable")
                    .map( e => this.hydrate(e, Conversation));

                lst.push(...conversations);

                break;
            
            case StateTypes.ENVELOPES:

                lst.push(
                    DomForge.h3("Conversation")
                );
                lst.push(
                    DomForge.h4("Peer: 0x" + state.publicKeyHex)
                );
                lst.push(
                    ...DomForge.envelopeList(state.list, "listable")
                );

                break;

            case StateTypes.ENVELOPES_STAGE:

                lst.push(DomForge.h3("Encrypted Message"))
                const form = (DomForge.envelopeForm("flexcol"));

                if (state.publicKeyHex) {
                    const textInput = form.querySelector("input[type='text']");
                    textInput.value = state.publicKeyHex;
                }

                lst.push(form);
                lst.push(
                    this.hydrate(
                        DomForge.button("Send Message", "submitbtn"),
                        BtnEnvelopesPost
                    )
                );

                break;

            case StateTypes.ENVELOPES_POST:

                lst.push(DomForge.p("Dispacthing in progress."));
                break;

            case StateTypes.ERROR:

                lst.push(
                    DomForge.h3("Error")
                );
                lst.push(DomForge.error(state.list[0]));

                break;

            case StateTypes.RELAYS:

                lst.push(DomForge.h3("Relays"));
                lst.push(DomForge.relayForm("flexcol"));
                lst.push(
                    this.hydrate(
                        DomForge.button("Add", "submitbtn"),
                        BtnRelaysPost
                    )
                )
                 
                state.list.forEach((record) => {
                    lst.push(
                        DomForge.relay(record, "listable")
                    )
                });

                break;

            case StateTypes.RELAYS_POST:

                lst.push(
                    DomForge.h3("Adding Relay")
                ); 

               break;

            case StateTypes.IDENTITY:

                const {publicKeyHex, privateKeyHex} = state.list[0];

                lst.push(DomForge.h3("Identity"));
                lst.push(DomForge.label("Public Address"));
                lst.push(DomForge.p("0x" + publicKeyHex));
                lst.push(DomForge.label("Private Key"));
                lst.push(DomForge.p(privateKeyHex));
                lst.push(DomForge.label("Important"));
                lst.push(DomForge.p("Make a backup of this."));
                break;
            
            default:
                const s = "unsupported ui render state: " + String(state.type);
                throw new Error(s);

        }

        lst.forEach(e => {
            this.contentEl.appendChild(e);
        });

        this.el.appendChild(this.headerEl);
        this.el.appendChild(this.contentEl);
    }    

    header(){

        this.headerEl.appendChild(
            this.hydrate(
                DomForge.button("Relays"),
                BtnRelays
            )
        );

        this.headerEl.appendChild(
            this.hydrate(
                DomForge.button("Conversations"),
                BtnConversations
            )
        );
        
        this.headerEl.appendChild(
            this.hydrate(
                DomForge.button("Identity"),
                BtnIdentity
            )
        );

        this.headerEl.appendChild(
            this.hydrate(
                DomForge.button("New Message"),
                BtnEnvelopesStage
            )
        );
    }

    hydrate(el, jsClass) {
        this.el.klass = new jsClass(el, this.smerpUi);
        return el;
    }

}

class Conversation {

    constructor(el, smerpUi) {
        this.el = el;
        this.smerpUi = smerpUi;

        this.el.addEventListener("click", () => this.onClick());
    }

    onClick() {

        const publicKeyHex = this.el.dataset.publicKeyHex;

        this.smerpUi.stateSet(
            StateTypes.ENVELOPES,
            {publicKeyHex}
        )
    }
}

class BtnIdentity {

    constructor(el, smerpUi) {
        this.el = el;
        this.smerpUi = smerpUi;        

        this.el.addEventListener("click", () => this.onClick());
    }

    onClick() {
        this.smerpUi.stateSet(
            StateTypes.IDENTITY
        )
    }
}

class BtnRelaysPost {
    
    constructor(el, smerpUi) {
        this.el = el;
        this.smerpUi = smerpUi;

        this.el.addEventListener("click", () => this.onClick());
    }

    onClick() {
        const parent = this.el.parentElement;
        const relayUrl = parent.querySelector("input[type='text']").value;
        const relayType = parent.querySelector("select").value;

        this.smerpUi.stateSet(
            StateTypes.RELAYS_POST,
            {
                relayUrl,
                relayType
            }
        )
    }
}

class BtnRelays {

    constructor(el, smerpUi) {
        this.el = el;
        this.smerpUi = smerpUi;

        this.el.addEventListener("click", () => this.onClick());
    }

    onClick() {
        this.smerpUi.stateSet(
            StateTypes.RELAYS
        )
    }
}

class BtnConversations{

    constructor(el, smerpUi){
        this.el = el;
        this.smerpUi = smerpUi;

        this.el.addEventListener("click", () => this.onclick() );
    }

    onclick() {
        this.smerpUi.stateSet(
            StateTypes.CONVERSATIONS
        );
    }
}

class BtnEnvelopesStage{

    constructor(el, smerpUi){
        this.el = el;
        this.smerpUi = smerpUi;

        this.el.addEventListener("click", () => this.onClick() );
    }

    onClick() {
        this.smerpUi.stateSet(
            StateTypes.ENVELOPES_STAGE,
            {publicKeyHex: this.smerpUi.state.publicKeyHex}
        );      
    }

}

class BtnEnvelopesPost{

    constructor(el, smerpUi) {
        this.el = el;
        this.smerpUi = smerpUi;

        this.el.addEventListener("click", () => this.onClick())
    }

    onClick() {
        const parent = this.el.parentElement;

        const recipientHex = parent.querySelector("input[type='text']")?.value;
        const message = parent.querySelector("textarea")?.value;

        if (! (recipientHex || message)){
            throw new Error("Extraction of envelope inputs from html failed.");
        }

        this.smerpUi.stateSet(
            StateTypes.ENVELOPES_POST,
            {recipientHex, message}
        )
    }

}