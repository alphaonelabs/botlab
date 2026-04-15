const CAM_W = 640;
const CAM_H = 480;
const SIM_W = 1920;
const SIM_H = 1080;
const DRIVE_SPEED = 0.11;
const REVERSE_SPEED = 0.075;
const GESTURE_STABLE_FRAMES = 3;
const TURN_SPEED = 5.0;
const PICKUP_RANGE = 0.95;
const CLICK_COOLDOWN = 0.5;
const PLAYER_RADIUS = 0.2;
const MAZE_COLS = 9;
const MAZE_ROWS = 9;
const MAZE_OBJECT_COUNT = 24;
const MAZE_HUMAN_COUNT = 7;
const MAX_VIEW_DISTANCE = 18.0;
const RAY_STRIP_WIDTH = 4;
const MAZE_RESET_DELAY = 3.5;
const DEG_TO_RAD = Math.PI / 180;
const TOOLBOX_CATEGORIES = ["Chassis", "Wheels (WASD)", "Lidar", "Camera (View)", "Arm (SPACE)"];
const TOOLBOX_PARTS = {
  "Chassis": ["None", "Standard", "Tank", "Humanoid", "Spider"],
  "Wheels (WASD)": ["None", "Standard", "Treads", "Legs"],
  "Lidar": ["Off", "On"],
  "Camera (View)": ["None", "Standard", "Wide-Angle", "Thermal"],
  "Arm (SPACE)": ["None", "Retracted", "Extended"]
};
const TOOLBOX_COLORS = [
  [100, 140, 50],
  [50, 110, 220],
  [50, 50, 200],
  [230, 110, 60],
  [220, 50, 150]
];
const SHAPE_TYPES = ["circle", "square", "triangle"];
const OBJECT_COLORS = [
  [0, 200, 0], [0, 120, 255], [255, 100, 100], [200, 0, 200],
  [0, 255, 255], [50, 200, 255], [255, 200, 0], [100, 255, 100],
  [180, 50, 255], [255, 150, 50]
];
const HUMAN_COLORS = [
  [200, 200, 200],
  [180, 160, 255],
  [150, 220, 255],
  [200, 255, 180]
];
const MEDIAPIPE_SOURCES = [
  {
    moduleUrl: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs",
    wasmRoot: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm"
  },
  {
    moduleUrl: "https://unpkg.com/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs",
    wasmRoot: "https://unpkg.com/@mediapipe/tasks-vision@0.10.21/wasm"
  }
];
const HAND_LANDMARKER_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task";
const requestedViewMode = window.__robotViewMode ?? new URLSearchParams(window.location.search).get("view");
const sceneMode = requestedViewMode === "assembly" ? "assembly" : "maze";
const isAssemblyMode = sceneMode === "assembly";

const canvas = document.getElementById("simCanvas");
const video = document.getElementById("cameraVideo");
if (!canvas || !video) {
  throw new Error("Required canvas or camera elements are missing from the page.");
}
const ctx = canvas.getContext("2d");
if (!ctx) {
  throw new Error("Unable to acquire the 2D drawing context.");
}
const detectionCanvas = document.createElement("canvas");
const detectionCtx = detectionCanvas.getContext("2d");
const tempRobotCanvas = document.createElement("canvas");
const tempRobotCtx = tempRobotCanvas.getContext("2d");
const robotViewCanvas = document.createElement("canvas");
const robotViewCtx = robotViewCanvas.getContext("2d");

detectionCanvas.width = CAM_W;
detectionCanvas.height = CAM_H;
tempRobotCanvas.width = 250;
tempRobotCanvas.height = 250;
robotViewCanvas.width = 320;
robotViewCanvas.height = 240;

let handLandmarker = null;
let mediaStream = null;
let lastVideoTime = -1;
let lastDetectionResults = null;
let running = false;
let visionModule = null;
let activeWasmRoot = "";
let bootTitle = "INITIALIZING";
let bootDetail = "Loading hand tracking";
let bootError = false;
let frameSeconds = 0;
let controlMode = "gesture";
let modeBannerTitle = "GESTURE MODE";
let modeBannerDetail = "Allow camera access to control the robot with hand tracking";
let cameraAvailable = false;
let handTrackingAvailable = false;
let manualPresetApplied = false;
const directOpenMode = window.location.protocol === "file:";
const manualKeys = {
  KeyW: false,
  KeyA: false,
  KeyS: false,
  KeyD: false
};

let robotX = 0.0;
let robotZ = 0.0;
let robotAngle = 0.0;
let robotState = "IDLE";
let currentGesture = "NONE";
let stableGesture = "NONE";
const gestureHistory = [];

let actionGesture = "NONE";
let stableActionGesture = "NONE";
const actionGestureHistory = [];
let robotFrozen = false;
let prevActionFist = false;

let heldObject = null;
let heldObjectIndex = null;

const selectedParts = Object.fromEntries(TOOLBOX_CATEGORIES.map((cat) => [cat, 0]));

let lastClickTime = 0.0;
let lastHoveredCat = null;
let cursorX = -100;
let cursorY = -100;
let pinching = false;
let showCursor = false;

const staticObjects = [];
const wanderingHumans = [];
let mazeGrid = [];
let mazeWidth = 0;
let mazeHeight = 0;
let mazeSpawnNodes = [];
let mazeStart = { x: 1.5, z: 1.5, cellX: 0, cellZ: 0 };
let mazeExit = { x: 1.5, z: 1.5, cellX: 0, cellZ: 0 };
let mazeSolved = false;
let mazeSolvedAt = 0.0;
let lastRayDepths = [];
const colorCache = new Map();
const rng = mulberry32(42);

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randFloat(min, max) {
  return min + rng() * (max - min);
}

function randInt(min, max) {
  return Math.floor(randFloat(min, max + 1));
}

function choose(list) {
  return list[Math.floor(rng() * list.length)];
}

function bgr(color) {
  const key = color.join(",");
  if (!colorCache.has(key)) {
    colorCache.set(key, `rgb(${color[2]}, ${color[1]}, ${color[0]})`);
  }
  return colorCache.get(key);
}

function bgrAlpha(color, alpha) {
  return `rgba(${color[2]}, ${color[1]}, ${color[0]}, ${alpha})`;
}

function rgb(r, g, b, alpha = 1) {
  return alpha === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeAngle(angle) {
  return (angle % 360 + 360) % 360;
}

function shuffleInPlace(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function buildMazeLayout(cols, rows) {
  const cells = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({
    north: true,
    east: true,
    south: true,
    west: true
  })));
  const visited = Array.from({ length: rows }, () => Array(cols).fill(false));
  const stack = [{ cellX: 0, cellZ: 0 }];
  visited[0][0] = true;

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const neighbors = [];
    const directions = [
      { dx: 1, dz: 0, wall: "east", opposite: "west" },
      { dx: -1, dz: 0, wall: "west", opposite: "east" },
      { dx: 0, dz: 1, wall: "south", opposite: "north" },
      { dx: 0, dz: -1, wall: "north", opposite: "south" }
    ];

    for (const direction of directions) {
      const nextX = current.cellX + direction.dx;
      const nextZ = current.cellZ + direction.dz;
      if (nextX < 0 || nextZ < 0 || nextX >= cols || nextZ >= rows || visited[nextZ][nextX]) {
        continue;
      }
      neighbors.push({ ...direction, nextX, nextZ });
    }

    if (neighbors.length === 0) {
      stack.pop();
      continue;
    }

    const choice = choose(neighbors);
    cells[current.cellZ][current.cellX][choice.wall] = false;
    cells[choice.nextZ][choice.nextX][choice.opposite] = false;
    visited[choice.nextZ][choice.nextX] = true;
    stack.push({ cellX: choice.nextX, cellZ: choice.nextZ });
  }

  const gridWidth = cols * 2 + 1;
  const gridHeight = rows * 2 + 1;
  const grid = Array.from({ length: gridHeight }, () => Array(gridWidth).fill(1));
  const spawnNodes = [];

  for (let cellZ = 0; cellZ < rows; cellZ += 1) {
    for (let cellX = 0; cellX < cols; cellX += 1) {
      const gridX = cellX * 2 + 1;
      const gridZ = cellZ * 2 + 1;
      grid[gridZ][gridX] = 0;
      spawnNodes.push({
        x: gridX + 0.5,
        z: gridZ + 0.5,
        cellX,
        cellZ
      });
      if (!cells[cellZ][cellX].east) {
        grid[gridZ][gridX + 1] = 0;
      }
      if (!cells[cellZ][cellX].south) {
        grid[gridZ + 1][gridX] = 0;
      }
    }
  }

  const distances = Array.from({ length: rows }, () => Array(cols).fill(-1));
  const queue = [{ cellX: 0, cellZ: 0 }];
  distances[0][0] = 0;
  let farthest = { cellX: 0, cellZ: 0, distance: 0 };

  while (queue.length > 0) {
    const current = queue.shift();
    const cell = cells[current.cellZ][current.cellX];
    const options = [];
    if (!cell.north) {
      options.push({ cellX: current.cellX, cellZ: current.cellZ - 1 });
    }
    if (!cell.east) {
      options.push({ cellX: current.cellX + 1, cellZ: current.cellZ });
    }
    if (!cell.south) {
      options.push({ cellX: current.cellX, cellZ: current.cellZ + 1 });
    }
    if (!cell.west) {
      options.push({ cellX: current.cellX - 1, cellZ: current.cellZ });
    }

    for (const option of options) {
      if (distances[option.cellZ][option.cellX] !== -1) {
        continue;
      }
      distances[option.cellZ][option.cellX] = distances[current.cellZ][current.cellX] + 1;
      const distance = distances[option.cellZ][option.cellX];
      if (distance > farthest.distance) {
        farthest = { ...option, distance };
      }
      queue.push(option);
    }
  }

  const start = spawnNodes[0];
  const exit = {
    x: farthest.cellX * 2 + 1.5,
    z: farthest.cellZ * 2 + 1.5,
    cellX: farthest.cellX,
    cellZ: farthest.cellZ
  };

  return { grid, gridWidth, gridHeight, spawnNodes, start, exit };
}

function chooseMazeNodes(count, blockedKeys = new Set()) {
  const available = mazeSpawnNodes.filter((node) => !blockedKeys.has(`${node.cellX},${node.cellZ}`));
  shuffleInPlace(available);
  return available.slice(0, Math.min(count, available.length));
}

function getStartAngle() {
  const eastOpen = !mazeGrid[1]?.[2];
  return eastOpen ? 0 : 90;
}

function isWallAt(x, z) {
  const tileX = Math.floor(x);
  const tileZ = Math.floor(z);
  if (tileX < 0 || tileZ < 0 || tileX >= mazeWidth || tileZ >= mazeHeight) {
    return true;
  }
  return mazeGrid[tileZ][tileX] === 1;
}

function isBlockedAt(x, z) {
  const offsets = [
    [-PLAYER_RADIUS, -PLAYER_RADIUS],
    [-PLAYER_RADIUS, 0],
    [-PLAYER_RADIUS, PLAYER_RADIUS],
    [0, -PLAYER_RADIUS],
    [0, 0],
    [0, PLAYER_RADIUS],
    [PLAYER_RADIUS, -PLAYER_RADIUS],
    [PLAYER_RADIUS, 0],
    [PLAYER_RADIUS, PLAYER_RADIUS]
  ];

  for (const [offsetX, offsetZ] of offsets) {
    if (isWallAt(x + offsetX, z + offsetZ)) {
      return true;
    }
  }
  return false;
}

