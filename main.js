import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const viewer = document.getElementById("viewer");

// ---------------- Scene ----------------

const scene = new THREE.Scene();
scene.background = null;

// ---------------- Camera ----------------

const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.01,
    100
);

camera.position.set(0.4,0.3,0.5);

// ---------------- Renderer ----------------

const renderer = new THREE.WebGLRenderer({
    antialias:true,
    alpha:true
});

renderer.setSize(window.innerWidth,window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);

renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

viewer.appendChild(renderer.domElement);

// ---------------- Controls ----------------

const controls = new OrbitControls(camera,renderer.domElement);

controls.enableDamping = true;
controls.dampingFactor = .08;

controls.minDistance = .15;
controls.maxDistance = 2;

controls.target.set(0,0,0);

// ---------------- Lights ----------------

scene.add(new THREE.AmbientLight(0xffffff,1.5));

const key = new THREE.DirectionalLight(0xffffff,3);
key.position.set(3,4,5);
key.castShadow = true;
scene.add(key);

const rim = new THREE.DirectionalLight(0x88aaff,2);
rim.position.set(-4,2,-3);
scene.add(rim);

const fill = new THREE.DirectionalLight(0xffddaa,1.2);
fill.position.set(0,-2,3);
scene.add(fill);

// ---------------- Floor ----------------

const floor = new THREE.Mesh(

    new THREE.CircleGeometry(3,64),

    new THREE.ShadowMaterial({
        opacity:.18
    })

);

floor.rotation.x = -Math.PI/2;
floor.position.y = -.08;

floor.receiveShadow = true;

scene.add(floor);

// ---------------- Model ----------------

let model;

const loader = new GLTFLoader();

loader.load(

    "https://raw.githubusercontent.com/liamtaymourdavidson-createlocking-mecanum-demo/blob/main/Left%20Slant%20Module.glb",

    (gltf)=>{

        model = gltf.scene;

        model.traverse((obj)=>{

            if(obj.isMesh){

                obj.castShadow = true;
                obj.receiveShadow = true;

                if(obj.material){

                    obj.material.metalness = .65;
                    obj.material.roughness = .35;

                }

            }

        });

        // Scale if needed
        model.scale.set(1,1,1);

        scene.add(model);

    },

    (xhr)=>{

        console.log(
            `${(xhr.loaded/xhr.total*100).toFixed(0)}%`
        );

    },

    (err)=>{

        console.error(err);

    }

);

// ---------------- Resize ----------------

window.addEventListener("resize",()=>{

    camera.aspect =
        window.innerWidth/window.innerHeight;

    camera.updateProjectionMatrix();

    renderer.setSize(
        window.innerWidth,
        window.innerHeight
    );

});

// ---------------- Animate ----------------

function animate(){

    requestAnimationFrame(animate);

    controls.update();

    renderer.render(scene,camera);

}

animate();

// ---------------- Exports ----------------

export {
    scene,
    camera,
    renderer,
    controls,
    model
};
