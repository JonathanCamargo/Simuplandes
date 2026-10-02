import { useEffect, useRef } from "react";
import AnchorProps from "../../../logic/Props/AnchorProps";
import Css from "./AnchorPropsEditor.module.css";

/**
 * @param {{anchorProps: AnchorProps, onEditorDone: function}} props 
 */
export default function AnchorPropsEditor(props) {
    const formRef = useRef(null);
    return (
        <div className={Css.mainDiv}>
            <div className={Css.titleDiv}>
                <p className={Css.title}>Propiedades anclaje</p>
            </div>
            <form ref={formRef} onSubmit={(e) => {
                e.preventDefault();
                console.log(e.target.elements["h"].value);
            }}>
                <div className={Css.formWrapper}>
                    <div className={Css.formRow}>
                        <div className={Css.inputWrapper}>
                            <div className={Css.label}>X:</div>
                            <input className={Css.input} type="text" name="x" />
                        </div>
                        <div className={Css.inputWrapper}>
                            <div className={Css.label}>Y:</div>
                            <div className={Css.inputDiv}>
                                <input className={Css.input} type="text" name="y"/>
                            </div>
                        </div>
                    </div>
                    <div className={Css.formRow}>
                        <div className={Css.inputWrapper}>
                            <div className={Css.label}>W:</div>
                            <input className={Css.input} type="text" name="w"/>
                        </div>
                        <div className={Css.inputWrapper}>
                            <div className={Css.label}>H:</div>
                            <div className={Css.inputDiv}>
                                <input className={Css.input} type="text" name="h"/>
                            </div>
                        </div>
                    </div>
                    <div className={Css.formRow}>
                        <div className={Css.inputWrapper}>
                            <div className={Css.label}>Rotación:</div>
                            <input className={Css.input} type="text" name="rotation"/>
                        </div>
                    </div>
                    <div className={Css.formRow}>
                        <div className={Css.inputWrapper}>
                            <div className={Css.label}>Densidad:</div>
                            <input className={Css.input} type="text" name="density"/>
                        </div>
                    </div>
                    <div className={Css.formRow}>
                        <div className={Css.inputWrapper}>
                            <div className={Css.label}>Color:</div>
                            <input className={Css.input} type="text" name="color"/>
                        </div>
                    </div>
                    <div className={Css.formRow}>
                        <div className={Css.inputWrapper}>
                            <button className={Css.input}>Eliminar</button>
                        </div>
                    </div>
                </div>
            </form>
        </div>
    )
}