function moveRobot(distance) {
  const radians = robotAngle * DEG_TO_RAD;
  const nextX = robotX + Math.cos(radians) * distance;
  const nextZ = robotZ + Math.sin(radians) * distance;

  if (!isBlockedAt(nextX, robotZ)) {
    robotX = nextX;
  }
  if (!isBlockedAt(robotX, nextZ)) {
    robotZ = nextZ;
  }
}

function getRobotForwardVector() {
  const radians = robotAngle * DEG_TO_RAD;
  return { x: Math.cos(radians), z: Math.sin(radians) };
}

function getRobotRightVector() {
  const radians = robotAngle * DEG_TO_RAD;
  return { x: -Math.sin(radians), z: Math.cos(radians) };
}

function populateMazeWorld() {
  staticObjects.length = 0;
  wanderingHumans.length = 0;

  const blockedKeys = new Set([
    `${mazeStart.cellX},${mazeStart.cellZ}`,
    `${mazeExit.cellX},${mazeExit.cellZ}`
  ]);
  const objectNodes = chooseMazeNodes(MAZE_OBJECT_COUNT, blockedKeys);

  for (const node of objectNodes) {
    blockedKeys.add(`${node.cellX},${node.cellZ}`);
    staticObjects.push({
      x: node.x + randFloat(-0.16, 0.16),
      z: node.z + randFloat(-0.16, 0.16),
      color: choose(OBJECT_COLORS),
      shape: choose(SHAPE_TYPES),
      size: randInt(6, 12)
    });
  }

  const humanNodes = chooseMazeNodes(MAZE_HUMAN_COUNT, blockedKeys);
  for (const node of humanNodes) {
    wanderingHumans.push({
      x: node.x,
      z: node.z,
      targetX: node.x,
      targetZ: node.z,
      speed: randFloat(0.008, 0.018),
      color: choose(HUMAN_COLORS)
    });
  }

  heldObject = null;
  heldObjectIndex = null;
}

function resetMazeWorld(resetPose = true) {
  const layout = buildMazeLayout(MAZE_COLS, MAZE_ROWS);
  mazeGrid = layout.grid;
  mazeWidth = layout.gridWidth;
  mazeHeight = layout.gridHeight;
  mazeSpawnNodes = layout.spawnNodes;
  mazeStart = layout.start;
  mazeExit = layout.exit;
  mazeSolved = false;
  mazeSolvedAt = 0.0;
  populateMazeWorld();

  if (resetPose) {
    robotX = mazeStart.x;
    robotZ = mazeStart.z;
    robotAngle = getStartAngle();
    robotState = "READY";
  }
}

function selectedPart(category) {
  return TOOLBOX_PARTS[category][selectedParts[category]];
}

function cycleSelectedPart(category, step = 1) {
  if (category !== "Chassis" && selectedPart("Chassis") === "None") {
    return;
  }
  const parts = TOOLBOX_PARTS[category];
  const currentIndex = selectedParts[category];
  selectedParts[category] = (currentIndex + step + parts.length) % parts.length;
  if (category === "Chassis" && selectedPart("Chassis") === "None") {
    for (const key of TOOLBOX_CATEGORIES) {
      if (key !== "Chassis") {
        selectedParts[key] = 0;
      }
    }
  }
}

function applyManualPreset() {
  if (manualPresetApplied) {
    return;
  }
  if (isAssemblyMode) {
    manualPresetApplied = true;
    return;
  }
  manualPresetApplied = true;

  const allDisabled = TOOLBOX_CATEGORIES.every((category) => {
    const value = selectedPart(category);
    return value === "None" || value === "Off";
  });

  if (!allDisabled) {
    return;
  }

  selectedParts["Chassis"] = 1;
  selectedParts["Wheels (WASD)"] = 1;
  selectedParts["Lidar"] = 1;
  selectedParts["Camera (View)"] = 1;
  selectedParts["Arm (SPACE)"] = 2;
}

function setControlMode(mode, title, detail) {
  controlMode = mode;
  modeBannerTitle = title;
  modeBannerDetail = detail;
  if (mode === "manual") {
    applyManualPreset();
  }
}

function updateAssemblyPreview() {
  const turningLeft = stableGesture === "MOVE_LEFT" || manualKeys.KeyA;
  const turningRight = stableGesture === "MOVE_RIGHT" || manualKeys.KeyD;
  const chassisReady = selectedPart("Chassis") !== "None";
  const rotationDelta = turningLeft ? -2.2 : turningRight ? 2.2 : 0.28;

  robotAngle = normalizeAngle(robotAngle + rotationDelta);

  if (!chassisReady) {
    robotState = "SELECT CHASSIS";
  } else if (turningLeft || turningRight) {
    robotState = "ROTATING";
  } else {
    robotState = "ASSEMBLING";
  }
}

function setFont(context, size, weight = 500) {
  context.font = `${weight} ${size}px "Segoe UI", Arial, sans-serif`;
}

function fillText(context, text, x, y, size, color, align = "left", weight = 500) {
  context.save();
  setFont(context, size, weight);
  context.fillStyle = color;
  context.textAlign = align;
  context.textBaseline = "alphabetic";
  context.fillText(text, x, y);
  context.restore();
}

function measureTextWidth(context, text, size, weight = 500) {
  context.save();
  setFont(context, size, weight);
  const width = context.measureText(text).width;
  context.restore();
  return width;
}

