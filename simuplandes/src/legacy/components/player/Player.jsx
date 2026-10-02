import { useEffect, useRef, useState } from 'react'
import { Engine, Render, Bodies, Runner, Composite, Events, Body } from 'matter-js'
import { useNavigate } from 'react-router';
import Css from "./Player.module.css";
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import StopIcon from '@mui/icons-material/Stop';
import { addVectors, relativeToGlobalPos, rotateVector, substractVectors, vectorMagnitude } from 'constraint-solver-js';

export default function Player (props) {
  const scene = useRef();
  const navigate = useNavigate();
  const engine = useRef(Engine.create());
  const runner = useRef(Runner.create());
  const [ppIcon, setPpIcon] = useState(() => PlayArrowIcon);
  
  useEffect(() => {
    const cw = document.body.clientWidth;
    const ch = document.body.clientHeight;

    const worldBodies = props.worldProps.current.getBodyList();
    const worldConstraints = props.worldProps.current.getRotConstraintList();
    const anchorsWithForces = props.worldProps.current.getAnchorsWithForces();

    scene.current.focus();

    const render = Render.create({
      element: scene.current,
      engine: engine.current,
      options: {
        width: cw,
        height: ch,
        wireframes: false,
        background: 'transparent'
      }

    });

    if (worldBodies.length > 32) {
      alert("There are more than 32 bodies. Collisions will not be detected");
    }

    worldBodies.forEach((body, i) => {
      body.resetMatterJsBody();
      const matterJsBody = body.getMatterJsBody();
      const group = (worldBodies.length <= 32) ? 0 : -1;
      const category = (worldBodies.length <= 32) ? Math.pow(2, i) : 1;
      matterJsBody.collisionFilter.group = group;
      matterJsBody.collisionFilter.category = category;
      console.log(matterJsBody);
      Composite.add(engine.current.world, matterJsBody);
    });
    
    worldConstraints.forEach((constraint) => {
      const matterJsConstraint = constraint.getMatterJsConstraint();
      const bodyA = matterJsConstraint.bodyA;
      const bodyB = matterJsConstraint.bodyB;
      bodyA.collisionFilter.mask = (bodyA.collisionFilter.mask & (~bodyB.collisionFilter.category)) >>> 0;
      bodyB.collisionFilter.mask = (bodyB.collisionFilter.mask & (~bodyA.collisionFilter.category)) >>> 0;
      Composite.add(engine.current.world, matterJsConstraint);
      console.log(bodyA);
      console.log(bodyB);
    });

    // Register forces
    Events.on(runner.current, "beforeUpdate", (evt) => {
      anchorsWithForces.forEach((anchor) => {
        const body = anchor.getBody();
        const mJsBody = body.getMatterJsBody();
        const bodyPos = mJsBody.position;
        const bodyRot = mJsBody.angle;
        anchor.forces.forEach((force) => {
          const relOrigin = anchor.getRelativePosition();
          const absOrigin = relativeToGlobalPos(relOrigin, bodyPos, bodyRot); //addVectors(bodyPos, relOrigin);
          let fVector = force.getRelativeVector();
          if(!force.fixedDirection) {
            const relEnd = addVectors(fVector, relOrigin);
            const absEnd = relativeToGlobalPos(relEnd, bodyPos, bodyRot);
            fVector = substractVectors(absEnd, absOrigin);
          }
          Body.applyForce(mJsBody, absOrigin, fVector);
        });
      });
    });
    Runner.run(runner.current, engine.current);
    Render.run(render);
    runner.current.enabled = false;

    return () => {
      Render.stop(render)
      Composite.clear(engine.current.world)
      Engine.clear(engine.current)
      render.canvas.remove()
      render.canvas = null
      render.context = null
      render.textures = {}
    }
  }, []);

  const playPause = () => {
    if (runner.current.enabled) {
      runner.current.enabled = false
      setPpIcon(() => PlayArrowIcon);
    } else {
      runner.current.enabled = true
      setPpIcon(() => PauseIcon);
    }
  }

  const onKeyDown = (e) => {
    if(e.code === "ArrowLeft" || e.code === "ArrowRight") {
      if(!runner.current.enabled) {
        // Runner.tick(runner.current, engine.current, Date.now());
        Engine.update(engine.current, 1);
      }
    }
  }

  const PpIcon = ppIcon;

  return (
    <div onKeyDown={onKeyDown}>
      <div className={Css.btnsDiv}>
        <button className={Css.stopBtn + " btn"} onClick={() => navigate("/editor")}>
          <StopIcon className={Css.stopBtnIcon} />
        </button>
        <button className={Css.pouseBtn + " btn"} onClick={playPause}>
          <PpIcon className={Css.pouseBtnIcon} />
        </button>
      </div>
      <div
        tabIndex="0"
        ref={scene}
        style={{height: "100vh", overflow: "hidden"}}
      ></div>
    </div>
  )
}