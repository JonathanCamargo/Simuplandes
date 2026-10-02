import PropsEditor from "../../components/props_editor/PropsEditor";
import CircleTool from "./CircleTool";

export default class ToolSelectorTool {
    constructor(setTool, setLabelText, setPopUp, updateEditor) {
        this.setTool = setTool;
        setLabelText("");
        this.setPopUp = setPopUp;
        this.updateEditor = updateEditor;
    }

    handleKeyDown(e) {
        if (e.key === "c") {
            this.setTool("circle")
        } else if (e.key === "r") {
            this.setTool("rect")
        } else if(e.key === "p") {
            this.setTool("poly")
        } else if(e.key === "f") {
            this.setTool("fix body");
        } else if(e.key === "a") {
            this.setTool("anchor");
        } else if(e.key === "o") {
            this.setTool("rotConstraint");
        } else if(e.key === "u") {
            this.setTool("force");
        } else if(e.key === "v") {
            this.setTool("velocity");
        } else if(e.key === "t") {
            this.setTool("torque");
        }
    }

    isDone() {
        return true;
    }

    handleVectorClick(vector) {
        if(vector.type === "force") {
            this.setPopUp(
                <PropsEditor
                    type="force"
                    props={vector}
                    updateEditor={this.updateEditor}
                />
            );
        } else {
            this.setPopUp(
                <PropsEditor
                    type="velocity"
                    props={vector}
                    updateEditor={this.updateEditor} 
                />
            );
        }
    }

    handleBodyClick(body) {
        this.setPopUp(
            <PropsEditor
                type="body"
                props={body}
                updateEditor={this.updateEditor}
            />
        )
    }

    handleAnchorClick(anchor) {
        this.setPopUp(
            <PropsEditor
                type="anchor"
                props={anchor}
                updateEditor={this.updateEditor}
            />
        )
    }
}