function roundedRectPath(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function fillRoundedRect(context, x, y, width, height, radius, fillStyle) {
  context.save();
  roundedRectPath(context, x, y, width, height, radius);
  context.fillStyle = fillStyle;
  context.fill();
  context.restore();
}

function strokeRoundedRect(context, x, y, width, height, radius, strokeStyle, lineWidth = 1) {
  context.save();
  roundedRectPath(context, x, y, width, height, radius);
  context.strokeStyle = strokeStyle;
  context.lineWidth = lineWidth;
  context.stroke();
  context.restore();
}

function drawTriangle(context, x, y, size, fillStyle, strokeStyle = rgb(255, 255, 255), lineWidth = 1) {
  context.save();
  context.beginPath();
  context.moveTo(x, y - size);
  context.lineTo(x - size, y + size);
  context.lineTo(x + size, y + size);
  context.closePath();
  context.fillStyle = fillStyle;
  context.fill();
  context.strokeStyle = strokeStyle;
  context.lineWidth = lineWidth;
  context.stroke();
  context.restore();
}

function drawObjectShape(context, object, x, y, size, overrideFill = null) {
  const fillStyle = overrideFill ?? bgr(object.color);
  if (object.shape === "circle") {
    context.save();
    context.beginPath();
    context.arc(x, y, size, 0, Math.PI * 2);
    context.fillStyle = fillStyle;
    context.fill();
    context.strokeStyle = rgb(255, 255, 255);
    context.lineWidth = 1;
    context.stroke();
    context.restore();
    return;
  }
  if (object.shape === "square") {
    context.save();
    context.fillStyle = fillStyle;
    context.fillRect(x - size, y - size, size * 2, size * 2);
    context.strokeStyle = rgb(255, 255, 255);
    context.lineWidth = 1;
    context.strokeRect(x - size, y - size, size * 2, size * 2);
    context.restore();
    return;
  }
  drawTriangle(context, x, y, size, fillStyle);
}

function fingersUp(landmarks) {
  const tips = [8, 12, 16, 20];
  const pips = [6, 10, 14, 18];
  return tips.map((tip, index) => landmarks[tip].y < landmarks[pips[index]].y);
}

function thumbUp(landmarks, handedness = "Right") {
  return handedness === "Right" ? landmarks[4].x < landmarks[3].x : landmarks[4].x > landmarks[3].x;
}

function thumbClearlyExtended(landmarks, handedness = "Right") {
  const wrist = landmarks[0];
  const indexBase = landmarks[5];
  const pinkyBase = landmarks[17];
  const thumbKnuckle = landmarks[2];
  const thumbJoint = landmarks[3];
  const thumbTip = landmarks[4];
  const palmWidth = Math.max(
    0.0001,
    Math.hypot(indexBase.x - pinkyBase.x, indexBase.y - pinkyBase.y)
  );
  const thumbReach = Math.hypot(thumbTip.x - indexBase.x, thumbTip.y - indexBase.y);
  const thumbLateral = handedness === "Right"
    ? Math.min(thumbKnuckle.x, thumbJoint.x, indexBase.x) - thumbTip.x
    : thumbTip.x - Math.max(thumbKnuckle.x, thumbJoint.x, indexBase.x);
  const thumbAwayFromWrist = Math.hypot(thumbTip.x - wrist.x, thumbTip.y - wrist.y);

  return thumbUp(landmarks, handedness)
    && thumbReach > palmWidth * 0.78
    && thumbLateral > palmWidth * 0.24
    && thumbAwayFromWrist > palmWidth * 1.05;
}

function classifyGesture(landmarks, handedness = "Right") {
  const [index, middle, ring, pinky] = fingersUp(landmarks);
  const upCount = [index, middle, ring, pinky].filter(Boolean).length;
  if (upCount === 0) {
    return "LAND";
  }
  if (upCount === 4) {
    return thumbClearlyExtended(landmarks, handedness) ? "HOVER" : "MOVE_LEFT";
  }
  if (upCount === 1 && index) {
    return "MOVE_FORWARD";
  }
  if (upCount === 2 && index && middle) {
    return "MOVE_BACKWARD";
  }
  if (upCount === 3 && index && middle && ring) {
    return "MOVE_RIGHT";
  }
  return "NONE";
}

function updateStableGesture(newGesture) {
  gestureHistory.push(newGesture);
  if (gestureHistory.length > GESTURE_STABLE_FRAMES) {
    gestureHistory.shift();
  }
  if (gestureHistory.length === GESTURE_STABLE_FRAMES && new Set(gestureHistory).size === 1) {
    stableGesture = gestureHistory[0];
  }
}

function updateStableActionGesture(newGesture) {
  actionGestureHistory.push(newGesture);
  if (actionGestureHistory.length > GESTURE_STABLE_FRAMES) {
    actionGestureHistory.shift();
  }
  if (actionGestureHistory.length === GESTURE_STABLE_FRAMES && new Set(actionGestureHistory).size === 1) {
    stableActionGesture = actionGestureHistory[0];
  }
}

function getAdjacentMazeNodes(x, z) {
  const tileX = Math.floor(x);
  const tileZ = Math.floor(z);
  const options = [];
  const directions = [
    { stepX: 2, stepZ: 0, midX: 1, midZ: 0 },
    { stepX: -2, stepZ: 0, midX: -1, midZ: 0 },
    { stepX: 0, stepZ: 2, midX: 0, midZ: 1 },
    { stepX: 0, stepZ: -2, midX: 0, midZ: -1 }
  ];

  for (const direction of directions) {
    const corridorX = tileX + direction.midX;
    const corridorZ = tileZ + direction.midZ;
    const nextTileX = tileX + direction.stepX;
    const nextTileZ = tileZ + direction.stepZ;
    if (mazeGrid[corridorZ]?.[corridorX] !== 0 || mazeGrid[nextTileZ]?.[nextTileX] !== 0) {
      continue;
    }
    options.push({ x: nextTileX + 0.5, z: nextTileZ + 0.5 });
  }

  return options;
}

function updateMazeCompletion() {
  if (mazeSolved) {
    return;
  }
  const exitDist = Math.hypot(robotX - mazeExit.x, robotZ - mazeExit.z);
  if (exitDist <= 0.45) {
    mazeSolved = true;
    mazeSolvedAt = frameSeconds;
    robotState = "CLEARED";
  }
}

function updateRobot() {
  if (mazeSolved) {
    robotState = "CLEARED";
    return;
  }
  if (robotFrozen) {
    robotState = "FROZEN";
    return;
  }

  const wheels = selectedPart("Wheels (WASD)");
  if (wheels === "None") {
    robotState = "IDLE";
    return;
  }

  let driveIntent = 0;
  let turnIntent = 0;

  if (controlMode === "manual") {
    if (manualKeys.KeyW && !manualKeys.KeyS) {
      driveIntent = 1;
    } else if (manualKeys.KeyS && !manualKeys.KeyW) {
      driveIntent = -1;
    }
    if (manualKeys.KeyA && !manualKeys.KeyD) {
      turnIntent = -1;
    } else if (manualKeys.KeyD && !manualKeys.KeyA) {
      turnIntent = 1;
    }
  } else if (stableGesture !== "HOVER" && stableGesture !== "LAND" && stableGesture !== "NONE") {
    if (stableGesture === "MOVE_FORWARD") {
      driveIntent = 1;
    } else if (stableGesture === "MOVE_BACKWARD") {
      driveIntent = -1;
    } else if (stableGesture === "MOVE_LEFT") {
      turnIntent = -1;
    } else if (stableGesture === "MOVE_RIGHT") {
      turnIntent = 1;
    }
  }

  const turnMultiplier = wheels === "Treads" ? 1.15 : wheels === "Legs" ? 0.8 : 1.0;
  const driveMultiplier = wheels === "Treads" ? 0.92 : wheels === "Legs" ? 0.85 : 1.0;

  if (turnIntent !== 0) {
    robotAngle = normalizeAngle(robotAngle + turnIntent * TURN_SPEED * turnMultiplier);
  }

  if (driveIntent > 0) {
    moveRobot(DRIVE_SPEED * driveMultiplier);
  } else if (driveIntent < 0) {
    moveRobot(-REVERSE_SPEED * driveMultiplier);
  }

  if (driveIntent > 0) {
    robotState = turnIntent === 0 ? "DRIVING" : "STEERING";
  } else if (driveIntent < 0) {
    robotState = "REVERSING";
  } else if (turnIntent !== 0) {
    robotState = "TURNING";
  } else {
    robotState = "STANDING";
  }

  updateMazeCompletion();
}

function tryPickup() {
  if (heldObject !== null) {
    return;
  }
  if (selectedPart("Arm (SPACE)") !== "Extended") {
    return;
  }
  let bestDist = PICKUP_RANGE;
  let bestIndex = null;
  const forward = getRobotForwardVector();
  for (let i = 0; i < staticObjects.length; i += 1) {
    const object = staticObjects[i];
    const dx = object.x - robotX;
    const dz = object.z - robotZ;
    const dist = Math.hypot(dx, dz);
    const facing = dx * forward.x + dz * forward.z;
    if (dist < bestDist && facing > -0.15) {
      bestDist = dist;
      bestIndex = i;
    }
  }
  if (bestIndex !== null) {
    heldObject = staticObjects[bestIndex];
    heldObjectIndex = bestIndex;
  }
}

function tryDrop() {
  if (heldObject === null) {
    return;
  }
  const forward = getRobotForwardVector();
  const dropX = robotX + forward.x * 0.35;
  const dropZ = robotZ + forward.z * 0.35;
  if (!isBlockedAt(dropX, dropZ)) {
    heldObject.x = dropX;
    heldObject.z = dropZ;
  } else {
    heldObject.x = robotX;
    heldObject.z = robotZ;
  }
  heldObject = null;
  heldObjectIndex = null;
}

function updateWanderingHumans() {
  for (const human of wanderingHumans) {
    const targetDx = human.targetX - human.x;
    const targetDz = human.targetZ - human.z;
    const targetDist = Math.hypot(targetDx, targetDz);

    if (targetDist < 0.08) {
      const options = getAdjacentMazeNodes(human.x, human.z).filter((option) => (
        Math.hypot((human.lastNodeX ?? human.x) - option.x, (human.lastNodeZ ?? human.z) - option.z) > 0.1
      ));
      const nextTarget = choose(options.length > 0 ? options : getAdjacentMazeNodes(human.x, human.z));
      if (nextTarget) {
        human.lastNodeX = human.x;
        human.lastNodeZ = human.z;
        human.targetX = nextTarget.x;
        human.targetZ = nextTarget.z;
      }
      continue;
    }

    const step = Math.min(human.speed, targetDist);
    const nextX = human.x + (targetDx / targetDist) * step;
    const nextZ = human.z + (targetDz / targetDist) * step;
    if (!isBlockedAt(nextX, nextZ)) {
      human.x = nextX;
      human.z = nextZ;
    } else {
      human.targetX = human.x;
      human.targetZ = human.z;
    }
  }
}

function drawStickFigure(context, x, y, scale, color) {
  const stroke = Array.isArray(color) ? bgr(color) : color;
  const s = Math.max(0.4, scale);
  const headRadius = Math.round(4 * s);
  const bodyLength = Math.round(14 * s);
  const legLength = Math.round(10 * s);
  const armLength = Math.round(8 * s);
  const headY = y - bodyLength - headRadius;

  context.save();
  context.strokeStyle = stroke;
  context.fillStyle = stroke;
  context.lineWidth = Math.max(1, Math.round(2 * s));
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.arc(x, headY, headRadius, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = rgb(255, 255, 255);
  context.lineWidth = 1;
  context.stroke();
  context.strokeStyle = stroke;
  context.lineWidth = Math.max(1, Math.round(2 * s));
  context.beginPath();
  context.moveTo(x, headY + headRadius);
  context.lineTo(x, y);
  context.moveTo(x, headY + headRadius + Math.round(4 * s));
  context.lineTo(x - armLength, headY + headRadius + Math.round(8 * s));
  context.moveTo(x, headY + headRadius + Math.round(4 * s));
  context.lineTo(x + armLength, headY + headRadius + Math.round(8 * s));
  context.moveTo(x, y);
  context.lineTo(x - Math.round(5 * s), y + legLength);
  context.moveTo(x, y);
  context.lineTo(x + Math.round(5 * s), y + legLength);
  context.stroke();
  context.restore();
}

function getLidarDetections(maxRange = 4.0) {
  const detections = [];
  for (let i = 0; i < staticObjects.length; i += 1) {
    if (i === heldObjectIndex) {
      continue;
    }
    const object = staticObjects[i];
    const dx = object.x - robotX;
    const dz = object.z - robotZ;
    const dist = Math.hypot(dx, dz);
    if (dist <= maxRange) {
      detections.push({ type: object.shape[0].toUpperCase() + object.shape.slice(1), dist });
    }
  }
  for (const human of wanderingHumans) {
    const dx = human.x - robotX;
    const dz = human.z - robotZ;
    const dist = Math.hypot(dx, dz);
    if (dist <= maxRange) {
      detections.push({ type: "Human", dist });
    }
  }
  const exitDist = Math.hypot(mazeExit.x - robotX, mazeExit.z - robotZ);
  if (!mazeSolved && exitDist <= maxRange) {
    detections.push({ type: "Exit", dist: exitDist });
  }
  const wallProbes = [
    { type: "Front wall", angleOffset: 0 },
    { type: "Left wall", angleOffset: -40 },
    { type: "Right wall", angleOffset: 40 }
  ];
  for (const probe of wallProbes) {
    const hit = castRay(robotX, robotZ, robotAngle * DEG_TO_RAD + probe.angleOffset * DEG_TO_RAD, maxRange);
    if (hit.hit && hit.distance <= maxRange) {
      detections.push({ type: probe.type, dist: hit.distance });
    }
  }
  detections.sort((a, b) => a.dist - b.dist);
  return detections;
}

function drawRobotModel(context, centerX, centerY, previewScale = 1) {
  const chassis = selectedPart("Chassis");
  const wheels = selectedPart("Wheels (WASD)");
  const lidar = selectedPart("Lidar");
  const camera = selectedPart("Camera (View)");
  const arm = selectedPart("Arm (SPACE)");

  if (chassis === "None" && wheels === "None" && lidar === "Off" && camera === "None" && arm === "None") {
    return;
  }

  const tempSize = 250;
  const tc = tempSize / 2;
  const s = previewScale;
  const t = frameSeconds;
  let bodyWidth = 0;
  let bodyHeight = 0;

  tempRobotCtx.clearRect(0, 0, tempSize, tempSize);
  tempRobotCtx.save();
  tempRobotCtx.lineCap = "round";
  tempRobotCtx.lineJoin = "round";

  const greenBody = [80, 180, 80];
  const greenBorder = [60, 220, 60];
  const blackWheel = [30, 30, 30];
  const wheelBorder = [80, 80, 80];
  const redLidar = [60, 60, 240];
  const blueCam = [240, 160, 40];
  const purpleArm = [200, 60, 200];
  const purpleDark = [150, 40, 150];

  if (chassis !== "None") {
    if (chassis === "Standard") {
      bodyWidth = Math.round(60 * s);
      bodyHeight = Math.round(45 * s);
    } else if (chassis === "Tank") {
      bodyWidth = Math.round(70 * s);
      bodyHeight = Math.round(50 * s);
    } else if (chassis === "Humanoid") {
      bodyWidth = Math.round(50 * s);
      bodyHeight = Math.round(55 * s);
    } else if (chassis === "Spider") {
      bodyWidth = Math.round(55 * s);
      bodyHeight = Math.round(55 * s);
    } else {
      bodyWidth = Math.round(60 * s);
      bodyHeight = Math.round(45 * s);
    }

    tempRobotCtx.fillStyle = bgr(greenBody);
    tempRobotCtx.fillRect(tc - bodyWidth / 2, tc - bodyHeight / 2, bodyWidth, bodyHeight);
    tempRobotCtx.strokeStyle = bgr(greenBorder);
    tempRobotCtx.lineWidth = 2;
    tempRobotCtx.strokeRect(tc - bodyWidth / 2, tc - bodyHeight / 2, bodyWidth, bodyHeight);
    tempRobotCtx.strokeStyle = bgr([70, 150, 70]);
    tempRobotCtx.lineWidth = 1;
    tempRobotCtx.beginPath();
    tempRobotCtx.moveTo(tc - bodyWidth / 2 + 6, tc);
    tempRobotCtx.lineTo(tc + bodyWidth / 2 - 6, tc);
    tempRobotCtx.stroke();
    if (chassis === "Tank") {
      tempRobotCtx.beginPath();
      tempRobotCtx.moveTo(tc, tc - bodyHeight / 2 + 4);
      tempRobotCtx.lineTo(tc, tc + bodyHeight / 2 - 4);
      tempRobotCtx.stroke();
    } else if (chassis === "Spider") {
      tempRobotCtx.beginPath();
      tempRobotCtx.moveTo(tc - bodyWidth / 3, tc - bodyHeight / 3);
      tempRobotCtx.lineTo(tc + bodyWidth / 3, tc + bodyHeight / 3);
      tempRobotCtx.moveTo(tc + bodyWidth / 3, tc - bodyHeight / 3);
      tempRobotCtx.lineTo(tc - bodyWidth / 3, tc + bodyHeight / 3);
      tempRobotCtx.stroke();
    }
  }

  const isMoving = ["DRIVING", "REVERSING", "STEERING", "TURNING"].includes(robotState);
  if (wheels !== "None" && chassis !== "None") {
    const wheelRadius = Math.round(14 * s);
    if (wheels === "Treads") {
      const treadWidth = Math.round(14 * s);
      const treadHeight = Math.round(bodyHeight * 0.95);
      for (const side of [-1, 1]) {
        const trackX = tc + side * (bodyWidth / 2 + treadWidth / 2 + Math.round(2 * s));
        tempRobotCtx.fillStyle = bgr(blackWheel);
        tempRobotCtx.fillRect(trackX - treadWidth / 2, tc - treadHeight / 2, treadWidth, treadHeight);
        tempRobotCtx.strokeStyle = bgr(wheelBorder);
        tempRobotCtx.lineWidth = 2;
        tempRobotCtx.strokeRect(trackX - treadWidth / 2, tc - treadHeight / 2, treadWidth, treadHeight);
        const spacing = Math.max(1, Math.floor(treadHeight / 6));
        const treadOffset = isMoving ? Math.floor((t * 80) % spacing) : 0;
        for (let j = 0; j < 8; j += 1) {
          const lineY = Math.floor(tc - treadHeight / 2 + j * spacing + treadOffset);
          if (lineY >= tc - treadHeight / 2 && lineY <= tc + treadHeight / 2) {
            tempRobotCtx.beginPath();
            tempRobotCtx.moveTo(trackX - treadWidth / 2 + 2, lineY);
            tempRobotCtx.lineTo(trackX + treadWidth / 2 - 2, lineY);
            tempRobotCtx.strokeStyle = bgr(wheelBorder);
            tempRobotCtx.lineWidth = 1;
            tempRobotCtx.stroke();
          }
        }
      }
    } else if (wheels === "Legs") {
      const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
      corners.forEach(([sx, sy], index) => {
        const phase = isMoving ? Math.sin(t * 8 + index * Math.PI / 2) : 0;
        const legExtend = Math.round(6 * s + phase * 4 * s);
        const legX = tc + sx * (bodyWidth / 2 + legExtend);
        const legY = tc + sy * (bodyHeight / 2 - Math.round(4 * s));
        tempRobotCtx.beginPath();
        tempRobotCtx.fillStyle = bgr(blackWheel);
        tempRobotCtx.arc(legX, legY, Math.round(7 * s), 0, Math.PI * 2);
        tempRobotCtx.fill();
        tempRobotCtx.strokeStyle = bgr(wheelBorder);
        tempRobotCtx.lineWidth = 2;
        tempRobotCtx.stroke();
        tempRobotCtx.beginPath();
        tempRobotCtx.moveTo(tc + sx * (bodyWidth / 2), legY);
        tempRobotCtx.lineTo(legX, legY);
        tempRobotCtx.strokeStyle = bgr([100, 100, 100]);
        tempRobotCtx.lineWidth = Math.max(1, Math.round(2 * s));
        tempRobotCtx.stroke();
      });
    } else {
      const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
      corners.forEach(([sx, sy], index) => {
        const wheelX = tc + sx * (bodyWidth / 2 + Math.round(4 * s));
        const wheelY = tc + sy * (bodyHeight / 2 - Math.round(2 * s));
        tempRobotCtx.beginPath();
        tempRobotCtx.fillStyle = bgr(blackWheel);
        tempRobotCtx.arc(wheelX, wheelY, wheelRadius, 0, Math.PI * 2);
        tempRobotCtx.fill();
        tempRobotCtx.strokeStyle = bgr(wheelBorder);
        tempRobotCtx.lineWidth = 2;
        tempRobotCtx.stroke();
        tempRobotCtx.beginPath();
        tempRobotCtx.fillStyle = bgr([60, 60, 60]);
        tempRobotCtx.arc(wheelX, wheelY, Math.round(5 * s), 0, Math.PI * 2);
        tempRobotCtx.fill();
        tempRobotCtx.strokeStyle = bgr(wheelBorder);
        tempRobotCtx.lineWidth = 1;
        tempRobotCtx.stroke();
        const spokeRadius = wheelRadius - 2;
        for (let spoke = 0; spoke < 3; spoke += 1) {
          const angle = (isMoving ? t * 10 : 0) + spoke * Math.PI * 2 / 3 + (isMoving ? index * 0.3 : 0);
          const dx = spokeRadius * Math.cos(angle);
          const dy = spokeRadius * Math.sin(angle);
          tempRobotCtx.beginPath();
          tempRobotCtx.moveTo(wheelX, wheelY);
          tempRobotCtx.lineTo(wheelX + dx, wheelY + dy);
          tempRobotCtx.strokeStyle = bgr(wheelBorder);
          tempRobotCtx.lineWidth = isMoving ? 2 : 1;
          tempRobotCtx.stroke();
        }
      });
    }
  }

  if (lidar === "On" && chassis !== "None") {
    const lidarX = tc;
    const lidarY = tc - Math.round(8 * s);
    const scanRadius = Math.round(12 * s + Math.abs(Math.sin(t * 8)) * 6);
    tempRobotCtx.save();
    tempRobotCtx.shadowBlur = Math.round(18 * s);
    tempRobotCtx.shadowColor = bgr(redLidar);
    tempRobotCtx.beginPath();
    tempRobotCtx.fillStyle = bgr(redLidar);
    tempRobotCtx.arc(lidarX, lidarY, Math.round(8 * s), 0, Math.PI * 2);
    tempRobotCtx.fill();
    tempRobotCtx.restore();
    tempRobotCtx.beginPath();
    tempRobotCtx.arc(lidarX, lidarY, Math.round(8 * s), 0, Math.PI * 2);
    tempRobotCtx.strokeStyle = bgr([80, 80, 255]);
    tempRobotCtx.lineWidth = 2;
    tempRobotCtx.stroke();
    tempRobotCtx.beginPath();
    tempRobotCtx.arc(lidarX, lidarY, scanRadius, 0, Math.PI * 2);
    tempRobotCtx.strokeStyle = bgr([80, 80, 255]);
    tempRobotCtx.lineWidth = 1;
    tempRobotCtx.stroke();
  }

  if (camera !== "None" && chassis !== "None") {
    const camX = tc;
    const camY = tc + Math.round(10 * s);
    const camRadius = camera === "Standard" ? Math.round(5 * s) : camera === "Wide-Angle" ? Math.round(7 * s) : Math.round(6 * s);
    tempRobotCtx.beginPath();
    tempRobotCtx.arc(camX, camY, camRadius, 0, Math.PI * 2);
    if (camera === "Thermal") {
      tempRobotCtx.fillStyle = bgr([0, 100, 255]);
      tempRobotCtx.fill();
      tempRobotCtx.strokeStyle = bgr([0, 140, 255]);
    } else {
      tempRobotCtx.fillStyle = bgr(blueCam);
      tempRobotCtx.fill();
      tempRobotCtx.strokeStyle = bgr([255, 200, 80]);
    }
    tempRobotCtx.lineWidth = 2;
    tempRobotCtx.stroke();
    tempRobotCtx.beginPath();
    tempRobotCtx.arc(camX - Math.round(1 * s), camY - Math.round(1 * s), Math.max(1, Math.round(1 * s)), 0, Math.PI * 2);
    tempRobotCtx.fillStyle = rgb(255, 255, 255);
    tempRobotCtx.fill();
  }

  if (arm !== "None" && chassis !== "None") {
    const armBaseY = tc - bodyHeight / 2;
    tempRobotCtx.strokeStyle = bgr(purpleArm);
    tempRobotCtx.lineCap = "round";
    tempRobotCtx.lineJoin = "round";
    if (arm === "Extended") {
      const armTopY = armBaseY - Math.round(30 * s);
      const forearmTopY = armTopY - Math.round(20 * s);
      const gripLength = Math.round(12 * s);
      const gripSpread = heldObject !== null ? Math.round(4 * s) : gripLength;
      tempRobotCtx.lineWidth = Math.max(2, Math.round(5 * s));
      tempRobotCtx.beginPath();
      tempRobotCtx.moveTo(tc, armBaseY);
      tempRobotCtx.lineTo(tc, armTopY);
      tempRobotCtx.stroke();
      tempRobotCtx.beginPath();
      tempRobotCtx.fillStyle = bgr(purpleDark);
      tempRobotCtx.arc(tc, armTopY, Math.round(4 * s), 0, Math.PI * 2);
      tempRobotCtx.fill();
      tempRobotCtx.strokeStyle = bgr(purpleArm);
      tempRobotCtx.lineWidth = 2;
      tempRobotCtx.stroke();
      tempRobotCtx.lineWidth = Math.max(2, Math.round(4 * s));
      tempRobotCtx.beginPath();
      tempRobotCtx.moveTo(tc, armTopY);
      tempRobotCtx.lineTo(tc, forearmTopY);
      tempRobotCtx.stroke();
      tempRobotCtx.save();
      tempRobotCtx.shadowBlur = 10;
      tempRobotCtx.shadowColor = bgr(purpleArm);
      tempRobotCtx.beginPath();
      tempRobotCtx.arc(tc, forearmTopY, Math.round(3 * s), 0, Math.PI * 2);
      tempRobotCtx.fillStyle = bgr(purpleArm);
      tempRobotCtx.fill();
      tempRobotCtx.restore();
      tempRobotCtx.lineWidth = Math.max(2, Math.round(3 * s));
      tempRobotCtx.beginPath();
      tempRobotCtx.moveTo(tc, forearmTopY);
      tempRobotCtx.lineTo(tc - gripSpread, forearmTopY - gripLength);
      tempRobotCtx.moveTo(tc, forearmTopY);
      tempRobotCtx.lineTo(tc + gripSpread, forearmTopY - gripLength);
      tempRobotCtx.stroke();
      tempRobotCtx.beginPath();
      tempRobotCtx.fillStyle = bgr(purpleDark);
      tempRobotCtx.arc(tc - gripSpread, forearmTopY - gripLength, Math.round(3 * s), 0, Math.PI * 2);
      tempRobotCtx.arc(tc + gripSpread, forearmTopY - gripLength, Math.round(3 * s), 0, Math.PI * 2);
      tempRobotCtx.fill();
      if (heldObject !== null) {
        const gripTipY = forearmTopY - Math.round(gripLength * 0.7);
        const objectSize = Math.round(heldObject.size * s * 0.8);
        drawObjectShape(tempRobotCtx, heldObject, tc, gripTipY, objectSize, bgr(heldObject.color));
      }
    } else {
      const armTopY = armBaseY - Math.round(15 * s);
      tempRobotCtx.lineWidth = Math.max(2, Math.round(5 * s));
      tempRobotCtx.beginPath();
      tempRobotCtx.moveTo(tc, armBaseY);
      tempRobotCtx.lineTo(tc, armTopY);
      tempRobotCtx.stroke();
      tempRobotCtx.beginPath();
      tempRobotCtx.fillStyle = bgr(purpleDark);
      tempRobotCtx.arc(tc, armTopY, Math.round(4 * s), 0, Math.PI * 2);
      tempRobotCtx.fill();
      tempRobotCtx.strokeStyle = bgr(purpleArm);
      tempRobotCtx.lineWidth = 2;
      tempRobotCtx.stroke();
    }
  }

  tempRobotCtx.restore();

  context.save();
  context.translate(centerX, centerY);
  context.rotate((robotAngle + 180) * Math.PI / 180);
  context.drawImage(tempRobotCanvas, -tempSize / 2, -tempSize / 2);
  context.restore();
}

function updateToolboxLogic(x, y, isPinching, nowSeconds) {
  const boxSize = 100;
  const padding = 15;
  const totalWidth = TOOLBOX_CATEGORIES.length * boxSize + (TOOLBOX_CATEGORIES.length - 1) * padding;
  const startX = (SIM_W - totalWidth) / 2;
  const startY = 65;

  let cursorInUi = false;
  if (x >= startX && x <= startX + totalWidth && y >= startY && y <= startY + boxSize) {
    cursorInUi = true;
  }

  const chassisEquipped = selectedPart("Chassis") !== "None";
  if (!chassisEquipped) {
    for (const category of TOOLBOX_CATEGORIES) {
      if (category !== "Chassis") {
        selectedParts[category] = 0;
      }
    }
  }

  let currentHover = null;
  TOOLBOX_CATEGORIES.forEach((category, index) => {
    const boxX = startX + index * (boxSize + padding);
    const boxY = startY;
    const isHover = x >= boxX && x <= boxX + boxSize && y >= boxY && y <= boxY + boxSize;
    if (!isHover) {
      return;
    }
    currentHover = category;
    if (category !== "Chassis" && !chassisEquipped) {
      return;
    }
    if (lastHoveredCat !== category) {
      if (selectedParts[category] === 0 && TOOLBOX_PARTS[category].length > 1) {
        selectedParts[category] = 1;
      } else {
        selectedParts[category] = 0;
      }
    }
    if (isPinching && nowSeconds - lastClickTime > CLICK_COOLDOWN) {
      selectedParts[category] = (selectedParts[category] + 1) % TOOLBOX_PARTS[category].length;
      lastClickTime = nowSeconds;
    }
  });

  lastHoveredCat = currentHover;
  return cursorInUi;
}

function drawToolbox(context, x, y) {
  const boxSize = 100;
  const padding = 15;
  const totalWidth = TOOLBOX_CATEGORIES.length * boxSize + (TOOLBOX_CATEGORIES.length - 1) * padding;
  const startX = (SIM_W - totalWidth) / 2;
  const startY = 65;
  const cornerRadius = 12;
  const chassisEquipped = selectedPart("Chassis") !== "None";

  fillText(context, "Toolbox", SIM_W / 2, 50, 30, rgb(255, 255, 255), "center", 700);

  TOOLBOX_CATEGORIES.forEach((category, index) => {
    const boxX = startX + index * (boxSize + padding);
    const boxY = startY;
    const isHover = x >= boxX && x <= boxX + boxSize && y >= boxY && y <= boxY + boxSize;
    const locked = category !== "Chassis" && !chassisEquipped;
    const color = locked ? rgb(40, 40, 40) : bgr(TOOLBOX_COLORS[index]);
    const activePart = selectedPart(category);
    const shortName = category.split(" (")[0];
    const isOn = activePart !== "None" && activePart !== "Off";
    const label = locked ? "--" : isOn ? "On" : "Off";
    const textColor = locked ? rgb(80, 80, 80) : rgb(255, 255, 255);

    fillRoundedRect(context, boxX, boxY, boxSize, boxSize, cornerRadius, color);
    if (isHover && !locked) {
      strokeRoundedRect(context, boxX - 2, boxY - 2, boxSize + 4, boxSize + 4, cornerRadius, rgb(255, 255, 255), 2);
    }

    fillText(context, shortName, boxX + boxSize / 2, boxY + 45, 18, textColor, "center", 500);
    fillText(context, label, boxX + boxSize / 2, boxY + 70, 20, textColor, "center", 700);
  });
}

function getCameraProfile() {
  const camType = selectedPart("Camera (View)");
  if (camType === "Wide-Angle") {
    return {
      type: camType,
      label: "WIDE-ANGLE",
      fovDeg: 96,
      skyTop: [18, 40, 70],
      skyBottom: [70, 110, 165],
      floorTop: [34, 52, 32],
      floorBottom: [12, 18, 18],
      wallMain: [172, 189, 164],
      wallSide: [120, 138, 115],
      accent: [70, 205, 255],
      thermal: false
    };
  }
  if (camType === "Thermal") {
    return {
      type: camType,
      label: "THERMAL",
      fovDeg: 74,
      skyTop: [25, 10, 12],
      skyBottom: [85, 32, 26],
      floorTop: [65, 30, 12],
      floorBottom: [16, 8, 6],
      wallMain: [255, 140, 40],
      wallSide: [170, 72, 22],
      accent: [255, 186, 32],
      thermal: true
    };
  }
  if (camType === "Standard") {
    return {
      type: camType,
      label: "STANDARD",
      fovDeg: 78,
      skyTop: [20, 30, 52],
      skyBottom: [85, 110, 160],
      floorTop: [28, 42, 36],
      floorBottom: [10, 16, 18],
      wallMain: [160, 176, 154],
      wallSide: [104, 120, 100],
      accent: [72, 224, 208],
      thermal: false
    };
  }
  return {
    type: camType,
    label: "BASIC VISUALS",
    fovDeg: 70,
    skyTop: [12, 16, 20],
    skyBottom: [58, 66, 88],
    floorTop: [24, 24, 26],
    floorBottom: [6, 8, 10],
    wallMain: [122, 126, 128],
    wallSide: [82, 86, 90],
    accent: [184, 184, 184],
    thermal: false
  };
}

function castRay(originX, originZ, angle, maxDistance = MAX_VIEW_DISTANCE) {
  const rayDirX = Math.cos(angle);
  const rayDirZ = Math.sin(angle);
  let mapX = Math.floor(originX);
  let mapZ = Math.floor(originZ);
  const deltaDistX = rayDirX === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / rayDirX);
  const deltaDistZ = rayDirZ === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / rayDirZ);

  let stepX = 0;
  let stepZ = 0;
  let sideDistX = 0;
  let sideDistZ = 0;

  if (rayDirX < 0) {
    stepX = -1;
    sideDistX = (originX - mapX) * deltaDistX;
  } else {
    stepX = 1;
    sideDistX = (mapX + 1 - originX) * deltaDistX;
  }

  if (rayDirZ < 0) {
    stepZ = -1;
    sideDistZ = (originZ - mapZ) * deltaDistZ;
  } else {
    stepZ = 1;
    sideDistZ = (mapZ + 1 - originZ) * deltaDistZ;
  }

  let hit = false;
  let side = 0;
  let distance = 0;

  while (!hit && distance < maxDistance) {
    if (sideDistX < sideDistZ) {
      distance = sideDistX;
      sideDistX += deltaDistX;
      mapX += stepX;
      side = 0;
    } else {
      distance = sideDistZ;
      sideDistZ += deltaDistZ;
      mapZ += stepZ;
      side = 1;
    }

    if (mapX < 0 || mapZ < 0 || mapX >= mazeWidth || mapZ >= mazeHeight) {
      hit = true;
      distance = maxDistance;
    } else if (mazeGrid[mapZ][mapX] === 1) {
      hit = true;
    }
  }

  const finalDistance = Math.min(distance, maxDistance);
  return {
    hit,
    distance: finalDistance,
    side,
    mapX,
    mapZ,
    hitX: originX + rayDirX * finalDistance,
    hitZ: originZ + rayDirZ * finalDistance
  };
}

