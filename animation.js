import * as THREE from "three";

let model = null;

let locked = false;
let exploded = false;

const originalPositions = new Map();

export function setModel(sceneModel){

    model = sceneModel;

    model.traverse((child)=>{

        if(child.isMesh){

            originalPositions.set(
                child.uuid,
                child.position.clone()
            );

        }

    });

}

export function toggleLock(){

    if(!model) return;

    locked = !locked;

    // Rotate the entire module for now.
    // Later we'll replace this with servo/linkage animation.

    const angle = locked ? Math.PI/6 : 0;

    model.rotation.z = angle;

    document.getElementById("servoState").textContent =
        locked ? "Locked" : "Unlocked";

    document.getElementById("rollerState").textContent =
        locked ? "Locked" : "Free Rolling";

    document.getElementById("driveState").textContent =
        locked ? "Traction" : "Omnidirectional";

}

export function toggleExploded(){

    if(!model) return;

    exploded = !exploded;

    let i = 0;

    model.traverse((child)=>{

        if(!child.isMesh) return;

        const start = originalPositions.get(child.uuid);

        if(!start) return;

        if(exploded){

            child.position.set(

                start.x,

                start.y + (i*0.004),

                start.z

            );

        }else{

            child.position.copy(start);

        }

        i++;

    });

}

export function resetModel(){

    if(!model) return;

    model.rotation.set(0,0,0);

    model.traverse((child)=>{

        if(!child.isMesh) return;

        const start = originalPositions.get(child.uuid);

        if(start){

            child.position.copy(start);

        }

    });

    locked = false;
    exploded = false;

    document.getElementById("servoState").textContent = "Unlocked";
    document.getElementById("rollerState").textContent = "Free Rolling";
    document.getElementById("driveState").textContent = "Omnidirectional";

}
