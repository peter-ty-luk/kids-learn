// ============================================================
// Mini Kart Racing - Mario Kart style browser game
// ============================================================

const canvas = document.getElementById("gameCanvas");
canvas.setAttribute("tabindex", "0");
const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });

let playerCar = null;
let gameKeys = {};

// ============================================================
// QUIZ SYSTEM - Load questions from files
// ============================================================
let mcQuestions = [];
let typingQuestions = [];
let questionsLoaded = false;

function loadQuestions() {
    fetch("questions/multiple_choice.txt")
        .then(r => r.text())
        .then(text => {
            mcQuestions = text.trim().split("\n").map(line => {
                const parts = line.split("|");
                return {
                    question: parts[0],
                    answer: parts[1].trim().toLowerCase(),
                    choices: parts[2].split(",").map(s => s.trim()),
                    type: "mc"
                };
            });
            questionsLoaded = true;
        })
        .catch(() => {
            mcQuestions = [
                { question: "What is 3 + 5?", answer: "8", choices: ["6", "8", "10", "12"], type: "mc" },
                { question: "What is 4 x 6?", answer: "24", choices: ["18", "24", "30", "36"], type: "mc" },
                { question: "What planet do we live on?", answer: "earth", choices: ["mars", "earth", "venus", "jupiter"], type: "mc" },
                { question: "How many legs does a dog have?", answer: "4", choices: ["2", "3", "4", "6"], type: "mc" },
            ];
            questionsLoaded = true;
        });

    fetch("questions/typing.txt")
        .then(r => r.text())
        .then(text => {
            typingQuestions = text.trim().split("\n").map(line => {
                const parts = line.split("|");
                return {
                    question: parts[0],
                    answer: parts[1].trim().toLowerCase(),
                    type: "typing"
                };
            });
        })
        .catch(() => {
            typingQuestions = [
                { question: "What is 2 + 2?", answer: "4", type: "typing" },
                { question: "How many days in a week?", answer: "7", type: "typing" },
                { question: "What is 5 x 5?", answer: "25", type: "typing" },
                { question: "What color do you get mixing red and blue?", answer: "purple", type: "typing" },
            ];
        });
}

loadQuestions();

function getRandomQuestion() {
    const pool = [...mcQuestions, ...typingQuestions];
    if (pool.length === 0) {
        return { question: "What is 1 + 1?", answer: "2", type: "typing" };
    }
    return pool[Math.floor(Math.random() * pool.length)];
}

// ============================================================
// QUIZ UI
// ============================================================
let quizActive = false;
let quizResult = null;
let quizQuestion = null;
let quizTimer = null;
let quizTimeLeft = 15;
const quizOverlay = document.getElementById("quiz-overlay");
const quizQuestionEl = document.getElementById("quiz-question");
const quizChoicesEl = document.getElementById("quiz-choices");
const quizTypingArea = document.getElementById("quiz-typing-area");
const quizInput = document.getElementById("quiz-input");
const quizSubmit = document.getElementById("quiz-submit");
const quizFeedback = document.getElementById("quiz-feedback");
const quizTimerFill = document.getElementById("quiz-timer-fill");

function startQuiz() {
    quizActive = true;
    quizResult = null;
    quizQuestion = getRandomQuestion();
    quizQuestionEl.textContent = quizQuestion.question;
    quizFeedback.textContent = "";
    quizFeedback.className = "";

    if (quizQuestion.type === "mc") {
        quizChoicesEl.style.display = "flex";
        quizTypingArea.classList.remove("active");
        quizChoicesEl.innerHTML = "";
        const shuffled = [...quizQuestion.choices].sort(() => Math.random() - 0.5);
        shuffled.forEach(choice => {
            const btn = document.createElement("button");
            btn.className = "quiz-choice";
            btn.textContent = choice;
            btn.addEventListener("click", () => handleQuizAnswer(choice));
            quizChoicesEl.appendChild(btn);
        });
    } else {
        quizChoicesEl.style.display = "none";
        quizTypingArea.classList.add("active");
        quizInput.value = "";
        setTimeout(() => quizInput.focus(), 100);
    }

quizOverlay.style.display = "flex";

    quizTimeLeft = 15;
    quizTimerFill.style.width = "100%";

    if (quizTimer) clearInterval(quizTimer);
    quizTimer = setInterval(() => {
        quizTimeLeft -= 0.1;
        quizTimerFill.style.width = Math.max(0, (quizTimeLeft / 15) * 100) + "%";
        if (quizTimeLeft <= 5) {
            quizTimerFill.style.background = "#ff4444";
        } else {
            quizTimerFill.style.background = "#55aaff";
        }
        if (quizTimeLeft <= 0) {
            handleQuizAnswer(null);
        }
    }, 100);
}

function handleQuizAnswer(answer) {
    if (quizResult !== null) return;
    if (quizTimer) clearInterval(quizTimer);

    const correct = answer !== null && answer.toLowerCase() === quizQuestion.answer.toLowerCase();
    quizResult = correct;

    if (quizQuestion.type === "mc") {
        const btns = quizChoicesEl.querySelectorAll(".quiz-choice");
        btns.forEach(btn => {
            btn.style.pointerEvents = "none";
            if (btn.textContent === quizQuestion.answer || btn.textContent.toLowerCase() === quizQuestion.answer.toLowerCase()) {
                btn.classList.add("correct");
            } else if (btn.textContent === answer) {
                btn.classList.add("wrong");
            }
        });
    }

    if (correct) {
        quizFeedback.textContent = "Correct! Oil refilled!";
        quizFeedback.className = "quiz-correct";
        if (playerCar) { playerCar.oil = 100; playerCar.stunTimer = 30; }
    } else {
        quizFeedback.textContent = "Wrong! Small oil refill only.";
        quizFeedback.className = "quiz-wrong";
        if (playerCar) { playerCar.oil = Math.min(playerCar.oil + 25, 50); playerCar.stunTimer = 60; }
    }

    setTimeout(() => {
        quizOverlay.style.display = "none";
        quizActive = false;
        quizResult = null;
        quizQuestion = null;
        if (playerCar) playerCar.pitCooldown = 300;
        Object.keys(gameKeys).forEach(k => { gameKeys[k] = false; });
        document.activeElement.blur();
        canvas.focus();
    }, 1500);
}

quizSubmit.addEventListener("click", () => {
    if (quizActive && quizQuestion && quizQuestion.type === "typing") {
        handleQuizAnswer(quizInput.value);
    }
});
quizInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && quizActive && quizQuestion && quizQuestion.type === "typing") {
        handleQuizAnswer(quizInput.value);
    }
});
quizInput.addEventListener("keyup", (e) => { e.stopPropagation(); });
quizInput.addEventListener("keypress", (e) => { e.stopPropagation(); });