function getNearestPickupCandidate() {
  if (selectedPart("Arm (SPACE)") !== "Extended" || heldObject !== null) {
    return null;
  }
  const forward = getRobotForwardVector();
  let bestObject = null;
  let bestDistance = PICKUP_RANGE;

  for (let i = 0; i < staticObjects.length; i += 1) {
    if (i === heldObjectIndex) {
      continue;
    }
    const object = staticObjects[i];
    const dx = object.x - robotX;
    const dz = object.z - robotZ;
    const dist = Math.hypot(dx, dz);
    const facing = dx * forward.x + dz * forward.z;
    if (dist < bestDistance && facing > -0.15) {
      bestObject = { object, distance: dist };
      bestDistance = dist;
    }
  }

  return bestObject;
}

function drawExitMarker(context, x, y, size, accent) {
  const glow = 0.55 + 0.45 * Math.sin(frameSeconds * 4);
  const width = size * 0.7;
  const height = size * 1.05;
  context.save();
  context.shadowBlur = 18;
  context.shadowColor = rgb(accent[0], accent[1], accent[2], 0.6);
  fillRoundedRect(context, x - width / 2, y - height, width, height, 14, rgb(26, 30, 28, 0.9));
  strokeRoundedRect(context, x - width / 2, y - height, width, height, 14, rgb(accent[0], accent[1], accent[2], 0.95), 2);
  context.beginPath();
  context.moveTo(x - width * 0.18, y - height * 0.74);
  context.lineTo(x + width * 0.22, y - height * 0.5);
  context.lineTo(x - width * 0.18, y - height * 0.26);
  context.strokeStyle = rgb(accent[0], accent[1], accent[2], glow);
  context.lineWidth = 4;
  context.stroke();
  context.restore();
}

