// src/client/web-bootloader.js

import { DomForge } from "../domforge/domforge.js";
import { SmerpUi } from "./smerp-ui.js";

import {
    PrivateIdentity,
} from "../../../smep/src/index.js";

import { installStyles } from "./web-styles.js";
import { IndexedDbStorage } from "../storage/indexeddb/indexeddb-storage.js";
import { WebRender } from "./web-render.js";

export class WebBootloader {

    constructor({
        el,
        StorageClass = IndexedDbStorage,
        debug = false
    }) {

        this.el = el;
        this.StorageClass = StorageClass;
        this.debug = debug;

        this.lst = [];
        this.privateKeyInput = null;

        installStyles();
    }

    hydrate() {

        this.lst = [];

        this.lst.push(
            DomForge.h3("Load Raven System")
        );

        this.lst.push(
            DomForge.label(
                "Enter Private Key"
            )
        );

        this.privateKeyInput =
            DomForge.input("text");

        this.lst.push(
            this.privateKeyInput
        );

        this.lst.push(
            this.hydrated(
                DomForge.button("Load"),
                BtnLoad
            )
        );

        this.lst.push(
            this.hydrated(
                DomForge.button(
                    "New Identity"
                ),
                BtnNewIdentity
            )
        );

        this.render();
    }

    render() {

        const content =
            DomForge.div(
                null,
                "smerpui__content flexcol"
            );

        for (const el of this.lst) {
            content.appendChild(el);
        }

        this.el.innerHTML = "";
        this.el.appendChild(content);
    }

    hydrated(el, ControllerClass) {

        el.klass =
            new ControllerClass(
                el,
                this
            );

        return el;
    }

    async launch(identity) {

        const storage =
            new this.StorageClass(
                identity.publicKeyHex
            );

        const smerpUi =
            new SmerpUi({
                identity,
                el: this.el,
                storage,
                render: WebRender, 
        });

        if (this.debug) {
            window.smerpUi = smerpUi;
        }

        await smerpUi.start();
    }

    getPrivateKeyHex() {

        return this.privateKeyInput
            ?.value
            ?.trim();
    }

}

class BtnLoad {

    constructor(
        el,
        bootloader
    ) {

        this.el = el;
        this.bootloader = bootloader;

        this.el.addEventListener(
            "click",
            () => this.onclick()
        );
    }

    async onclick() {

        try {

            const privateKeyHex =
                this.bootloader.getPrivateKeyHex();

            if (!privateKeyHex) {

                console.error(
                    "Private key is required."
                );

                return;
            }

            const identity =
                await PrivateIdentity
                    .fromPrivateKeyHex(
                        privateKeyHex
                    );

            await this.bootloader
                .launch(identity);

        } catch (err) {

            console.error(
                "Failed to load identity:",
                err
            );

            alert(err);
        }
    }

}

class BtnNewIdentity {

    constructor(
        el,
        bootloader
    ) {

        this.el = el;
        this.bootloader = bootloader;

        this.el.addEventListener(
            "click",
            () => this.onclick()
        );
    }

    async onclick() {

        try {

            const identity =
                await PrivateIdentity
                    .generate();

            await this.bootloader
                .launch(identity);

        } catch (err) {

            console.error(
                "Failed to create identity:",
                err
            );
        }
    }

}