const createScene = function () {
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.4, 0.65, 0.9, 1);

    // --- Sky ---
    const skybox = BABYLON.MeshBuilder.CreateBox("skyBox", { size: 1000 }, scene);
    const skyMat = new BABYLON.StandardMaterial("skyBox", scene);
    skyMat.backFaceCulling = false;
    skyMat.disableLighting = true;
    skyMat.reflectionTexture = new BABYLON.CubeTexture("https://playground.babylonjs.com/textures/TropicalSunnyDay", scene);
    skyMat.reflectionTexture.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;
    skyMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
    skyMat.specularColor = new BABYLON.Color3(0, 0, 0);
    skybox.material = skyMat;
    skybox.infiniteDistance = true;

    const sunLight = new BABYLON.PointLight("sunLight", new BABYLON.Vector3(50, 80, -100), scene);
    sunLight.intensity = 0.4;
    sunLight.diffuse = new BABYLON.Color3(1, 0.95, 0.7);

    // --- Clouds ---
    for (let c = 0; c < 15; c++) {
        const cloudGroup = new BABYLON.TransformNode("cloud" + c, scene);
        const cloudX = (Math.random() - 0.5) * 400;
        const cloudZ = (Math.random() - 0.5) * 400;
        const cloudY = 40 + Math.random() * 30;
        cloudGroup.position = new BABYLON.Vector3(cloudX, cloudY, cloudZ);

        const numPuffs = 3 + Math.floor(Math.random() * 4);
        for (let p = 0; p < numPuffs; p++) {
            const puff = BABYLON.MeshBuilder.CreateSphere("cloudPuff" + c + "_" + p, { diameterX: 8 + Math.random() * 10, diameterY: 3 + Math.random() * 2, diameterZ: 6 + Math.random() * 8 }, scene);
            puff.position = new BABYLON.Vector3(
                (Math.random() - 0.5) * 10,
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 6
            );
            const puffMat = new BABYLON.StandardMaterial("cloudMat" + c + "_" + p, scene);
            puffMat.emissiveColor = new BABYLON.Color3(0.95, 0.95, 0.95);
            puffMat.diffuseColor = new BABYLON.Color3(0.95, 0.95, 0.95);
            puffMat.specularColor = new BABYLON.Color3(0, 0, 0);
            puffMat.disableLighting = true;
            puffMat.alpha = 0.85;
            puff.material = puffMat;
            puff.parent = cloudGroup;
        }

        cloudGroup._cloudSpeed = 0.01 + Math.random() * 0.02;
    }

    // --- Lighting ---
    const hemisphericLight = new BABYLON.HemisphericLight("hemiLight", new BABYLON.Vector3(0, 1, 0), scene);
    hemisphericLight.intensity = 0.9;
    const dirLight = new BABYLON.DirectionalLight("dirLight", new BABYLON.Vector3(-0.3, -0.7, 0.4), scene);
    dirLight.intensity = 0.5;
    dirLight.position = new BABYLON.Vector3(-30, 40, 20);

    // --- Shadows ---
    const shadowGenerator = new BABYLON.ShadowGenerator(1024, dirLight);
    shadowGenerator.useBlurExponentialShadowMap = true;
    shadowGenerator.blurKernel = 32;
    shadowGenerator.setDarkness(0.4);

    // --- Fog ---
    scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR;
    scene.fogColor = new BABYLON.Color3(0.61, 0.75, 0.87);
    scene.fogStart = 150;
    scene.fogEnd = 450;

    // --- Ground ---
    const groundSize = 700;
    const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: groundSize, height: groundSize }, scene);
    const groundMat = new BABYLON.StandardMaterial("groundMat", scene);
    groundMat.diffuseColor = new BABYLON.Color3(0.2, 0.5, 0.13);
    groundMat.specularColor = new BABYLON.Color3(0, 0, 0);
    ground.material = groundMat;
    ground.receiveShadows = true;

    // ============================================================
    // TRACK BUILDING
    // ============================================================

    const numPoints = 160;
    const trackLength = 200;
    const trackWidth = 85;
    const trackCenterX = 0;
    const trackCenterZ = 0;
    const trackRibbonWidth = 18;

    // --- Decorative scenery ---
    const treeColors = [
        new BABYLON.Color3(0.08, 0.35, 0.08),
        new BABYLON.Color3(0.1, 0.42, 0.1),
        new BABYLON.Color3(0.12, 0.3, 0.06),
        new BABYLON.Color3(0.05, 0.28, 0.05),
    ];

    for (let i = 0; i < 90; i++) {
        const angle = Math.random() * Math.PI * 2;
        const outerTrackX = trackLength + trackRibbonWidth + 25 + Math.random() * 80;
        const outerTrackZ = trackWidth + trackRibbonWidth + 25 + Math.random() * 50;
        const x = Math.cos(angle) * outerTrackX;
        const z = Math.sin(angle) * outerTrackZ;
        const treeType = Math.random();

        if (treeType < 0.5) {
            const trunk = BABYLON.MeshBuilder.CreateCylinder("trunk" + i, { height: 3, diameter: 0.4 }, scene);
            trunk.position = new BABYLON.Vector3(x, 1.5, z);
            const tMat = new BABYLON.StandardMaterial("trunkMat" + i, scene);
            tMat.diffuseColor = new BABYLON.Color3(0.35, 0.2, 0.1);
            tMat.specularColor = new BABYLON.Color3(0, 0, 0);
            trunk.material = tMat;

            const foliage = BABYLON.MeshBuilder.CreateCylinder("foliage" + i, { height: 5, diameterTop: 0, diameterBottom: 3.5 }, scene);
            foliage.position = new BABYLON.Vector3(x, 5, z);
            const fMat = new BABYLON.StandardMaterial("foliageMat" + i, scene);
            fMat.diffuseColor = treeColors[Math.floor(Math.random() * treeColors.length)];
            fMat.specularColor = new BABYLON.Color3(0, 0, 0);
            foliage.material = fMat;
        } else if (treeType < 0.75) {
            const trunk = BABYLON.MeshBuilder.CreateCylinder("trunk" + i, { height: 2.5, diameter: 0.35 }, scene);
            trunk.position = new BABYLON.Vector3(x, 1.25, z);
            const tMat = new BABYLON.StandardMaterial("trunkMat" + i, scene);
            tMat.diffuseColor = new BABYLON.Color3(0.4, 0.22, 0.1);
            tMat.specularColor = new BABYLON.Color3(0, 0, 0);
            trunk.material = tMat;

            const foliage = BABYLON.MeshBuilder.CreateSphere("foliage" + i, { diameter: 4 + Math.random() * 2 }, scene);
            foliage.position = new BABYLON.Vector3(x, 4.5, z);
            const fMat = new BABYLON.StandardMaterial("foliageMat" + i, scene);
            fMat.diffuseColor = new BABYLON.Color3(0.1 + Math.random() * 0.1, 0.35 + Math.random() * 0.15, 0.05 + Math.random() * 0.1);
            fMat.specularColor = new BABYLON.Color3(0, 0, 0);
            foliage.material = fMat;
        } else {
            const trunk = BABYLON.MeshBuilder.CreateCylinder("trunk" + i, { height: 5, diameter: 0.3 }, scene);
            trunk.position = new BABYLON.Vector3(x, 2.5, z);
            const tMat = new BABYLON.StandardMaterial("trunkMat" + i, scene);
            tMat.diffuseColor = new BABYLON.Color3(0.3, 0.18, 0.08);
            tMat.specularColor = new BABYLON.Color3(0, 0, 0);
            trunk.material = tMat;

            const foliage = BABYLON.MeshBuilder.CreateCylinder("foliage" + i, { height: 6, diameterTop: 0.3, diameterBottom: 2 }, scene);
            foliage.position = new BABYLON.Vector3(x, 7, z);
            const fMat = new BABYLON.StandardMaterial("foliageMat" + i, scene);
            fMat.diffuseColor = new BABYLON.Color3(0.05, 0.3, 0.05);
            fMat.specularColor = new BABYLON.Color3(0, 0, 0);
            foliage.material = fMat;
        }
    }

    // Rocks
    for (let r = 0; r < 40; r++) {
        const angle = Math.random() * Math.PI * 2;
        const outerX = trackLength + trackRibbonWidth + 15 + Math.random() * 80;
        const outerZ = trackWidth + trackRibbonWidth + 15 + Math.random() * 60;
        const rx = Math.cos(angle) * outerX;
        const rz = Math.sin(angle) * outerZ;
        const rockSize = 0.5 + Math.random() * 1.5;

        const rock = BABYLON.MeshBuilder.CreateSphere("rock" + r, { diameter: rockSize, segments: 5 }, scene);
        rock.position = new BABYLON.Vector3(rx, rockSize * 0.3, rz);
        rock.scaling = new BABYLON.Vector3(1 + Math.random() * 0.5, 0.5 + Math.random() * 0.3, 1 + Math.random() * 0.5);
        const rockMat = new BABYLON.StandardMaterial("rockMat" + r, scene);
        rockMat.diffuseColor = new BABYLON.Color3(0.35 + Math.random() * 0.15, 0.32 + Math.random() * 0.1, 0.28 + Math.random() * 0.1);
        rockMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
        rock.material = rockMat;
    }

    // Small bushes near track edges
    for (let b = 0; b < 50; b++) {
        const angle = Math.random() * Math.PI * 2;
        const bushDist = trackLength + trackRibbonWidth + 6 + Math.random() * 8;
        const bushDistZ = trackWidth + trackRibbonWidth + 6 + Math.random() * 8;
        const bx = Math.cos(angle) * bushDist;
        const bz = Math.sin(angle) * bushDistZ;
        const bushSize = 0.8 + Math.random() * 1.2;

        const bush = BABYLON.MeshBuilder.CreateSphere("bush" + b, { diameter: bushSize, segments: 6 }, scene);
        bush.position = new BABYLON.Vector3(bx, bushSize * 0.3, bz);
        bush.scaling = new BABYLON.Vector3(1, 0.6, 1);
        const bushMat = new BABYLON.StandardMaterial("bushMat" + b, scene);
        bushMat.diffuseColor = new BABYLON.Color3(0.1, 0.3 + Math.random() * 0.2, 0.05 + Math.random() * 0.1);
        bushMat.specularColor = new BABYLON.Color3(0, 0, 0);
        bush.material = bushMat;
    }

    const trackPoints = [];
    for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * Math.PI * 2 + 0.3;
        const x = trackCenterX + Math.cos(angle) * trackLength;
        const z = trackCenterZ + Math.sin(angle) * trackWidth;
        trackPoints.push(new BABYLON.Vector3(x, 0.03, z));
    }

    // Track surface
    const trackRibbonPoints = [];
    for (let i = 0; i < numPoints; i++) {
        const pt = trackPoints[i];
        const nextPt = trackPoints[(i + 1) % numPoints];
        const angle = Math.atan2(nextPt.z - pt.z, nextPt.x - pt.x);
        const perpX = -Math.sin(angle) * trackRibbonWidth;
        const perpZ = Math.cos(angle) * trackRibbonWidth;
        trackRibbonPoints.push([
            new BABYLON.Vector3(pt.x - perpX, 0.06, pt.z - perpZ),
            new BABYLON.Vector3(pt.x + perpX, 0.06, pt.z + perpZ),
        ]);
    }

    const trackMesh = BABYLON.MeshBuilder.CreateRibbon("track", {
        pathArray: trackRibbonPoints,
        closeArray: true,
        closePath: true,
        sideOrientation: BABYLON.Mesh.DOUBLESIDE
    }, scene);
    const tMat = new BABYLON.StandardMaterial("trackMat", scene);
    tMat.diffuseColor = new BABYLON.Color3(0.18, 0.18, 0.2);
    tMat.specularColor = new BABYLON.Color3(0.03, 0.03, 0.03);
    trackMesh.material = tMat;
    trackMesh.receiveShadows = true;

    // Lane markings
    const laneMarkingPts = [];
    for (let i = 0; i < numPoints; i += 5) {
        const pt = trackPoints[i];
        const nextPt = trackPoints[(i + 1) % numPoints];
        const angle = Math.atan2(nextPt.z - pt.z, nextPt.x - pt.x);
        const perpX = -Math.sin(angle) * 2.5;
        const perpZ = Math.cos(angle) * 2.5;
        laneMarkingPts.push([
            new BABYLON.Vector3(pt.x - perpX, 0.07, pt.z - perpZ),
            new BABYLON.Vector3(pt.x + perpX, 0.07, pt.z + perpZ),
        ]);
    }
    const laneMarkings = BABYLON.MeshBuilder.CreateRibbon("lanes", {
        pathArray: laneMarkingPts,
        closeArray: true,
        closePath: true,
        sideOrientation: BABYLON.Mesh.DOUBLESIDE
    }, scene);
    const laneMat = new BABYLON.StandardMaterial("laneMat", scene);
    laneMat.diffuseColor = new BABYLON.Color3(1, 0.9, 0.3);
    laneMat.emissiveColor = new BABYLON.Color3(0.2, 0.18, 0.0);
    laneMarkings.material = laneMat;

    // Guardrails
    for (let side = 0; side <= 1; side++) {
        const barrierPoints = [];
        for (let i = 0; i < numPoints; i++) {
            const pt = trackPoints[i];
            const nextPt = trackPoints[(i + 1) % numPoints];
            const angle = Math.atan2(nextPt.z - pt.z, nextPt.x - pt.x);
            const perpX = -Math.sin(angle);
            const perpZ = Math.cos(angle);
            const offset = side === 0 ? -(trackRibbonWidth + 1.5) : (trackRibbonWidth + 1.5);
            barrierPoints.push(new BABYLON.Vector3(pt.x + perpX * offset, 1.2, pt.z + perpZ * offset));
        }
        const barrierLine = BABYLON.MeshBuilder.CreateLines("barrier" + side, { points: barrierPoints, useVertexAlpha: false }, scene);
        barrierLine.color = new BABYLON.Color3(0.9, 0.25, 0.2);
    }

    // Barrier posts
    for (let i = 0; i < numPoints; i += 4) {
        const pt = trackPoints[i];
        const nextPt = trackPoints[(i + 1) % numPoints];
        const angle = Math.atan2(nextPt.z - pt.z, nextPt.x - pt.x);
        const perpX = -Math.sin(angle);
        const perpZ = Math.cos(angle);

        for (let side = 0; side <= 1; side++) {
            const offset = side === 0 ? -(trackRibbonWidth + 1.5) : (trackRibbonWidth + 1.5);
            const post = BABYLON.MeshBuilder.CreateCylinder("post" + i + "_" + side, { height: 2.5, diameter: 0.5 }, scene);
            post.position = new BABYLON.Vector3(pt.x + perpX * offset, 1.25, pt.z + perpZ * offset);
            const postMat = new BABYLON.StandardMaterial("postMat" + i + "_" + side, scene);
            postMat.diffuseColor = new BABYLON.Color3(0.95, 0.95, 0.95);
            post.material = postMat;
        }
    }

    // Red-white kerbs
    for (let i = 0; i < numPoints; i += 2) {
        const pt = trackPoints[i];
        const nextPt = trackPoints[(i + 1) % numPoints];
        const angle = Math.atan2(nextPt.z - pt.z, nextPt.x - pt.x);
        const perpX = -Math.sin(angle);
        const perpZ = Math.cos(angle);

        for (let side = 0; side <= 1; side++) {
            const offset = side === 0 ? -(trackRibbonWidth - 1) : (trackRibbonWidth - 1);
            const kerb = BABYLON.MeshBuilder.CreateBox("kerb" + i + "_" + side, { width: 0.2, height: 0.08, depth: 2 }, scene);
            kerb.position = new BABYLON.Vector3(pt.x + perpX * offset, 0.06, pt.z + perpZ * offset);
            kerb.rotation.y = -Math.atan2(perpX, perpZ);
            const kerbMat = new BABYLON.StandardMaterial("kerbMat" + i + "_" + side, scene);
            kerbMat.diffuseColor = (i % 4 === 0) ? new BABYLON.Color3(1, 0.15, 0.15) : new BABYLON.Color3(1, 1, 1);
            kerb.material = kerbMat;
        }
    }

    // Finish line
    const startPt = trackPoints[0];
    const startNextPt = trackPoints[1];
    const trackDir = startNextPt.subtract(startPt).normalize();
    const perpDir = new BABYLON.Vector3(-trackDir.z, 0, trackDir.x);
    const finishRows = 3;
    const finishCols = 18;
    const sqSize = (trackRibbonWidth * 2) / finishCols;
    const sqDepth = 1.3;
    for (let row = 0; row < finishRows; row++) {
        for (let col = 0; col < finishCols; col++) {
            const isWhite = (row + col) % 2 === 0;
            const stripe = BABYLON.MeshBuilder.CreateBox("sf" + row + "_" + col, { width: sqSize - 0.04, height: 0.03, depth: sqDepth - 0.04 }, scene);
            const alongTrack = (row - finishRows / 2 + 0.5) * sqDepth;
            const acrossTrack = (col - finishCols / 2 + 0.5) * sqSize;
            stripe.position = new BABYLON.Vector3(
                startPt.x + trackDir.x * alongTrack + perpDir.x * acrossTrack,
                0.09,
                startPt.z + trackDir.z * alongTrack + perpDir.z * acrossTrack
            );
            stripe.rotation.y = Math.atan2(trackDir.x, trackDir.z);
            const stripeMat = new BABYLON.StandardMaterial("sfMat" + row + "_" + col, scene);
            if (isWhite) {
                stripeMat.diffuseColor = new BABYLON.Color3(1, 1, 1);
                stripeMat.emissiveColor = new BABYLON.Color3(0.5, 0.5, 0.5);
            } else {
                stripeMat.diffuseColor = new BABYLON.Color3(0.02, 0.02, 0.02);
                stripeMat.emissiveColor = new BABYLON.Color3(0, 0, 0);
            }
            stripe.material = stripeMat;
        }
    }

    // ============================================================
    // PIT STOP AREA
    // ============================================================
    const pitIndex = Math.floor(numPoints * 0.4);
    const pitPt = trackPoints[pitIndex];
    const pitNextPt = trackPoints[(pitIndex + 1) % numPoints];
    const pitAngle = Math.atan2(pitNextPt.z - pitPt.z, pitNextPt.x - pitPt.x);
    const pitPerpX = -Math.sin(pitAngle);
    const pitPerpZ = Math.cos(pitAngle);
    const pitDir = { x: Math.cos(pitAngle), z: Math.sin(pitAngle) };

    // Pit zone: inside of the track, offset inward by a few units
    // "inside" means the side closer to center (negative perpendicular direction for ellipse)
    // Determine which side is "inside" by checking which direction points toward center
    const toCenterX = -pitPt.x;
    const toCenterZ = -pitPt.z;
    const pitSide = (pitPerpX * toCenterX + pitPerpZ * toCenterZ) > 0 ? 1 : -1;
    const pitOffset = 4 * pitSide;
    const pitCenterX = pitPt.x + pitPerpX * pitOffset;
    const pitCenterZ = pitPt.z + pitPerpZ * pitOffset;
    const pitZoneRadius = 12;

    // Pit lane ground surface
    const pitSurface = BABYLON.MeshBuilder.CreateGround("pitSurface", { width: trackRibbonWidth * 1.6, height: 15 }, scene);
    pitSurface.position = new BABYLON.Vector3(pitCenterX, 0.08, pitCenterZ);
    pitSurface.rotation.y = pitAngle;
    const pitSurfMat = new BABYLON.StandardMaterial("pitSurfMat", scene);
    pitSurfMat.diffuseColor = new BABYLON.Color3(0.25, 0.25, 0.2);
    pitSurfMat.specularColor = new BABYLON.Color3(0, 0, 0);
    pitSurface.material = pitSurfMat;
    pitSurface.receiveShadows = true;

    // Pit entry sign on track surface (arrow pointing to pit)
    const pitArrowTex = new BABYLON.DynamicTexture("pitArrowTex", { width: 256, height: 128 }, scene, true);
    const pitArrowCtx = pitArrowTex.getContext();
    pitArrowCtx.clearRect(0, 0, 256, 128);
    pitArrowCtx.fillStyle = "#222";
    pitArrowCtx.fillRect(0, 0, 256, 128);
    pitArrowCtx.fillStyle = "#ff6600";
    pitArrowCtx.font = "bold 48px Arial";
    pitArrowCtx.textAlign = "center";
    pitArrowCtx.textBaseline = "middle";
    pitArrowCtx.fillText("PIT \u2192", 128, 64);
    pitArrowTex.update();
    const pitArrow = BABYLON.MeshBuilder.CreatePlane("pitArrow", { width: 4, height: 2 }, scene);
    pitArrow.position = new BABYLON.Vector3(
        pitPt.x + trackDir.x * 15,
        0.12,
        pitPt.z + trackDir.z * 15
    );
    pitArrow.rotation.x = -Math.PI / 2;
    pitArrow.rotation.y = pitAngle + Math.PI;
    const pitArrowMat = new BABYLON.StandardMaterial("pitArrowMat", scene);
    pitArrowMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
    pitArrowMat.diffuseTexture = pitArrowTex;
    pitArrowMat.disableLighting = true;
    pitArrowMat.backFaceCulling = false;
    pitArrowMat.hasAlpha = true;
    pitArrow.material = pitArrowMat;

    // Pit markings - orange stripes
    for (let s = 0; s < 3; s++) {
        const stripe = BABYLON.MeshBuilder.CreateBox("pitStripe" + s, { width: trackRibbonWidth * 1.2, height: 0.02, depth: 0.5 }, scene);
        const localZ = (s - 1) * 4;
        const sx = pitCenterX + pitDir.x * localZ;
        const sz = pitCenterZ + pitDir.z * localZ;
        stripe.position = new BABYLON.Vector3(sx, 0.1, sz);
        stripe.rotation.y = pitAngle;
        const sMat = new BABYLON.StandardMaterial("pitStripeMat" + s, scene);
        sMat.diffuseColor = new BABYLON.Color3(1, 0.5, 0);
        sMat.emissiveColor = new BABYLON.Color3(0.3, 0.15, 0);
        stripe.material = sMat;
    }

    // Pit canopy (floating roof)
    const pitCanopy = BABYLON.MeshBuilder.CreateBox("pitCanopy", { width: trackRibbonWidth * 1.2, height: 0.25, depth: 10 }, scene);
    pitCanopy.position = new BABYLON.Vector3(pitCenterX, 4, pitCenterZ);
    pitCanopy.rotation.y = pitAngle;
    const canopyMat = new BABYLON.StandardMaterial("canopyMat", scene);
    canopyMat.diffuseColor = new BABYLON.Color3(0.9, 0.6, 0.1);
    canopyMat.emissiveColor = new BABYLON.Color3(0.2, 0.1, 0);
    pitCanopy.material = canopyMat;

    // Pit canopy supports (4 poles)
    for (let p = 0; p < 4; p++) {
        const poleLocalX = (p % 2 === 0 ? -(trackRibbonWidth * 0.5) : (trackRibbonWidth * 0.5));
        const poleLocalZ = (p < 2 ? -4 : 4);
        const px = pitCenterX + Math.cos(pitAngle) * poleLocalZ + pitPerpX * pitSide * poleLocalX * -1;
        const pz = pitCenterZ + Math.sin(pitAngle) * poleLocalZ + pitPerpZ * pitSide * poleLocalX * -1;
        const pole = BABYLON.MeshBuilder.CreateCylinder("pitPole" + p, { height: 5.5, diameter: 0.3 }, scene);
        pole.position = new BABYLON.Vector3(px, 2.75, pz);
        const poleMat = new BABYLON.StandardMaterial("poleMat" + p, scene);
        poleMat.diffuseColor = new BABYLON.Color3(0.6, 0.6, 0.6);
        pole.material = poleMat;
    }

    // PIT sign using DynamicTexture
    const pitSignTex = new BABYLON.DynamicTexture("pitSignTex", { width: 256, height: 128 }, scene, true);
    const pitSignCtx = pitSignTex.getContext();
    pitSignCtx.fillStyle = "#222";
    pitSignCtx.fillRect(0, 0, 256, 128);
    pitSignCtx.fillStyle = "#ff6600";
    pitSignCtx.font = "bold 72px Arial";
    pitSignCtx.textAlign = "center";
    pitSignCtx.textBaseline = "middle";
    pitSignCtx.fillText("PIT", 128, 64);
    pitSignTex.update();

    const pitSign = BABYLON.MeshBuilder.CreatePlane("pitSign", { width: 4, height: 2 }, scene);
    pitSign.position = new BABYLON.Vector3(pitCenterX + pitPerpX * pitSide * -6, 4.5, pitCenterZ + pitPerpZ * pitSide * -6);
    pitSign.rotation.y = pitAngle;
    const pitSignMat = new BABYLON.StandardMaterial("pitSignMat", scene);
    pitSignMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
    pitSignMat.diffuseTexture = pitSignTex;
    pitSignMat.disableLighting = true;
    pitSignMat.backFaceCulling = false;
    pitSign.material = pitSignMat;

    // Pit cones
    for (let c = 0; c < 4; c++) {
        const coneLocalX = (c % 2 === 0 ? -(trackRibbonWidth * 0.6) : (trackRibbonWidth * 0.6));
        const coneLocalZ = (c < 2 ? -4 : 4);
        const cx = pitCenterX + Math.cos(pitAngle) * coneLocalZ + pitPerpX * pitSide * coneLocalX * -1;
        const cz = pitCenterZ + Math.sin(pitAngle) * coneLocalZ + pitPerpZ * pitSide * coneLocalX * -1;
        const cone = BABYLON.MeshBuilder.CreateCylinder("pitCone" + c, { height: 1.2, diameterTop: 0.15, diameterBottom: 0.5 }, scene);
        cone.position = new BABYLON.Vector3(cx, 0.6, cz);
        const coneMat = new BABYLON.StandardMaterial("coneMat" + c, scene);
        coneMat.diffuseColor = new BABYLON.Color3(1, 0.3, 0);
        coneMat.emissiveColor = new BABYLON.Color3(0.2, 0.05, 0);
        cone.material = coneMat;
    }

    // Oil barrel props
    for (let b = 0; b < 2; b++) {
        const barrel = BABYLON.MeshBuilder.CreateCylinder("oilBarrel" + b, { height: 1.5, diameter: 0.8 }, scene);
        const bx = pitCenterX + Math.cos(pitAngle) * (b === 0 ? -4 : 4) + pitPerpX * pitSide * (trackRibbonWidth * 0.5) * -1;
        const bz = pitCenterZ + Math.sin(pitAngle) * (b === 0 ? -4 : 4) + pitPerpZ * pitSide * (trackRibbonWidth * 0.5) * -1;
        barrel.position = new BABYLON.Vector3(bx, 0.75, bz);
        const barrelMat = new BABYLON.StandardMaterial("barrelMat" + b, scene);
        barrelMat.diffuseColor = new BABYLON.Color3(0.15, 0.4, 0.15);
        barrelMat.emissiveColor = new BABYLON.Color3(0.02, 0.08, 0.02);
        barrel.material = barrelMat;
    }

    // ============================================================
    // CAR CREATION
    // ============================================================

    function createCar(color, name) {
        const car = {
            name: name,
            pos: { x: 0, y: 0.1, z: 0 },
            rotY: 0,
            speed: 0,
            maxSpeed: 0.85,
            acceleration: 0.018,
            braking: 0.03,
            turnSpeed: 0.055,
            boostTimer: 0,
            currentItem: null,
            lap: 0,
            checkpointIndex: -1,
            finished: false,
            finishTime: 0,
            invincibleTimer: 0,
            stunTimer: 0,
            oil: 100,
            pitCooldown: 0,
            aiTargetIdx: 0,
            aiBaseSpeed: 0.6,
            aiStartDelay: 0,
            positionLabel: null,
            positionMat: null,
            positionTex: null,
            wheels: [],
            body: null,
            bodyMat: null,
            cabin: null,
            spoiler: null,
            hubs: [],
        };

        const body = BABYLON.MeshBuilder.CreateBox(name + "_body", { width: 1.2, height: 0.45, depth: 2.4 }, scene);
        const bodyMat = new BABYLON.StandardMaterial(name + "_bodyMat", scene);
        bodyMat.diffuseColor = color;
        bodyMat.specularColor = new BABYLON.Color3(0.3, 0.3, 0.3);
        bodyMat.specularPower = 32;
        body.material = bodyMat;
        shadowGenerator.addShadowCaster(body);
        car.body = body;
        car.bodyMat = bodyMat;

        const cabin = BABYLON.MeshBuilder.CreateBox(name + "_cabin", { width: 1.0, height: 0.35, depth: 1.2 }, scene);
        const cabinMat = new BABYLON.StandardMaterial(name + "_cabinMat", scene);
        cabinMat.diffuseColor = new BABYLON.Color3(0.5, 0.8, 1.0);
        cabinMat.alpha = 0.75;
        cabin.material = cabinMat;
        car.cabin = cabin;

        const spoiler = BABYLON.MeshBuilder.CreateBox(name + "_spoiler", { width: 1.35, height: 0.08, depth: 0.25 }, scene);
        const spoilerMat = new BABYLON.StandardMaterial(name + "_spoilerMat", scene);
        spoilerMat.diffuseColor = new BABYLON.Color3(0.08, 0.08, 0.08);
        spoilerMat.specularPower = 64;
        spoiler.material = spoilerMat;
        car.spoiler = spoiler;

        const wheelPositions = [
            { x: -0.72, z: 0.7 },
            { x: 0.72, z: 0.7 },
            { x: -0.72, z: -0.7 },
            { x: 0.72, z: -0.7 },
        ];

        wheelPositions.forEach((wp, idx) => {
            const wheel = BABYLON.MeshBuilder.CreateCylinder(name + "_wheel" + idx, { height: 0.25, diameter: 0.48 }, scene);
            wheel.rotation.x = Math.PI / 2;
            const wMat = new BABYLON.StandardMaterial(name + "_wheelMat" + idx, scene);
            wMat.diffuseColor = new BABYLON.Color3(0.08, 0.08, 0.08);
            wheel.material = wMat;
            car.wheels.push(wheel);
            shadowGenerator.addShadowCaster(wheel);

            const hub = BABYLON.MeshBuilder.CreateCylinder(name + "_hub" + idx, { height: 0.02, diameter: 0.3 }, scene);
            hub.rotation.x = Math.PI / 2;
            const hMat = new BABYLON.StandardMaterial(name + "_hubMat" + idx, scene);
            hMat.diffuseColor = new BABYLON.Color3(0.7, 0.7, 0.75);
            hub.material = hMat;
            car.hubs.push(hub);
        });

        // Position label
        const labelTex = new BABYLON.DynamicTexture(name + "_labelTex", { width: 64, height: 64 }, scene, true);
        car.positionTex = labelTex;
        car.positionMat = new BABYLON.StandardMaterial(name + "_labelMat", scene);
        car.positionMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
        car.positionMat.disableLighting = true;
        car.positionMat.backFaceCulling = false;
        car.positionMat.opacityTexture = labelTex;
        car.positionMat.diffuseTexture = labelTex;

        const labelPlane = BABYLON.MeshBuilder.CreatePlane(name + "_label", { width: 1.2, height: 1.2 }, scene);
        labelPlane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        labelPlane.material = car.positionMat;
        labelPlane.position.y = 3;
        car.positionLabel = labelPlane;

        car._labelColor = color;

        updateCarMeshPositions(car);
        return car;
    }

    function updateCarMeshPositions(car) {
        const px = car.pos.x;
        const py = car.pos.y;
        const pz = car.pos.z;
        const ry = car.rotY;

        const cosR = Math.cos(ry);
        const sinR = Math.sin(ry);

        car.body.position.x = px;
        car.body.position.y = py + 0.55;
        car.body.position.z = pz;
        car.body.rotation.y = ry;

        car.cabin.position.x = px + sinR * (-0.15);
        car.cabin.position.y = py + 0.85;
        car.cabin.position.z = pz + cosR * (-0.15);
        car.cabin.rotation.y = ry;

        car.spoiler.position.x = px + sinR * (-1.1);
        car.spoiler.position.y = py + 0.72;
        car.spoiler.position.z = pz + cosR * (-1.1);
        car.spoiler.rotation.y = ry;

        const wheelOffsets = [
            { x: -0.72, z: 0.7 },
            { x: 0.72, z: 0.7 },
            { x: -0.72, z: -0.7 },
            { x: 0.72, z: -0.7 },
        ];
        wheelOffsets.forEach((wo, idx) => {
            const wx = px + wo.x * cosR - wo.z * sinR;
            const wz = pz + wo.x * sinR + wo.z * cosR;
            car.wheels[idx].position.x = wx;
            car.wheels[idx].position.y = py + 0.25;
            car.wheels[idx].position.z = wz;
            car.wheels[idx].rotation.y = ry;

            car.hubs[idx].position.x = wx;
            car.hubs[idx].position.y = py + 0.25;
            car.hubs[idx].position.z = wz;
            car.hubs[idx].rotation.y = ry;
        });

        if (car.positionLabel) {
            car.positionLabel.position.x = px;
            car.positionLabel.position.y = py + 3;
            car.positionLabel.position.z = pz;
        }
    }

    const carRotY = Math.atan2(startNextPt.x - startPt.x, startNextPt.z - startPt.z);

    // Player car
    playerCar = createCar(new BABYLON.Color3(0.15, 0.5, 1.0), "player");
    playerCar.pos.x = trackPoints[2].x + 4;
    playerCar.pos.y = 0.1;
    playerCar.pos.z = trackPoints[2].z;
    playerCar.rotY = carRotY;
    playerCar.checkpointIndex = 2;
    updateCarMeshPositions(playerCar);

    // AI cars
    const aiColors = [
        new BABYLON.Color3(0.95, 0.2, 0.2),
        new BABYLON.Color3(0.2, 0.9, 0.2),
        new BABYLON.Color3(0.95, 0.75, 0.1),
        new BABYLON.Color3(0.75, 0.2, 0.9),
        new BABYLON.Color3(0.95, 0.5, 0.05),
    ];

    const aiCars = [];
    for (let i = 0; i < 5; i++) {
        const aiCar = createCar(aiColors[i], "ai" + i);
        aiCar.pos.x = trackPoints[2 + i].x + 3;
        aiCar.pos.z = trackPoints[2 + i].z;
        aiCar.rotY = carRotY;
        aiCar.aiTargetIdx = (2 + i + 3) % numPoints;
        aiCar.aiBaseSpeed = 0.78 + i * 0.015;
        aiCar.aiStartDelay = 20 + i * 15;
        aiCar.checkpointIndex = 2 + i;
        updateCarMeshPositions(aiCar);
        aiCars.push(aiCar);
    }

    const allCars = [playerCar, ...aiCars];

    // ============================================================
    // ITEM BOXES
    // ============================================================

    const MAX_ITEM_BOXES = 8;
    const itemBoxes = [];
    const itemBoxQmarks = [];
    const itemBoxBasePositions = [];
    const respawnTimers = new Array(MAX_ITEM_BOXES).fill(0);

    for (let i = 0; i < MAX_ITEM_BOXES; i++) {
        const tIdx = Math.floor(i * (numPoints / MAX_ITEM_BOXES) + numPoints / MAX_ITEM_BOXES / 2);
        const pt = trackPoints[tIdx % numPoints];
        const nextPt = trackPoints[(tIdx + 1) % numPoints];
        const angle = Math.atan2(nextPt.z - pt.z, nextPt.x - pt.x);
        const perpX = -Math.sin(angle) * (i % 2 === 0 ? -4 : 4);
        const perpZ = Math.cos(angle) * (i % 2 === 0 ? -4 : 4);
        const pos = new BABYLON.Vector3(pt.x + perpX, 0.7, pt.z + perpZ);
        itemBoxBasePositions.push(pos.clone());

        const box = BABYLON.MeshBuilder.CreateBox("itemBox" + i, { width: 1.1, height: 1.1, depth: 1.1 }, scene);
        box.position = pos;
        box.rotation.y = Math.random() * Math.PI;
        const boxMat = new BABYLON.StandardMaterial("itemBoxMat" + i, scene);
        boxMat.diffuseColor = new BABYLON.Color3(0.95, 0.78, 0.15);
        boxMat.emissiveColor = new BABYLON.Color3(0.4, 0.25, 0.0);
        box.material = boxMat;
        box._itemActive = true;
        box._itemIndex = i;
        itemBoxes.push(box);
        shadowGenerator.addShadowCaster(box);

        const qMark = BABYLON.MeshBuilder.CreateBox("qBox" + i, { width: 0.75, height: 0.05, depth: 0.75 }, scene);
        qMark.position = new BABYLON.Vector3(pos.x, pos.y + 0.56, pos.z);
        const qMarkMat = new BABYLON.StandardMaterial("qMarkMat" + i, scene);
        qMarkMat.diffuseColor = new BABYLON.Color3(0.15, 0.15, 0.85);
        qMark.material = qMarkMat;
        itemBoxQmarks.push(qMark);
    }

    // ============================================================
    // PROJECTILES
    // ============================================================

    const projectiles = [];

    function fireProjectile(shooter) {
        const proj = BABYLON.MeshBuilder.CreateSphere("proj" + Date.now(), { diameter: 0.55 }, scene);
        proj.position.x = shooter.pos.x;
        proj.position.y = shooter.pos.y + 0.9;
        proj.position.z = shooter.pos.z;
        const dir = { x: Math.sin(shooter.rotY), y: 0, z: Math.cos(shooter.rotY) };
        proj._dir = dir;
        proj._speed = 1.6;
        proj._life = 0;
        proj._maxLife = 100;
        proj._shooterIdx = allCars.indexOf(shooter);
        const projMat = new BABYLON.StandardMaterial("projMat" + Date.now(), scene);
        projMat.diffuseColor = new BABYLON.Color3(1.0, 0.25, 0.05);
        projMat.emissiveColor = new BABYLON.Color3(0.8, 0.15, 0.0);
        proj.material = projMat;

        const glow = new BABYLON.PointLight("projLight" + Date.now(), proj.position.clone(), scene);
        glow.intensity = 5;
        glow.diffuse = new BABYLON.Color3(1, 0.25, 0);
        glow.range = 6;
        proj._glow = glow;

        projectiles.push(proj);
    }

    // ============================================================
    // ITEM SYSTEM
    // ============================================================

    function randomItem() {
        const r = Math.random();
        if (r < 0.4) return "boost";
        if (r < 0.8) return "fireball";
        return "shield";
    }

    function useItem(car) {
        if (!car.currentItem) return;
        const item = car.currentItem;
        car.currentItem = null;

        if (item === "boost") {
            car.boostTimer = 90;
        } else if (item === "fireball") {
            fireProjectile(car);
        } else if (item === "shield") {
            car.invincibleTimer = 180;
        }

        if (car === playerCar) {
            updateItemIndicator();
        }
    }

    function updateItemIndicator() {
        const indicator = document.getElementById("item-indicator");
        if (!playerCar.currentItem) {
            indicator.style.opacity = "0";
            return;
        }
        const itemIcons = { boost: "\u26A1", fireball: "\uD83D\uDD25", shield: "\uD83D\uDEE1" };
        indicator.textContent = itemIcons[playerCar.currentItem] || "?";
        indicator.style.opacity = "1";
    }

    // ============================================================
    // CAMERA
    // ============================================================

    const camera = new BABYLON.UniversalCamera("camera", new BABYLON.Vector3(0, 8, -12), scene);
    camera.setTarget(new BABYLON.Vector3(0, 0, 0));
    camera.minZ = 0.1;
    camera.panningSensibility = 0;

    // ============================================================
    // INPUT
    // ============================================================

    gameKeys = {};
    window.addEventListener("keydown", (e) => {
        if (quizActive) { e.stopPropagation(); return; }
        gameKeys[e.code] = true;
        if (e.code === "Space") {
            e.preventDefault();
            if (playerCar.currentItem) {
                useItem(playerCar);
            }
        }
    });
    window.addEventListener("keyup", (e) => { gameKeys[e.code] = false; });

    // ============================================================
    // TRACK HELPERS
    // ============================================================

    function findClosestTrackSegment(posX, posZ) {
        let closestIdx = 0;
        let closestDist = Infinity;
        for (let i = 0; i < numPoints; i++) {
            const dx = posX - trackPoints[i].x;
            const dz = posZ - trackPoints[i].z;
            const d = dx * dx + dz * dz;
            if (d < closestDist) {
                closestDist = d;
                closestIdx = i;
            }
        }
        return closestIdx;
    }

    function signedDistFromCenterline(posX, posZ, closestIdx) {
        const pt = trackPoints[closestIdx];
        const nextPt = trackPoints[(closestIdx + 1) % numPoints];
        const dx = nextPt.x - pt.x;
        const dz = nextPt.z - pt.z;
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len === 0) return 0;
        const nx = -dz / len;
        const nz = dx / len;
        return (posX - pt.x) * nx + (posZ - pt.z) * nz;
    }

    function isOnTrack(posX, posZ) {
        const idx = findClosestTrackSegment(posX, posZ);
        return Math.abs(signedDistFromCenterline(posX, posZ, idx)) < trackRibbonWidth + 2;
    }

    function pushBackToTrack(car) {
        const idx = findClosestTrackSegment(car.pos.x, car.pos.z);
        const signedDist = signedDistFromCenterline(car.pos.x, car.pos.z, idx);
        const absDist = Math.abs(signedDist);
        const maxDist = trackRibbonWidth + 0.5;

        if (absDist > maxDist) {
            const pt = trackPoints[idx];
            const nextPt = trackPoints[(idx + 1) % numPoints];
            const dx = nextPt.x - pt.x;
            const dz = nextPt.z - pt.z;
            const len = Math.sqrt(dx * dx + dz * dz);
            const nx = -dz / len;
            const nz = dx / len;
            const pushSign = signedDist > 0 ? -1 : 1;
            car.pos.x += nx * pushSign * (absDist - maxDist);
            car.pos.z += nz * pushSign * (absDist - maxDist);
        }
    }

    function isNearPit(posX, posZ) {
        const dx = posX - pitCenterX;
        const dz = posZ - pitCenterZ;
        return Math.sqrt(dx * dx + dz * dz) < pitZoneRadius;
    }

    function positionSuffix(pos) {
        if (pos === 1) return "1st";
        if (pos === 2) return "2nd";
        if (pos === 3) return "3rd";
        return pos + "th";
    }

    // ============================================================
    // GAME STATE
    // ============================================================

    const MAX_LAPS = 3;
    let gameTime = 0;
    let raceStarted = false;
    let countdownValue = 3;
    let countdownTimer = 0;
    const countdownEl = document.getElementById("countdown");

    function endRace() {
        const finished = allCars.filter(c => c.finished);
        const unfinished = allCars.filter(c => !c.finished);
        const sortedFinished = finished.sort((a, b) => a.finishTime - b.finishTime);
        const sortedUnfinished = unfinished.sort((a, b) => {
            if (b.lap !== a.lap) return b.lap - a.lap;
            return b.checkpointIndex - a.checkpointIndex;
        });
        const positions = [...sortedFinished, ...sortedUnfinished];

        let resultText = "Race Over!\n\n";
        positions.forEach((car, idx) => {
            const name = car === playerCar ? "You" : car.name.replace("ai", "Rival ");
            resultText += positionSuffix(idx + 1) + ". " + name + "\n";
        });
        resultText += "\nPress F5 to restart";

        countdownEl.style.fontSize = "28px";
        countdownEl.style.whiteSpace = "pre-line";
        countdownEl.style.lineHeight = "1.6";
        countdownEl.textContent = resultText;
        countdownEl.style.display = "block";
    }

    // ============================================================
    // MINIMAP
    // ============================================================

    const minimapCanvas = document.getElementById("minimap");
    const minimapCtx = minimapCanvas.getContext("2d");

    function drawMinimap() {
        const w = 200, h = 200;
        minimapCtx.clearRect(0, 0, w, h);
        minimapCtx.fillStyle = "rgba(0, 25, 0, 0.75)";
        minimapCtx.fillRect(0, 0, w, h);

        const scale = 0.47;
        const cx = w / 2;
        const cy = h / 2;

        minimapCtx.fillStyle = "#444";
        minimapCtx.beginPath();
        for (let i = 0; i < numPoints; i++) {
            let sx = cx + trackPoints[i].x * scale;
            let sy = cy + trackPoints[i].z * scale;
            if (i === 0) minimapCtx.moveTo(sx, sy);
            else minimapCtx.lineTo(sx, sy);
        }
        minimapCtx.closePath();
        minimapCtx.fill();

        // Finish line
        minimapCtx.strokeStyle = "#fff";
        minimapCtx.lineWidth = 2;
        minimapCtx.beginPath();
        const fStart = trackPoints[0];
        const fEnd = trackPoints[1];
        minimapCtx.moveTo(cx + fStart.x * scale, cy + fStart.z * scale);
        minimapCtx.lineTo(cx + fEnd.x * scale, cy + fEnd.z * scale);
        minimapCtx.stroke();

        // Pit zone
        minimapCtx.fillStyle = "#ff6600";
        minimapCtx.beginPath();
        minimapCtx.arc(cx + pitCenterX * scale, cy + pitCenterZ * scale, 5, 0, Math.PI * 2);
        minimapCtx.fill();
        minimapCtx.strokeStyle = "#ffaa44";
        minimapCtx.lineWidth = 1;
        minimapCtx.beginPath();
        minimapCtx.arc(cx + pitCenterX * scale, cy + pitCenterZ * scale, 5, 0, Math.PI * 2);
        minimapCtx.stroke();

        // Item boxes
        minimapCtx.fillStyle = "#ffdd00";
        itemBoxes.forEach((box, i) => {
            if (box._itemActive) {
                const sx = cx + box.position.x * scale;
                const sy = cy + box.position.z * scale;
                minimapCtx.fillRect(sx - 2.5, sy - 2.5, 5, 5);
            }
        });

        // AI cars
        const aiCarColors = ["#ff3333", "#33ff33", "#ffcc00", "#cc33ff", "#ff8800"];
        aiCars.forEach((aiCar, idx) => {
            const sx = cx + aiCar.pos.x * scale;
            const sy = cy + aiCar.pos.z * scale;
            minimapCtx.fillStyle = aiCarColors[idx] || "#ff5555";
            minimapCtx.beginPath();
            minimapCtx.arc(sx, sy, 4, 0, Math.PI * 2);
            minimapCtx.fill();
            minimapCtx.strokeStyle = "rgba(0,0,0,0.5)";
            minimapCtx.lineWidth = 1;
            minimapCtx.beginPath();
            minimapCtx.arc(sx, sy, 4, 0, Math.PI * 2);
            minimapCtx.stroke();
        });

        // Player car
        const px = cx + playerCar.pos.x * scale;
        const py = cy + playerCar.pos.z * scale;
        minimapCtx.fillStyle = "#4488ff";
        minimapCtx.beginPath();
        minimapCtx.arc(px, py, 5, 0, Math.PI * 2);
        minimapCtx.fill();
        minimapCtx.strokeStyle = "#aaccff";
        minimapCtx.lineWidth = 2;
        minimapCtx.beginPath();
        minimapCtx.arc(px, py, 7, 0, Math.PI * 2);
        minimapCtx.stroke();

        // Direction arrow
        const arrowLen = 10;
        const arrowX = px + Math.sin(playerCar.rotY) * arrowLen;
        const arrowY = py + Math.cos(playerCar.rotY) * arrowLen;
        minimapCtx.strokeStyle = "#aaccff";
        minimapCtx.lineWidth = 2;
        minimapCtx.beginPath();
        minimapCtx.moveTo(px, py);
        minimapCtx.lineTo(arrowX, arrowY);
        minimapCtx.stroke();
    }

    // ============================================================
    // GAME LOOP
    // ============================================================

    scene.onBeforeRenderObservable.add(() => {
        gameTime++;

        // Safety: ensure quiz overlay is hidden when not active
        if (!quizActive && quizOverlay.style.display !== "none") {
            quizOverlay.style.display = "none";
        }

        // --- Countdown ---
        if (!raceStarted) {
            countdownTimer++;
            if (countdownTimer >= 60) {
                countdownTimer = 0;
                countdownValue--;
                if (countdownValue > 0) {
                    countdownEl.textContent = countdownValue;
                    countdownEl.style.fontSize = "96px";
                } else if (countdownValue === 0) {
                    countdownEl.textContent = "GO!";
                    raceStarted = true;
                    setTimeout(() => { countdownEl.textContent = ""; }, 800);
                }
            }

            const pPos = new BABYLON.Vector3(playerCar.pos.x, playerCar.pos.y + 1.5, playerCar.pos.z);
            const fwdX = Math.sin(playerCar.rotY);
            const fwdZ = Math.cos(playerCar.rotY);
            const camDist = 14;
            const camHeight = 6;
            const camX = playerCar.pos.x - fwdX * camDist;
            const camY = playerCar.pos.y + camHeight;
            const camZ = playerCar.pos.z - fwdZ * camDist;
            camera.position = BABYLON.Vector3.Lerp(camera.position, new BABYLON.Vector3(camX, camY, camZ), 0.05);
            camera.setTarget(pPos);
            return;
        }

        // --- QUIZ ACTIVE: pause game ---
        if (quizActive) {
            updateCarMeshPositions(playerCar);
            aiCars.forEach(ai => updateCarMeshPositions(ai));

            const fwdX2 = Math.sin(playerCar.rotY);
            const fwdZ2 = Math.cos(playerCar.rotY);
            const camDist2 = playerCar.boostTimer > 0 ? 18 : 14;
            const camHeight2 = playerCar.boostTimer > 0 ? 8 : 6;
            const camTarget2 = new BABYLON.Vector3(playerCar.pos.x, playerCar.pos.y + 1.5, playerCar.pos.z);
            const camPos2 = new BABYLON.Vector3(
                playerCar.pos.x - fwdX2 * camDist2,
                playerCar.pos.y + camHeight2,
                playerCar.pos.z - fwdZ2 * camDist2
            );
            camera.position = BABYLON.Vector3.Lerp(camera.position, camPos2, 0.06);
            camera.setTarget(BABYLON.Vector3.Lerp(camera.target, camTarget2, 0.1));
            return;
        }

        // --- PLAYER MOVEMENT ---
        const forward = gameKeys["KeyW"] || gameKeys["ArrowUp"];
        const backward = gameKeys["KeyS"] || gameKeys["ArrowDown"];
        const left = gameKeys["KeyA"] || gameKeys["ArrowLeft"];
        const right = gameKeys["KeyD"] || gameKeys["ArrowRight"];

        // Oil effects on speed
        let oilPenalty = 1.0;
        if (playerCar.oil <= 0) {
            oilPenalty = 0.35;
        } else if (playerCar.oil < 20) {
            oilPenalty = 0.5 + (playerCar.oil / 20) * 0.5;
        }

        const effectiveMaxSpeed = (playerCar.boostTimer > 0 ? playerCar.maxSpeed * 2.5 : playerCar.maxSpeed) * oilPenalty;
        const effectiveAccel = (playerCar.boostTimer > 0 ? playerCar.acceleration * 2.5 : playerCar.acceleration) * oilPenalty;
        const effectiveTurn = playerCar.turnSpeed * (1 + (playerCar.boostTimer > 0 ? 0.5 : 0));

        if (playerCar.stunTimer > 0) {
            playerCar.stunTimer--;
            playerCar.speed *= 0.9;
            if (Math.abs(playerCar.speed) < 0.01) playerCar.speed = 0;
        } else {
            if (forward) {
                playerCar.speed = Math.min(playerCar.speed + effectiveAccel, effectiveMaxSpeed);
            } else if (backward) {
                playerCar.speed = Math.max(playerCar.speed - playerCar.braking, -effectiveMaxSpeed * 0.3);
            } else {
                playerCar.speed *= 0.975;
                if (Math.abs(playerCar.speed) < 0.005) playerCar.speed = 0;
            }

            if (backward && playerCar.speed > 0) {
                playerCar.speed -= playerCar.braking * 2;
                if (playerCar.speed < 0) playerCar.speed = 0;
            }

            const speedFactor = Math.max(0.35, Math.min(Math.abs(playerCar.speed) / playerCar.maxSpeed, 1.0));
            if (left) playerCar.rotY -= effectiveTurn * speedFactor;
            if (right) playerCar.rotY += effectiveTurn * speedFactor;
        }

        const moveX = Math.sin(playerCar.rotY) * playerCar.speed;
        const moveZ = Math.cos(playerCar.rotY) * playerCar.speed;
        playerCar.pos.x += moveX;
        playerCar.pos.z += moveZ;

        if (!isOnTrack(playerCar.pos.x, playerCar.pos.z)) {
            playerCar.speed *= 0.6;
            if (playerCar.speed > 0) playerCar.speed = Math.max(0, playerCar.speed - 0.15);
            pushBackToTrack(playerCar);
        }

        // Oil depletion
        if (Math.abs(playerCar.speed) > 0.05) {
            playerCar.oil = Math.max(0, playerCar.oil - 0.012);
        }

        // Pit cooldown
        if (playerCar.pitCooldown > 0) {
            playerCar.pitCooldown--;
        }

        // Pit detection
        if (isNearPit(playerCar.pos.x, playerCar.pos.z) && playerCar.pitCooldown <= 0 && playerCar.oil < 85 && raceStarted && !playerCar.finished && !quizActive) {
            playerCar.speed = 0;
            startQuiz();
        }

        if (playerCar.boostTimer > 0) {
            playerCar.boostTimer--;
            if (playerCar.boostTimer <= 0) {
                updateItemIndicator();
            }
        }

        if (playerCar.invincibleTimer > 0) {
            playerCar.invincibleTimer--;
            if (Math.floor(playerCar.invincibleTimer / 5) % 2 === 0) {
                playerCar.bodyMat.emissiveColor = new BABYLON.Color3(0, 0.5, 1);
            } else {
                playerCar.bodyMat.emissiveColor = new BABYLON.Color3(0, 0, 0);
            }
        } else {
            // Oil warning flash
            if (playerCar.oil < 20) {
                const flash = Math.floor(gameTime / 8) % 2 === 0;
                playerCar.bodyMat.emissiveColor = flash ? new BABYLON.Color3(0.8, 0.2, 0) : new BABYLON.Color3(0, 0, 0);
            } else {
                playerCar.bodyMat.emissiveColor = new BABYLON.Color3(0, 0, 0);
            }
        }

        // Wheel spin
        const wheelSpin = playerCar.speed * 15;
        playerCar.wheels.forEach(w => { w.rotation.z += wheelSpin; });

        updateCarMeshPositions(playerCar);

        // Lap detection
        const cpIdx = findClosestTrackSegment(playerCar.pos.x, playerCar.pos.z);
        if (cpIdx !== playerCar.checkpointIndex) {
            if (cpIdx < 12 && playerCar.checkpointIndex > numPoints - 12) {
                playerCar.lap++;
            }
            playerCar.checkpointIndex = cpIdx;
        }

        if (playerCar.lap >= MAX_LAPS && !playerCar.finished) {
            playerCar.finished = true;
            playerCar.finishTime = gameTime;
        }

        // --- AI MOVEMENT ---
        aiCars.forEach((aiCar, i) => {
            if (aiCar.aiStartDelay > 0) {
                aiCar.aiStartDelay--;
                updateCarMeshPositions(aiCar);
                return;
            }

            if (aiCar.stunTimer > 0) {
                aiCar.stunTimer--;
                if (aiCar.stunTimer <= 0) aiCar.speed = 0;
                updateCarMeshPositions(aiCar);
                return;
            }

            const aiCp = findClosestTrackSegment(aiCar.pos.x, aiCar.pos.z);
            if (aiCp !== aiCar.checkpointIndex) {
                if (aiCp < 12 && aiCar.checkpointIndex > numPoints - 12) {
                    aiCar.lap++;
                }
                aiCar.checkpointIndex = aiCp;
            }
            if (aiCar.lap >= MAX_LAPS && !aiCar.finished) {
                aiCar.finished = true;
                aiCar.finishTime = gameTime;
            }

            const lookAhead = 3;
            const targetIdx = (aiCar.aiTargetIdx + lookAhead) % numPoints;
            const targetPt = trackPoints[targetIdx];
            const futureTarget = trackPoints[(targetIdx + 3) % numPoints];
            const futureAngle = Math.atan2(futureTarget.z - targetPt.z, futureTarget.x - targetPt.x);

            const offset = Math.sin(gameTime * 0.012 + i * 2.1) * 3;
            const raceLineX = targetPt.x - Math.sin(futureAngle) * offset;
            const raceLineZ = targetPt.z + Math.cos(futureAngle) * offset;

            const dx = raceLineX - aiCar.pos.x;
            const dz = raceLineZ - aiCar.pos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist < 12) {
                aiCar.aiTargetIdx = (aiCar.aiTargetIdx + 1) % numPoints;
            }

            const desiredAngle = Math.atan2(dx, dz);
            let angleDiff = desiredAngle - aiCar.rotY;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

            const maxSteer = 0.12;
            const steerResponse = 0.18;
            const aiSteer = Math.max(-maxSteer, Math.min(maxSteer, angleDiff * steerResponse));
            aiCar.rotY += aiSteer;

            let turnSharpness = 0;
            for (let t = 1; t <= 10; t++) {
                const futureIdx = (aiCp + t) % numPoints;
                const pastIdx = (aiCp - t + numPoints) % numPoints;
                const fPt = trackPoints[futureIdx];
                const pPt = trackPoints[pastIdx];
                const fAngle = Math.atan2(fPt.z - aiCar.pos.z, fPt.x - aiCar.pos.x);
                const pAngle = Math.atan2(pPt.z - aiCar.pos.z, pPt.x - aiCar.pos.x);
                let aDiff = fAngle - pAngle;
                while (aDiff > Math.PI) aDiff -= Math.PI * 2;
                while (aDiff < -Math.PI) aDiff += Math.PI * 2;
                turnSharpness += Math.abs(aDiff) * 0.25;
            }

            const angleToTarget = Math.abs(angleDiff);
            let targetSpeed = aiCar.aiBaseSpeed;

            targetSpeed *= (1 - angleToTarget / Math.PI * 0.3);

            if (turnSharpness > 1.0) {
                targetSpeed *= 0.65;
            } else if (turnSharpness > 0.6) {
                targetSpeed *= 0.82;
            }

            // Rubber-banding
            const playerProgress = playerCar.lap * numPoints + playerCar.checkpointIndex;
            const aiProgress = aiCar.lap * numPoints + aiCar.checkpointIndex;
            const progressDiff = playerProgress - aiProgress;
            if (progressDiff > 5) {
                targetSpeed *= 1.08;
            } else if (progressDiff < -10) {
                targetSpeed *= 0.93;
            }

            if (aiCar.boostTimer > 0) {
                targetSpeed *= 2.2;
                aiCar.boostTimer--;
            }
            if (aiCar.invincibleTimer > 0) aiCar.invincibleTimer--;

            if (aiCar.speed < targetSpeed) {
                aiCar.speed += aiCar.acceleration * 1.5;
                if (aiCar.speed > targetSpeed) aiCar.speed = targetSpeed;
            } else {
                aiCar.speed *= 0.96;
                if (aiCar.speed < targetSpeed) aiCar.speed = targetSpeed;
            }

            const aiMoveX = Math.sin(aiCar.rotY) * aiCar.speed;
            const aiMoveZ = Math.cos(aiCar.rotY) * aiCar.speed;
            aiCar.pos.x += aiMoveX;
            aiCar.pos.z += aiMoveZ;

            if (!isOnTrack(aiCar.pos.x, aiCar.pos.z)) {
                aiCar.speed *= 0.6;
                pushBackToTrack(aiCar);
            }

            aiCar.wheels.forEach(w => { w.rotation.z += aiCar.speed * 15; });
            updateCarMeshPositions(aiCar);
        });

        // --- PROJECTILE UPDATES ---
        for (let i = projectiles.length - 1; i >= 0; i--) {
            const proj = projectiles[i];
            proj.position.x += proj._dir.x * proj._speed;
            proj.position.z += proj._dir.z * proj._speed;
            proj.position.y = 0.8 + Math.sin(proj._life * 0.15) * 0.4;
            proj._life++;
            if (proj._glow) proj._glow.position = proj.position.clone();

            let hit = false;
            for (const car of allCars) {
                if (allCars.indexOf(car) === proj._shooterIdx) continue;
                if (car.invincibleTimer > 0) continue;
                if (car.stunTimer > 0) continue;
                const dx = proj.position.x - car.pos.x;
                const dz = proj.position.z - car.pos.z;
                const distToCar = Math.sqrt(dx * dx + dz * dz);
                if (distToCar < 2.2) {
                    car.speed = -car.speed * 0.6;
                    car.rotY += (Math.random() - 0.5) * 1.8;
                    car.stunTimer = 30;
                    hit = true;

                    for (let p = 0; p < 8; p++) {
                        const spark = BABYLON.MeshBuilder.CreateSphere("spark" + Date.now() + p, { diameter: 0.2 }, scene);
                        spark.position = proj.position.clone();
                        const sparkDir = new BABYLON.Vector3(
                            (Math.random() - 0.5) * 2,
                            Math.random() * 2,
                            (Math.random() - 0.5) * 2
                        );
                        const sparkMat = new BABYLON.StandardMaterial("sparkMat" + Date.now() + p, scene);
                        sparkMat.diffuseColor = new BABYLON.Color3(1, 0.6, 0.1);
                        sparkMat.emissiveColor = new BABYLON.Color3(1, 0.4, 0);
                        spark.material = sparkMat;
                        spark._sparkLife = 15;
                        spark._sparkDir = sparkDir;
                        spark._disposeAfter = true;
                    }

                    break;
                }
            }

            if (hit || proj._life > proj._maxLife ||
                Math.abs(proj.position.x) > 350 || Math.abs(proj.position.z) > 350) {
                if (proj._glow) proj._glow.dispose();
                proj.dispose();
                projectiles.splice(i, 1);
            }
        }

        // --- Spark particle cleanup ---
        const meshes = scene.meshes;
        for (let i = meshes.length - 1; i >= 0; i--) {
            const m = meshes[i];
            if (m._disposeAfter && m._sparkLife !== undefined) {
                m._sparkLife--;
                m.position.x += m._sparkDir.x * 0.3;
                m.position.y += m._sparkDir.y * 0.3;
                m.position.z += m._sparkDir.z * 0.3;
                if (m._sparkLife <= 0) {
                    m.material.dispose();
                    m.dispose();
                }
            }
        }

        // --- ITEM BOX COLLECTION ---
        allCars.forEach((car) => {
            if (car.pos.y > 5 || car.pos.y < -5) return;
            itemBoxes.forEach((box, i) => {
                if (!box._itemActive) return;
                const dx = car.pos.x - box.position.x;
                const dz = car.pos.z - box.position.z;
                const d = Math.sqrt(dx * dx + dz * dz);
                if (d < 2.8) {
                    if (car === playerCar) {
                        if (!car.currentItem) {
                            car.currentItem = randomItem();
                            updateItemIndicator();
                        }
                    } else {
                        if (!car.currentItem) {
                            car.currentItem = randomItem();
                            const useDelay = 800 + Math.random() * 2500;
                            setTimeout(() => {
                                if (car.currentItem) useItem(car);
                            }, useDelay);
                        }
                    }
                    box._itemActive = false;
                    box.isVisible = false;
                    itemBoxQmarks[i].isVisible = false;
                    respawnTimers[i] = 200;
                }
            });
        });

        // Respawn item boxes
        for (let i = 0; i < MAX_ITEM_BOXES; i++) {
            if (respawnTimers[i] > 0) {
                respawnTimers[i]--;
                if (respawnTimers[i] === 0) {
                    const box = itemBoxes[i];
                    box._itemActive = true;
                    box.isVisible = true;
                    box.position = itemBoxBasePositions[i].clone();
                    itemBoxQmarks[i].isVisible = true;
                }
            }
        }

        // Item box animation
        itemBoxes.forEach((box, i) => {
            if (box._itemActive) {
                box.rotation.y += 0.025;
                box.position.y = itemBoxBasePositions[i].y + Math.sin(gameTime * 0.04 + i) * 0.35;
                itemBoxQmarks[i].position.y = box.position.y + 0.56;
                itemBoxQmarks[i].position.x = box.position.x;
                itemBoxQmarks[i].position.z = box.position.z;
                itemBoxQmarks[i].rotation.y = box.rotation.y;
            }
        });

        // --- AI ITEM USAGE ---
        aiCars.forEach((aiCar) => {
            if (aiCar.currentItem && Math.random() < 0.006) {
                useItem(aiCar);
            }
        });

        // --- Pit glow animation ---
        if (pitSurfMat) {
            const pulse = 0.3 + Math.sin(gameTime * 0.05) * 0.15;
            pitSurfMat.emissiveColor = new BABYLON.Color3(pulse * 0.8, pulse * 0.4, 0);
        }

        // --- CAMERA ---
        const fwdX = Math.sin(playerCar.rotY);
        const fwdZ = Math.cos(playerCar.rotY);
        const camDist = playerCar.boostTimer > 0 ? 18 : 14;
        const camHeight = playerCar.boostTimer > 0 ? 8 : 6;
        const camTargetPos = new BABYLON.Vector3(playerCar.pos.x, playerCar.pos.y + 1.5, playerCar.pos.z);
        const camPos = new BABYLON.Vector3(
            playerCar.pos.x - fwdX * camDist,
            playerCar.pos.y + camHeight,
            playerCar.pos.z - fwdZ * camDist
        );
        camera.position = BABYLON.Vector3.Lerp(camera.position, camPos, 0.06);
        camera.setTarget(BABYLON.Vector3.Lerp(camera.target, camTargetPos, 0.1));

        // --- HUD ---
        document.getElementById("lapNum").textContent = Math.min(playerCar.lap + 1, MAX_LAPS);
        const boostPercent = Math.max(0, (playerCar.boostTimer / 90) * 100);
        document.getElementById("boostBar").style.width = boostPercent + "%";
        const oilPercent = Math.max(0, playerCar.oil);
        const oilBar = document.getElementById("oilBar");
        oilBar.style.width = oilPercent + "%";
        if (playerCar.oil < 20) {
            oilBar.style.background = "#ff4444";
        } else if (playerCar.oil < 50) {
            oilBar.style.background = "#ffaa00";
        } else {
            oilBar.style.background = "#44cc44";
        }
        document.getElementById("speedVal").textContent = Math.abs(Math.round(playerCar.speed * 200));

        const sortedCars = [...allCars].sort((a, b) => {
            const progressA = a.lap * numPoints + a.checkpointIndex;
            const progressB = b.lap * numPoints + b.checkpointIndex;
            return progressB - progressA;
        });
        document.getElementById("position").textContent = positionSuffix(sortedCars.indexOf(playerCar) + 1);

        // --- POSITION LABELS ---
        allCars.forEach((car, idx) => {
            const pos = sortedCars.indexOf(car) + 1;
            if (car.positionTex && car.positionMat) {
                const tex = car.positionTex;
                const ctx = tex.getContext();
                ctx.clearRect(0, 0, 64, 64);

                const r = car._labelColor ? car._labelColor.r : 0.5;
                const g = car._labelColor ? car._labelColor.g : 0.5;
                const b = car._labelColor ? car._labelColor.b : 0.5;
                const bgR = Math.round(r * 255);
                const bgG = Math.round(g * 255);
                const bgB = Math.round(b * 255);

                ctx.fillStyle = "rgba(" + bgR + "," + bgG + "," + bgB + ",1)";
                ctx.beginPath();
                ctx.arc(32, 28, 24, 0, Math.PI * 2);
                ctx.fill();

                ctx.strokeStyle = "#ffffff";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(32, 28, 24, 0, Math.PI * 2);
                ctx.stroke();

                ctx.fillStyle = "#ffffff";
                ctx.font = "bold 24px Arial";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(String(pos), 32, 30);

                tex.update();
            }
        });

        // Minimap
        if (gameTime % 2 === 0) drawMinimap();

        // --- END RACE CHECK ---
        if (allCars.every(c => c.finished)) {
            endRace();
        }

        // --- Cloud animation ---
        scene.transformNodes.forEach((node) => {
            if (node._cloudSpeed !== undefined) {
                node.position.x += node._cloudSpeed;
                if (node.position.x > 300) node.position.x = -300;
            }
        });
    });

    // ============================================================
    // RENDER LOOP
    // ============================================================

    engine.runRenderLoop(() => {
        scene.render();
    });

    window.addEventListener("resize", () => {
        engine.resize();
    });
    engine.resize();

    return scene;
};

createScene();