function drawMazeSprites(context, profile, horizonY, depthBuffer) {
  const sprites = [];
  const forward = getRobotForwardVector();
  const right = getRobotRightVector();
  const halfFovTan = Math.tan((profile.fovDeg * DEG_TO_RAD) / 2);
  const maxViewDistance = profile.thermal ? MAX_VIEW_DISTANCE + 2 : MAX_VIEW_DISTANCE;

  const pushSprite = (type, data, worldX, worldZ) => {
    const dx = worldX - robotX;
    const dz = worldZ - robotZ;
    const depth = dx * forward.x + dz * forward.z;
    if (depth <= 0.12 || depth > maxViewDistance) {
      return;
    }
    const lateral = dx * right.x + dz * right.z;
    if (Math.abs(lateral) > depth * halfFovTan * 1.35) {
      return;
    }

    const normalizedX = lateral / (depth * halfFovTan);
    const screenX = SIM_W / 2 + normalizedX * (SIM_W / 2);
    const depthIndex = clamp(Math.floor(screenX / RAY_STRIP_WIDTH), 0, depthBuffer.length - 1);
    if (depth > depthBuffer[depthIndex] + 0.2) {
      return;
    }

    const floorAnchor = horizonY + Math.min(SIM_H * 0.4, (SIM_H * 0.52) / Math.max(depth, 0.3));
    sprites.push({ type, data, depth, screenX, floorAnchor });
  };

  for (let i = 0; i < staticObjects.length; i += 1) {
    if (i === heldObjectIndex) {
      continue;
    }
    const object = staticObjects[i];
    pushSprite("object", object, object.x, object.z);
  }

  for (const human of wanderingHumans) {
    pushSprite("human", human, human.x, human.z);
  }

  if (!mazeSolved) {
    pushSprite("exit", mazeExit, mazeExit.x, mazeExit.z);
  }

  sprites.sort((a, b) => b.depth - a.depth);

  for (const sprite of sprites) {
    const depthFrac = clamp(1 - sprite.depth / maxViewDistance, 0, 1);
    if (sprite.type === "object") {
      const size = clamp((sprite.data.size * 25) / sprite.depth, 8, 170);
      const fillStyle = profile.thermal
        ? rgb(255, Math.round(120 + depthFrac * 80), Math.round(20 + depthFrac * 30))
        : bgr(sprite.data.color);
      drawObjectShape(context, sprite.data, sprite.screenX, sprite.floorAnchor - size * 0.55, size, fillStyle);
    } else if (sprite.type === "human") {
      const humanScale = clamp(4.8 / sprite.depth, 0.45, 3.2);
      const tone = profile.thermal
        ? [20, Math.round(130 + depthFrac * 110), 255]
        : sprite.data.color;
      drawStickFigure(context, sprite.screenX, sprite.floorAnchor, humanScale, tone);
    } else if (sprite.type === "exit") {
      const size = clamp(200 / sprite.depth, 34, 210);
      drawExitMarker(context, sprite.screenX, sprite.floorAnchor + size * 0.15, size, profile.accent);
    }
  }
}

