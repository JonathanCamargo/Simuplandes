import AnchorProps from "../Props/AnchorProps";

export default class AnchorTool {
    constructor(setLabelText, onToolDone) {
        this.setLabelText = setLabelText;
        this.onToolDone = onToolDone;

        this.state = "initial";
        this.anchorPros = new AnchorProps();
        setLabelText(this.getLabelText());
    }

    handleClick(e) {
        if(this.state === "bodySelected") {
            this.state = "done";
            this.anchorPros.setPosition(e.evt.clientX, e.evt.clientY);
            this.anchorPros.body.addAnchor(this.anchorPros);
            this.onToolDone();
        }
    }

    getAnchor() {
        return this.anchorPros;
    }

    getId() {
        return this.id;
    }

    isDone() {
        return this.state === "done";
    }

    getLabelText() {
        if (this.state === "initial") {
            return "Seleccione el cuerpo a fijar";
        } else if(this.state === "bodySelected") {
            return "Seleccione la posición de la fijación";
        } else {
            return "";
        }
    }

    handleBodyClick(body) {
        this.state = "bodySelected";
        this.anchorPros.setBody(body);
        this.setLabelText(this.getLabelText());
    }
}