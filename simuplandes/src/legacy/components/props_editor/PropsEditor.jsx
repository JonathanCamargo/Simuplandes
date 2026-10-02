import { useEffect, useRef } from "react";
import AnchorProps from "../../logic/Props/AnchorProps";
import Css from "./PropsEditor.module.css";
import VectorProps from "../../logic/Props/VectorProps"
import VectorEditorLogic from "../../logic/editors/VectorEditorLogic";
import EditorInputField from "./EditorInputField";
import BodyEditorLogic from "../../logic/editors/BodyEditorLogic";
import AnchorEditorLogic from "../../logic/editors/AnchorEditorLogic";

/**
 * @param {{type: string, props: (VectorProps)}} props 
 */
export default function PropsEditor(props) {
    const formRef = useRef(null);
    let editorLogic = null;
    if(props.type === "force") {
        console.log(props.props);
        editorLogic = new VectorEditorLogic(props.props);
    } else if(props.type === "velocity") {
        editorLogic = new VectorEditorLogic(props.props);
    } else if (props.type === "body") {
        editorLogic = new BodyEditorLogic(props.props);
    } else if(props.type === "anchor") {
        editorLogic = new AnchorEditorLogic(props.props);
    } else {
        throw new Error("Invalid props.type");
    }

    const onSubmitHandler = (e) => {
        e.preventDefault();
        // let valid = true;
        // for(let fieldName of Object.keys(editorLogic.fields)) {
        //     const fieldInfo = editorLogic.fields[fieldName];
        //     const value = e.target.elements[fieldName].value;
        //     if(fieldInfo.validator(value) !== "valid") {
        //         valid = false;
        //         break;
        //     } else {
        //         fieldInfo.setter(value);
        //     }
        // }

        // if(valid) {
        //     console.log(console.log(editorLogic));
        // }
    }
    return (
        <div className={Css.mainDiv}>
            <div className={Css.titleDiv}>
                <p className={Css.title}>Edit {props.type}</p>
            </div>
            <form ref={formRef} onSubmit={onSubmitHandler}>
                <div className={Css.formWrapper}>
                   {Object.keys(editorLogic.fields).map((fieldName) => {
                        return <EditorInputField 
                            fieldName={fieldName}
                            fieldInfo={editorLogic.fields[fieldName]}
                            updateEditor={props.updateEditor}
                            id={props.props.id}
                        />
                   })}
                   {/* <input type="submit" value="Guardar" className={Css.submit}/> */}
                </div>
            </form>
        </div>
    )
}