function renderRobotCameraView() {
  const viewWidth = robotViewCanvas.width;
  const viewHeight = robotViewCanvas.height;
  const profile = getCameraProfile();
  const scale = Math.min((viewWidth - 26) / mazeWidth, (viewHeight - 26) / mazeHeight);
  const offsetX = (viewWidth - mazeWidth * scale) / 2;
  const offsetY = (viewHeight - mazeHeight * scale) / 2;

  robotViewCtx.clearRect(0, 0, viewWidth, viewHeight);
  fillRoundedRect(robotViewCtx, 0, 0, viewWidth, viewHeight, 18, rgb(9, 13, 16, 0.95));

  for (let z = 0; z < mazeHeight; z += 1) {
    for (let x = 0; x < mazeWidth; x += 1) {
      const wall = mazeGrid[z][x] === 1;
      robotViewCtx.fillStyle = wall
        ? rgb(profile.wallSide[0] * 0.45, profile.wallSide[1] * 0.45, profile.wallSide[2] * 0.45)
        : rgb(18, 24, 28);
      robotViewCtx.fillRect(offsetX + x * scale, offsetY + z * scale, scale, scale);
    }
  }

  robotViewCtx.fillStyle = rgb(profile.accent[0], profile.accent[1], profile.accent[2], 0.2);
  for (const object of staticObjects) {
    if (object === heldObject) {
      continue;
    }
    robotViewCtx.beginPath();
    robotViewCtx.arc(offsetX + object.x * scale, offsetY + object.z * scale, Math.max(2, scale * 0.18), 0, Math.PI * 2);
    robotViewCtx.fill();
  }

  robotViewCtx.fillStyle = profile.thermal ? rgb(255, 160, 50) : rgb(170, 220, 255);
  for (const human of wanderingHumans) {
    robotViewCtx.beginPath();
    robotViewCtx.arc(offsetX + human.x * scale, offsetY + human.z * scale, Math.max(2.5, scale * 0.22), 0, Math.PI * 2);
    robotViewCtx.fill();
  }

  robotViewCtx.save();
  robotViewCtx.shadowBlur = 12;
  robotViewCtx.shadowColor = rgb(profile.accent[0], profile.accent[1], profile.accent[2], 0.6);
  robotViewCtx.fillStyle = rgb(profile.accent[0], profile.accent[1], profile.accent[2], 0.95);
  robotViewCtx.beginPath();
  robotViewCtx.arc(offsetX + mazeExit.x * scale, offsetY + mazeExit.z * scale, Math.max(4, scale * 0.28), 0, Math.PI * 2);
  robotViewCtx.fill();
  robotViewCtx.restore();

  const heading = robotAngle * DEG_TO_RAD;
  const coneAngle = (profile.fovDeg * DEG_TO_RAD) / 2;
  const robotMapX = offsetX + robotX * scale;
  const robotMapZ = offsetY + robotZ * scale;
  const coneLength = Math.max(18, scale * 2.8);

  robotViewCtx.save();
  robotViewCtx.fillStyle = rgb(profile.accent[0], profile.accent[1], profile.accent[2], 0.18);
  robotViewCtx.beginPath();
  robotViewCtx.moveTo(robotMapX, robotMapZ);
  robotViewCtx.lineTo(robotMapX + Math.cos(heading - coneAngle) * coneLength, robotMapZ + Math.sin(heading - coneAngle) * coneLength);
  robotViewCtx.lineTo(robotMapX + Math.cos(heading + coneAngle) * coneLength, robotMapZ + Math.sin(heading + coneAngle) * coneLength);
  robotViewCtx.closePath();
  robotViewCtx.fill();
  robotViewCtx.restore();

  robotViewCtx.beginPath();
  robotViewCtx.arc(robotMapX, robotMapZ, Math.max(3.5, scale * 0.24), 0, Math.PI * 2);
  robotViewCtx.fillStyle = rgb(255, 255, 255);
  robotViewCtx.fill();
  robotViewCtx.strokeStyle = rgb(profile.accent[0], profile.accent[1], profile.accent[2], 1);
  robotViewCtx.lineWidth = 2;
  robotViewCtx.stroke();

  fillText(robotViewCtx, "MAZE NAV", 14, 22, 15, rgb(220, 230, 235), "left", 700);
  fillText(robotViewCtx, profile.label, viewWidth - 14, 22, 13, rgb(profile.accent[0], profile.accent[1], profile.accent[2]), "right", 700);
}

function drawAssemblyStatusPanel(context) {
  const panelWidth = 760;
  const panelHeight = 236;
  const panelX = 16;
  const panelY = SIM_H - panelHeight - 16;
  const summaryLines = [
    `State: ${robotState}`,
    `Scene: 3D assembly bay`,
    `Control: ${controlMode === "manual" ? "keyboard shortcuts" : "hand-tracked toolbox"}`,
    selectedPart("Chassis") === "None"
      ? "Ready: choose a chassis to begin"
      : "Ready: chassis locked, refine the build"
  ];

  fillRoundedRect(context, panelX, panelY, panelWidth, panelHeight, 18, rgb(8, 14, 18, 0.84));
  strokeRoundedRect(context, panelX, panelY, panelWidth, panelHeight, 18, rgb(56, 118, 126, 0.85), 1);
  fillText(context, "ASSEMBLY STATUS", panelX + 18, panelY + 28, 21, rgb(226, 235, 240), "left", 700);

  summaryLines.forEach((line, index) => {
    fillText(context, line, panelX + 18, panelY + 58 + index * 22, 17, rgb(210, 215, 220), "left", 500);
  });

  fillText(context, "CURRENT BUILD", panelX + 18, panelY + 144, 16, rgb(150, 170, 180), "left", 700);
  [
    ["Chassis", TOOLBOX_COLORS[0]],
    ["Wheels (WASD)", TOOLBOX_COLORS[1]],
    ["Lidar", TOOLBOX_COLORS[2]],
    ["Camera (View)", TOOLBOX_COLORS[3]],
    ["Arm (SPACE)", TOOLBOX_COLORS[4]]
  ].forEach(([category, color], index) => {
    const lineY = panelY + 166 + index * 14;
    context.beginPath();
    context.arc(panelX + 21, lineY - 5, 4, 0, Math.PI * 2);
    context.fillStyle = bgr(color);
    context.fill();
    fillText(
      context,
      `${category.split(" (")[0]}: ${selectedPart(category)}`,
      panelX + 34,
      lineY,
      14,
      rgb(220, 225, 230),
      "left",
      500
    );
  });

  const notesX = panelX + 330;
  fillText(context, "ASSEMBLY NOTES", notesX, panelY + 28, 18, rgb(90, 226, 220), "left", 700);
  [
    "Press 1 first to cycle chassis types",
    "Then use 2-5 to add mobility, sensing, and arm modules",
    "Press A / D to rotate the 3D preview"
  ].forEach((line, index) => {
    fillText(context, line, notesX, panelY + 56 + index * 22, 15, rgb(196, 205, 210), "left", 500);
  });

  const previewX = panelX + panelWidth - 190;
  const previewY = panelY + 44;
  fillRoundedRect(context, previewX, previewY, 160, 160, 14, rgb(14, 18, 20, 0.85));
  strokeRoundedRect(context, previewX, previewY, 160, 160, 14, rgb(80, 90, 96, 0.8), 1);
  fillText(context, "ROBOT", previewX + 80, previewY + 22, 16, rgb(210, 220, 225), "center", 700);
  drawRobotModel(context, previewX + 80, previewY + 94, 0.48);
}

function drawStatusPanel(context) {
  if (isAssemblyMode) {
    drawAssemblyStatusPanel(context);
    return;
  }

  const panelWidth = 760;
  const panelHeight = 236;
  const panelX = 16;
  const panelY = SIM_H - panelHeight - 16;
  const exitDistance = Math.hypot(mazeExit.x - robotX, mazeExit.z - robotZ);
  const currentTileX = Math.max(1, Math.floor((Math.floor(robotX) - 1) / 2) + 1);
  const currentTileZ = Math.max(1, Math.floor((Math.floor(robotZ) - 1) / 2) + 1);

  fillRoundedRect(context, panelX, panelY, panelWidth, panelHeight, 18, rgb(10, 14, 18, 0.84));
  strokeRoundedRect(context, panelX, panelY, panelWidth, panelHeight, 18, rgb(78, 100, 110, 0.85), 1);
  fillText(context, "ROBOT STATUS", panelX + 18, panelY + 28, 21, rgb(230, 235, 240), "left", 700);

  const infoLines = [
    `State: ${robotState}`,
    `Cell: ${currentTileX}, ${currentTileZ}`,
    mazeSolved ? "Exit: reached" : `Exit: ${exitDistance.toFixed(1)}m`,
    heldObject === null ? "Payload: none" : `Payload: ${heldObject.shape}`
  ];
  infoLines.forEach((line, index) => {
    fillText(context, line, panelX + 18, panelY + 58 + index * 22, 17, rgb(210, 215, 220), "left", 500);
  });

  fillText(context, "EQUIPPED", panelX + 18, panelY + 144, 16, rgb(150, 170, 180), "left", 700);
  let row = 0;
  for (const [category, color] of [
    ["Chassis", TOOLBOX_COLORS[0]],
    ["Wheels (WASD)", TOOLBOX_COLORS[1]],
    ["Lidar", TOOLBOX_COLORS[2]],
    ["Camera (View)", TOOLBOX_COLORS[3]],
    ["Arm (SPACE)", TOOLBOX_COLORS[4]]
  ]) {
    const value = selectedPart(category);
    if (value === "None" || value === "Off") {
      continue;
    }
    const lineY = panelY + 166 + row * 14;
    context.beginPath();
    context.arc(panelX + 21, lineY - 5, 4, 0, Math.PI * 2);
    context.fillStyle = bgr(color);
    context.fill();
    fillText(context, `${category.split(" (")[0]}: ${value}`, panelX + 34, lineY, 14, rgb(220, 225, 230), "left", 500);
    row += 1;
  }
  if (row === 0) {
    fillText(context, "No active parts", panelX + 18, panelY + 168, 14, rgb(120, 130, 135), "left", 500);
  }

  const lidarX = panelX + 285;
  fillText(context, "LIDAR / MAZE CONTACTS", lidarX, panelY + 28, 18, bgr([110, 120, 240]), "left", 700);
  if (selectedPart("Lidar") !== "On") {
    fillText(context, "Offline", lidarX, panelY + 56, 16, rgb(120, 130, 135), "left", 500);
  } else {
    const detections = getLidarDetections(5.5);
    if (detections.length === 0) {
      fillText(context, "No contacts in range", lidarX, panelY + 56, 16, rgb(140, 200, 150), "left", 500);
    } else {
      detections.slice(0, 8).forEach((detection, index) => {
        const lineY = panelY + 56 + index * 20;
        const color = detection.dist < 1.3
          ? [40, 70, 255]
          : detection.dist < 2.8
            ? [60, 200, 255]
            : [90, 220, 120];
        context.beginPath();
        context.arc(lidarX + 5, lineY - 4, 4, 0, Math.PI * 2);
        context.fillStyle = bgr(color);
        context.fill();
        fillText(context, `${detection.type} ${detection.dist.toFixed(1)}m`, lidarX + 16, lineY, 15, bgr(color), "left", 500);
      });
    }
  }

  const previewX = panelX + panelWidth - 190;
  const previewY = panelY + 44;
  fillRoundedRect(context, previewX, previewY, 160, 160, 14, rgb(14, 18, 20, 0.85));
  strokeRoundedRect(context, previewX, previewY, 160, 160, 14, rgb(80, 90, 96, 0.8), 1);
  fillText(context, "ROBOT", previewX + 80, previewY + 22, 16, rgb(210, 220, 225), "center", 700);
  drawRobotModel(context, previewX + 80, previewY + 94, 0.48);
}

