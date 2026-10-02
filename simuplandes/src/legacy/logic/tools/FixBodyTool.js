class FixBodyTool {
    constructor(setLabelText, onToolDone) {
        this.onToolDone = onToolDone;
        this.state = "initial";
        setLabelText(this.getLabelText());
    }

    isDone() {
        return this.state === "done";
    }

    getLabelText() {
        if (this.state === "initial") {
            return "Seleccione el cuerpo a fijar";
        } else {
            return "";
        }
    }

    handleBodyClick(body) {
        if(body.isStatic) {
            body.isStatic = false;
            alert("Cuerpo liberado");
        } else {
            body.isStatic = true;
            alert("Cuerpo fijado");
        }
        this.state = "done";
        this.onToolDone();
    }
}

export default FixBodyTool;