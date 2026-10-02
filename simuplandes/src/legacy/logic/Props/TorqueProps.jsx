import { v4 as uuidv4 } from "uuid";
import AnchorProps from "./AnchorProps";

export default class TorqueProps {
    constructor() {
        this.id = uuidv4();
        /**
         * @type {AnchorProps | null}
         */
        this.anchor = null;
        this.torque = null;
    }

    getAbsoluteOrigin() {
        return this.anchor.getAbsolutePosition();
    }

    setAnchor(anchor) {
        this.anchor = anchor;
    }

    setTorque(torque) {
        torque = this.torque;
    }
}