function drawAssemblySim() {
  ctx.clearRect(0, 0, SIM_W, SIM_H);

  const background = ctx.createLinearGradient(0, 0, 0, SIM_H);
  background.addColorStop(0, rgb(5, 10, 14));
  background.addColorStop(0.55, rgb(7, 14, 18));
  background.addColorStop(1, rgb(3, 7, 10));
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, SIM_W, SIM_H);

  const glow = ctx.createRadialGradient(SIM_W / 2, SIM_H * 0.46, 80, SIM_W / 2, SIM_H * 0.46, 760);
  glow.addColorStop(0, "rgba(38, 222, 190, 0.18)");
  glow.addColorStop(0.55, "rgba(0, 110, 120, 0.10)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, SIM_W, SIM_H);

  ctx.save();
  ctx.strokeStyle = rgb(34, 74, 82, 0.48);
  ctx.lineWidth = 1;
  for (let y = Math.floor(SIM_H * 0.42); y < SIM_H; y += 42) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(SIM_W, y);
    ctx.stroke();
  }
  const horizonX = SIM_W / 2;
  const horizonY = Math.floor(SIM_H * 0.44);
  for (let offset = -11; offset <= 11; offset += 1) {
    ctx.beginPath();
    ctx.moveTo(horizonX, horizonY);
    ctx.lineTo(horizonX + offset * 170, SIM_H);
    ctx.stroke();
  }
  ctx.restore();

  const platformY = SIM_H * 0.76;
  fillRoundedRect(ctx, SIM_W / 2 - 380, platformY - 118, 760, 170, 32, rgb(7, 14, 18, 0.92));
  strokeRoundedRect(ctx, SIM_W / 2 - 380, platformY - 118, 760, 170, 32, rgb(64, 180, 196, 0.55), 2);

  ctx.save();
  ctx.strokeStyle = rgb(120, 250, 240, 0.18);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(SIM_W / 2, platformY - 34, 250, 64, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(SIM_W / 2, platformY - 34, 330, 84, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  drawRobotModel(ctx, SIM_W / 2, SIM_H * 0.54, 1.58);

  fillText(ctx, "3D ASSEMBLY BAY", 28, SIM_H - 128, 18, rgb(80, 230, 220), "left", 700);
  fillText(
    ctx,
    selectedPart("Chassis") === "None"
      ? "Select a chassis first. Then cycle modules with 2-5 to complete the robot"
      : "Rotate the preview with A / D or hand gestures, then switch to the maze when the build is ready",
    28,
    SIM_H - 102,
    17,
    rgb(215, 220, 225),
    "left",
    500
  );
  fillText(
    ctx,
    "Use the centered toolbox to swap components in place",
    28,
    SIM_H - 76,
    16,
    rgb(104, 214, 255),
    "left",
    500
  );

  ctx.save();
  const vignette = ctx.createRadialGradient(SIM_W / 2, SIM_H / 2, SIM_H * 0.18, SIM_W / 2, SIM_H / 2, SIM_H * 0.76);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, SIM_W, SIM_H);
  ctx.restore();
}

function drawSim() {
  if (isAssemblyMode) {
    drawAssemblySim();
    return;
  }

  ctx.clearRect(0, 0, SIM_W, SIM_H);
  const profile = getCameraProfile();
  const horizonY = Math.floor(SIM_H * 0.4);
  const halfFov = (profile.fovDeg * DEG_TO_RAD) / 2;
  const rayCount = Math.ceil(SIM_W / RAY_STRIP_WIDTH);
  const heading = robotAngle * DEG_TO_RAD;

  const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
  sky.addColorStop(0, rgb(profile.skyTop[0], profile.skyTop[1], profile.skyTop[2]));
  sky.addColorStop(1, rgb(profile.skyBottom[0], profile.skyBottom[1], profile.skyBottom[2]));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, SIM_W, horizonY);

  const floor = ctx.createLinearGradient(0, horizonY, 0, SIM_H);
  floor.addColorStop(0, rgb(profile.floorTop[0], profile.floorTop[1], profile.floorTop[2]));
  floor.addColorStop(1, rgb(profile.floorBottom[0], profile.floorBottom[1], profile.floorBottom[2]));
  ctx.fillStyle = floor;
  ctx.fillRect(0, horizonY, SIM_W, SIM_H - horizonY);

  lastRayDepths = new Array(rayCount);
  for (let i = 0; i < rayCount; i += 1) {
    const cameraX = ((i + 0.5) / rayCount) * 2 - 1;
    const rayAngle = heading + Math.atan(cameraX * Math.tan(halfFov));
    const hit = castRay(robotX, robotZ, rayAngle);
    const correctedDistance = Math.max(0.12, hit.distance * Math.cos(rayAngle - heading));
    lastRayDepths[i] = correctedDistance;

    const wallHeight = Math.min(SIM_H * 0.95, (SIM_H * 0.88) / correctedDistance);
    const wallTop = horizonY - wallHeight / 2;
    const shade = clamp(1 - correctedDistance / MAX_VIEW_DISTANCE, 0.12, 1);
    const palette = hit.side === 0 ? profile.wallMain : profile.wallSide;
    const pulse = mazeSolved ? 0.15 * Math.sin(frameSeconds * 4) + 0.85 : 1;
    ctx.fillStyle = rgb(
      Math.round((palette[0] * shade + 12) * pulse),
      Math.round((palette[1] * shade + 12) * pulse),
      Math.round((palette[2] * shade + 12) * pulse)
    );
    ctx.fillRect(i * RAY_STRIP_WIDTH, wallTop, RAY_STRIP_WIDTH + 1, wallHeight);
  }

  updateWanderingHumans();
  drawMazeSprites(ctx, profile, horizonY, lastRayDepths);

  const crossX = SIM_W / 2;
  const crossY = SIM_H / 2;
  ctx.save();
  ctx.strokeStyle = rgb(profile.accent[0], profile.accent[1], profile.accent[2], 0.92);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(crossX - 12, crossY);
  ctx.lineTo(crossX - 4, crossY);
  ctx.moveTo(crossX + 4, crossY);
  ctx.lineTo(crossX + 12, crossY);
  ctx.moveTo(crossX, crossY - 12);
  ctx.lineTo(crossX, crossY - 4);
  ctx.moveTo(crossX, crossY + 4);
  ctx.lineTo(crossX, crossY + 12);
  ctx.stroke();
  ctx.restore();

  const pickupCandidate = getNearestPickupCandidate();
  fillText(ctx, profile.label, 28, SIM_H - 128, 18, rgb(profile.accent[0], profile.accent[1], profile.accent[2]), "left", 700);
  fillText(ctx, mazeSolved ? "Maze cleared. Loading next maze..." : "Drive to the glowing exit beacon", 28, SIM_H - 102, 17, rgb(215, 220, 225), "left", 500);
  if (pickupCandidate !== null) {
    fillText(ctx, "Object in range. Use Space or left-hand fist to pick it up", 28, SIM_H - 76, 16, rgb(90, 230, 240), "left", 500);
  } else if (heldObject !== null) {
    fillText(ctx, "Payload locked. Use Space or left-hand fist to drop it", 28, SIM_H - 76, 16, rgb(120, 210, 255), "left", 500);
  }

  ctx.save();
  const vignette = ctx.createRadialGradient(SIM_W / 2, SIM_H / 2, SIM_H * 0.2, SIM_W / 2, SIM_H / 2, SIM_H * 0.75);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, SIM_W, SIM_H);
  ctx.restore();
}

function drawCursor() {
  const cursorColor = pinching ? bgr([0, 255, 0]) : bgr([0, 200, 255]);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cursorX, cursorY, 10, 0, Math.PI * 2);
  ctx.fillStyle = cursorColor;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cursorX, cursorY, 14, 0, Math.PI * 2);
  ctx.strokeStyle = rgb(255, 255, 255);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawPip() {
  if (isAssemblyMode) {
    const pipSize = 350;
    const pipX = SIM_W - pipSize - 20;
    const pipY = SIM_H - pipSize - 20;
    const hasCameraFeed = cameraAvailable && video.readyState >= 2;

    fillRoundedRect(ctx, pipX, pipY, pipSize, pipSize, 16, rgb(8, 12, 16, 0.96));
    if (hasCameraFeed) {
      const cropSize = Math.min(CAM_W, CAM_H);
      const cropX = (CAM_W - cropSize) / 2;
      const cropY = (CAM_H - cropSize) / 2;
      ctx.drawImage(detectionCanvas, cropX, cropY, cropSize, cropSize, pipX + 20, pipY + 20, pipSize - 40, 150);
    }

    fillText(ctx, "ASSEMBLY CONTROLS", pipX + pipSize / 2, pipY + (hasCameraFeed ? 208 : 56), 24, bgr([255, 200, 0]), "center", 700);
    [
      "1-5 cycle component slots",
      "A / D rotate the preview rig",
      "Use the Maze page to test-drive the finished robot",
      "Q stops the simulation"
    ].forEach((line, index) => {
      fillText(
        ctx,
        line,
        pipX + pipSize / 2,
        pipY + (hasCameraFeed ? 246 : 104) + index * 34,
        18,
        rgb(205, 214, 220),
        "center",
        500
      );
    });

    ctx.save();
    ctx.strokeStyle = bgr([255, 200, 0]);
    ctx.lineWidth = 2;
    ctx.strokeRect(pipX, pipY, pipSize, pipSize);
    ctx.restore();
    return;
  }

  const pipSize = 350;
  const pipX = SIM_W - pipSize - 20;
  const pipY = SIM_H - pipSize - 20;
  const hasCameraFeed = cameraAvailable && video.readyState >= 2;

  if (hasCameraFeed) {
    const cropSize = Math.min(CAM_W, CAM_H);
    const cropX = (CAM_W - cropSize) / 2;
    const cropY = (CAM_H - cropSize) / 2;
    ctx.drawImage(detectionCanvas, cropX, cropY, cropSize, cropSize, pipX, pipY, pipSize, pipSize);
  } else {
    fillRoundedRect(ctx, pipX, pipY, pipSize, pipSize, 16, rgb(8, 12, 16, 0.96));
    fillText(ctx, "MANUAL PILOT", pipX + pipSize / 2, pipY + 56, 26, bgr([255, 200, 0]), "center", 700);
    fillText(ctx, "W / S drive", pipX + pipSize / 2, pipY + 116, 22, rgb(210, 220, 225), "center", 600);
    fillText(ctx, "A / D steer", pipX + pipSize / 2, pipY + 148, 22, rgb(210, 220, 225), "center", 600);
    fillText(ctx, "M new maze", pipX + pipSize / 2, pipY + 208, 20, rgb(80, 190, 255), "center", 700);
    fillText(ctx, "1-5 toggle parts", pipX + pipSize / 2, pipY + 248, 18, rgb(200, 205, 210), "center", 500);
    fillText(ctx, "Space pick/drop", pipX + pipSize / 2, pipY + 280, 18, rgb(200, 205, 210), "center", 500);
    fillText(ctx, "Q stop simulation", pipX + pipSize / 2, pipY + 312, 18, rgb(160, 170, 176), "center", 500);
  }

  ctx.save();
  ctx.strokeStyle = bgr([255, 200, 0]);
  ctx.lineWidth = 2;
  ctx.strokeRect(pipX, pipY, pipSize, pipSize);
  ctx.restore();

  renderRobotCameraView();
  const viewWidth = robotViewCanvas.width;
  const viewHeight = robotViewCanvas.height;
  const viewX = pipX - viewWidth - 8;
  const viewY = pipY + pipSize - viewHeight;
  ctx.drawImage(robotViewCanvas, viewX, viewY);
  ctx.save();
  ctx.strokeStyle = bgr([255, 200, 0]);
  ctx.lineWidth = 1;
  ctx.strokeRect(viewX, viewY, viewWidth, viewHeight);
  ctx.beginPath();
  ctx.fillStyle = bgr([0, 180, 255]);
  ctx.arc(viewX + 10, viewY + 12, 4, 0, Math.PI * 2);
  ctx.fill();
  fillText(ctx, "Maze map", viewX + 18, viewY + 16, 14, rgb(255, 255, 255), "left", 500);
  ctx.restore();
}

