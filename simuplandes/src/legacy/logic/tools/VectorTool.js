import VectorProps from "../Props/VectorProps";
import AnchorProps from "../Props/AnchorProps";

export default class VectorTool {
    /**
     * 
     * @param {String} type - either "force" or "velocity"
     */
    constructor(setLabelText, onToolDone, updateEditor, type) {
        this.setLabelText = setLabelText;
        this.onToolDone = onToolDone;
        this.updateEditor = updateEditor;

        this.vectorp = new VectorProps();
        if(type === "force") {
            this.vectorp.color = "black";
            this.vectorp.type = "force";
        } else if(type === "velocity") {
            this.vectorp.color = "blue";
            this.vectorp.type = "velocity";
        }
        this.setLabelText("Seleccione el anclaje")
        this.state = "initial";
        this.type = type;
    }

    /**
     * @param {AnchorProps} anchor 
     */
    handleAnchorClick(anchor) {
        if(this.state === "initial") {
            const pos = anchor.getAbsolutePosition();
            this.vectorp.setAnchor(anchor);
            if(this.type === "force") {
                anchor.addForce(this.vectorp);
            } else if(this.type === "velocity") {
                anchor.addVelocity(this.vectorp);
            }
            this.setLabelText("Defina el vector");
            this.state = "originDefined";
        }
    }

    handleMouseMove(e) {
        if(this.state === "originDefined") {
            const posX = e.evt.clientX;
            const posY = e.evt.clientY;
            this.vectorp.setVectorEndAbsolute(posX, posY);
            this.updateEditor();
        }
    }

    handleClick(e) {
        if(this.state === "originDefined") {
            const posX = e.evt.clientX;
            const posY = e.evt.clientY;
            this.vectorp.setVectorEndAbsolute(posX, posY);
            this.state = "done";
            this.onToolDone();
        }
    }

    isDone() {
        return this.state === "done";
    }

    abort() {
        if(this.type === "force") {
            this.vectorp.anchor && this.vectorp.anchor.removeForce(this.vectorp);
        } else if(this.type === "velocity") {
            this.vectorp.anchor && this.vectorp.anchor.removeVelocity(this.vectorp);
        }
    }
}