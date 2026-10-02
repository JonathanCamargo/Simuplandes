import { useState } from "react";
import Css from "./PropsEditor.module.css";

/**
 * @param {{fieldName: string, fieldInfo: Object}} props
 */
export default function EditorInputField(props) {
    const [validationLabel, setValLabel] = useState("");

    const textOnBlurHandler = (e) => {
        const value = e.target.value;
        const validation = props.fieldInfo.validator(value);
        if(validation !== "valid") {
            setValLabel(validation);
            return
        }
        setValLabel("");
        props.fieldInfo.setter(value);
        if(props.fieldInfo.updateConstraints) {
            props.updateEditor(true);
        } else {
            props.updateEditor();
        }
    }

    console.log("now");

    const checkOnChangeValidaror = (e) => {
        const checked = e.target.checked;
        props.fieldInfo.setter(checked);
        if(props.fieldInfo.updateConstraints) {
            props.updateEditor(true);
        } else {
            props.updateEditor();   
        }
    }

    if(props.fieldInfo.type === "text") {
        return (
            <>
                <label 
                    className={Css.label}
                    for={props.fieldName}
                    title={props.fieldInfo.description}
                    key={props.fieldName + props.id + "lab"}
                >
                    {props.fieldInfo.label || props.fieldName}
                </label>
                <input 
                    className={Css.input}
                    type={props.fieldInfo.type}
                    placeholder={props.fieldInfo.placeHolder}
                    title={props.fieldInfo.description}
                    name={props.fieldName}
                    onBlur={textOnBlurHandler}
                    id={props.fieldName}
                    onKeyDown={e => {
                        if(e.code === "Enter") {
                            textOnBlurHandler(e);
                        }
                    }}
                    key={props.fieldName + props.id + "input"}
                    defaultValue={props.fieldInfo.getter()}
                />
                {validationLabel !== "" ? 
                    <p className={Css.valLabel}>{validationLabel}</p> : <></>}
            </>
        );
    } else if(props.fieldInfo.type === "checkbox") {
        return (
            <>
                <input
                    type="checkbox"
                    name={props.fieldName}
                    title={props.fieldInfo.description}
                    id={props.fieldName}
                    onChange={checkOnChangeValidaror}
                    defaultChecked={props.fieldInfo.getter()}
                    key={props.fieldName + props.id + "input"}
                />
                <label 
                    className={Css.label}
                    for={props.fieldName}
                    title={props.fieldInfo.description}
                    key={props.fieldName + props.id + "lab"}
                >
                    {props.fieldInfo.label || props.fieldName}
                </label>
            </>
        );
    }
}