function drawFrozenLabel() {
  fillText(ctx, "FROZEN", SIM_W / 2, 35, 36, bgr([0, 80, 255]), "center", 700);
}

function drawBootScreen() {
  ctx.clearRect(0, 0, SIM_W, SIM_H);
  ctx.fillStyle = rgb(0, 0, 0);
  ctx.fillRect(0, 0, SIM_W, SIM_H);
  ctx.save();
  ctx.strokeStyle = bgr([25, 45, 45]);
  ctx.lineWidth = 1;
  for (let i = 0; i < 18; i += 1) {
    const y = 140 + i * 42;
    ctx.beginPath();
    ctx.moveTo(260, y);
    ctx.lineTo(SIM_W - 260, y);
    ctx.stroke();
  }
  for (let i = 0; i < 22; i += 1) {
    const x = 240 + i * 66;
    ctx.beginPath();
    ctx.moveTo(x, 160);
    ctx.lineTo(x, SIM_H - 160);
    ctx.stroke();
  }
  ctx.restore();
  fillText(ctx, bootTitle, SIM_W / 2, SIM_H / 2 - 24, 42, bootError ? bgr([40, 80, 255]) : bgr([255, 200, 0]), "center", 700);
  fillText(ctx, bootDetail, SIM_W / 2, SIM_H / 2 + 24, 22, rgb(180, 180, 180), "center", 500);
}

function setBootScreen(title, detail, isError = false) {
  bootTitle = title;
  bootDetail = detail;
  bootError = isError;
  drawBootScreen();
}

function stopApp() {
  if (!running) {
    return;
  }
  running = false;
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
  }
  setBootScreen("STOPPED", "Reload the page to start again");
}

async function loadVisionModule() {
  const errors = [];
  for (const source of MEDIAPIPE_SOURCES) {
    try {
      const loaded = await import(source.moduleUrl);
      if (!loaded?.FilesetResolver || !loaded?.HandLandmarker) {
        throw new Error("MediaPipe module loaded without required exports");
      }
      activeWasmRoot = source.wasmRoot;
      return loaded;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${source.moduleUrl} -> ${message}`);
    }
  }
  throw new Error(`Could not load MediaPipe Tasks Vision. ${errors[0] ?? "Unknown error"}`);
}

function processDetections(results, nowMs) {
  currentGesture = "NONE";
  actionGesture = "NONE";
  pinching = false;
  showCursor = false;
  cursorX = -100;
  cursorY = -100;

  const landmarksList = results?.landmarks ?? [];
  const handednessList = results?.handedness ?? results?.handednesses ?? [];

  if (landmarksList.length > 0) {
    let movementLm = null;
    let actionLm = null;
    let movementHandedness = "Right";

    for (let i = 0; i < landmarksList.length; i += 1) {
      const label = handednessList[i]?.[0]?.categoryName ?? "Right";
      if (label === "Right") {
        movementLm = landmarksList[i];
        movementHandedness = "Right";
      } else if (label === "Left") {
        actionLm = landmarksList[i];
      }
    }

    if (movementLm === null && actionLm !== null) {
      movementLm = actionLm;
      movementHandedness = "Left";
      actionLm = null;
    }

    if (movementLm !== null) {
      cursorX = movementLm[8].x * SIM_W;
      cursorY = movementLm[8].y * SIM_H;
      pinching = Math.hypot(movementLm[8].x - movementLm[4].x, movementLm[8].y - movementLm[4].y) < 0.05;
      currentGesture = classifyGesture(movementLm, movementHandedness);
      showCursor = true;
    }

    if (actionLm !== null) {
      actionGesture = classifyGesture(actionLm, "Left");
    }
  }

  updateStableGesture(currentGesture);
  updateStableActionGesture(actionGesture);

  robotFrozen = stableActionGesture === "HOVER";

  const currentActionFist = stableActionGesture === "LAND";
  if (currentActionFist && !prevActionFist) {
    if (heldObject === null) {
      tryPickup();
    } else {
      tryDrop();
    }
  }
  prevActionFist = currentActionFist;

  const cursorInUi = updateToolboxLogic(cursorX, cursorY, pinching, nowMs / 1000);
  if (isAssemblyMode) {
    updateAssemblyPreview();
  } else if (!cursorInUi) {
    updateRobot();
  }

  if (heldObject !== null && selectedPart("Arm (SPACE)") !== "Extended") {
    tryDrop();
  }
}

function processManualControls() {
  currentGesture = "NONE";
  stableGesture = "NONE";
  actionGesture = "NONE";
  stableActionGesture = "NONE";
  pinching = false;
  showCursor = false;
  robotFrozen = false;

  if (manualKeys.KeyW && !manualKeys.KeyS) {
    stableGesture = "MOVE_FORWARD";
  } else if (manualKeys.KeyS && !manualKeys.KeyW) {
    stableGesture = "MOVE_BACKWARD";
  } else if (manualKeys.KeyA && !manualKeys.KeyD) {
    stableGesture = "MOVE_LEFT";
  } else if (manualKeys.KeyD && !manualKeys.KeyA) {
    stableGesture = "MOVE_RIGHT";
  }

  if (isAssemblyMode) {
    updateAssemblyPreview();
    return;
  }

  updateRobot();

  if (heldObject !== null && selectedPart("Arm (SPACE)") !== "Extended") {
    tryDrop();
  }
}

function drawMirroredVideoFrame() {
  detectionCtx.save();
  detectionCtx.clearRect(0, 0, CAM_W, CAM_H);
  detectionCtx.scale(-1, 1);
  detectionCtx.drawImage(video, -CAM_W, 0, CAM_W, CAM_H);
  detectionCtx.restore();
}

function loop(nowMs) {
  if (!running) {
    return;
  }

  frameSeconds = nowMs / 1000;

  const useHandTracking = controlMode === "gesture" && cameraAvailable && handTrackingAvailable && video.readyState >= 2;
  if (useHandTracking) {
    drawMirroredVideoFrame();

    let results = null;
    if (video.currentTime !== lastVideoTime) {
      results = handLandmarker.detectForVideo(detectionCanvas, nowMs);
      lastVideoTime = video.currentTime;
      lastDetectionResults = results;
    }

    processDetections(lastDetectionResults, nowMs);
  } else {
    processManualControls();
  }

  if (mazeSolved && frameSeconds - mazeSolvedAt > MAZE_RESET_DELAY) {
    resetMazeWorld();
  }

  drawSim();

  if (robotFrozen) {
    drawFrozenLabel();
  }

  drawToolbox(ctx, cursorX, cursorY);
  drawStatusPanel(ctx);

  if (showCursor) {
    drawCursor();
  }

  drawPip();
  requestAnimationFrame(loop);
}

async function setupHandTracking() {
  if (!visionModule) {
    visionModule = await loadVisionModule();
  }
  const vision = await visionModule.FilesetResolver.forVisionTasks(activeWasmRoot);
  handLandmarker = await visionModule.HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: HAND_LANDMARKER_MODEL_URL
    },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.4,
    minTrackingConfidence: 0.4,
    minHandPresenceConfidence: 0.4
  });
}

async function setupCamera() {
  if (!window.isSecureContext) {
    throw new Error("Camera requires localhost or HTTPS. Manual keyboard mode is active");
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera access is not supported in this browser");
  }

  mediaStream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",
      width: { ideal: CAM_W },
      height: { ideal: CAM_H }
    },
    audio: false
  });

  video.srcObject = mediaStream;

  await new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Failed to load camera stream"));
  });

  await video.play();
}

async function init() {
  try {
    if (directOpenMode) {
      setControlMode(
        "manual",
        isAssemblyMode ? "ASSEMBLY MANUAL MODE" : "DIRECT OPEN MODE",
        isAssemblyMode
          ? "Opened from a local file. Build the robot with 1-5 and rotate it with A / D"
          : "Opened from a local file. First-person maze drive is ready"
      );
      running = true;
      requestAnimationFrame(loop);
      return;
    }

    setBootScreen("INITIALIZING", "Loading MediaPipe");
    visionModule = await loadVisionModule();
    setBootScreen("INITIALIZING", "Loading hand tracking");
    await setupHandTracking();
    handTrackingAvailable = true;
    setBootScreen("INITIALIZING", "Opening camera");
    await setupCamera();
    cameraAvailable = true;
    setControlMode(
      "gesture",
      isAssemblyMode ? "ASSEMBLY GESTURE MODE" : "GESTURE MODE",
      isAssemblyMode
        ? "Camera and hand tracking are live for component selection"
        : "Camera and hand tracking are live for maze driving"
    );
    running = true;
    requestAnimationFrame(loop);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(error);
    setControlMode(
      "manual",
      isAssemblyMode ? "ASSEMBLY MANUAL MODE" : "MANUAL MODE",
      isAssemblyMode ? `${message} Use 1-5 to build and A / D to rotate the rig` : message
    );
    running = true;
    requestAnimationFrame(loop);
  }
}

window.addEventListener("keydown", (event) => {
  if (event.code in manualKeys) {
    manualKeys[event.code] = true;
  }

  if ((controlMode === "manual" || isAssemblyMode) && event.key >= "1" && event.key <= "5") {
    event.preventDefault();
    cycleSelectedPart(TOOLBOX_CATEGORIES[Number(event.key) - 1]);
  }

  if (event.code === "Space") {
    event.preventDefault();
    if (heldObject === null) {
      tryPickup();
    } else {
      tryDrop();
    }
  }
  if (event.key === "m" || event.key === "M") {
    event.preventDefault();
    if (!isAssemblyMode) {
      resetMazeWorld();
    }
  }
  if (event.key === "q" || event.key === "Q" || event.key === "Escape") {
    event.preventDefault();
    stopApp();
  }
});

window.addEventListener("keyup", (event) => {
  if (event.code in manualKeys) {
    manualKeys[event.code] = false;
  }
});

window.addEventListener("beforeunload", () => {
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
  }
});

resetMazeWorld();
drawBootScreen();
init();
