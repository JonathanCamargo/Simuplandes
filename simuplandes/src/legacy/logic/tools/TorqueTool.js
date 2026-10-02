import AnchorProps from "../Props/AnchorProps";
import TorqueProps from "../Props/TorqueProps";

export default class TorqueTool {

    constructor(setLabelText, onToolDone) {
        this.setLabelText = setLabelText;
        this.onToolDone = onToolDone;

        this.torquep = new TorqueProps();
        this.state = "initial";
        this.setLabelText("Seleccione el punto del torque");
    }

    /**
     * @param {AnchorProps} anchor 
     */
    handleAnchorClick(anchor) {
        if(this.state === "initial") {
            this.torquep.setAnchor(anchor);
            anchor.addTorque(this.torquep);
            this.state = "done";
            this.onToolDone();
        }
    }

    isDone() {
        return this.state === "done";
    }
}