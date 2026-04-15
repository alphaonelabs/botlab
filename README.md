# Alpha One Labs — Virtual Robotics Playground

A browser-based robotics playground for assembling, configuring, and testing modular mobile robots directly in the browser. The project currently includes an animated landing page and three core simulation experiences:

1. A 2D robotics simulator
2. A 3D robot assembly experience
3. A 3D maze navigation challenge

No build system is required for the current prototype. The project is designed to be easy to open, inspect, and extend.

---

## Overview

This repository explores how far a lightweight, browser-native robotics sandbox can go using HTML, CSS, JavaScript, Canvas rendering, and gesture input.

The application is structured as a multi-entry playground:

- `index.html` is the animated landing page and navigation hub.
- `home.html` is the 2D robotics simulator.
- `3D/assemble.html` is the 3D assembly experience.
- `3D/index.html` is the 3D maze simulator.

The goal is to provide an accessible environment for robotics education and experimentation where users can:

- assemble a robot from modular parts
- simulate sensing with LiDAR and camera systems
- manipulate objects with a robotic arm
- observe telemetry and sensor feedback
- test robot configurations in a maze-like 3D challenge

---

## Core Experiences

### 1. 2D Robotics Simulator

The 2D simulator in `home.html` is a real-time Canvas-based robotics workspace with:

- modular part selection: chassis, wheels, LiDAR, camera, and arm
- keyboard-driven locomotion with adjustable power and turn settings
- object interaction through a robotic gripper
- moving human entities in the environment
- simulated LiDAR scanning and detection reporting
- a simulated first-person camera overlay
- live telemetry for position, heading, and speed
- persistent state saving with `localStorage`
- mobile-friendly on-screen touch controls

This mode works as a fast prototyping and interaction sandbox for robot behavior and sensor visualization.

### 2. 3D Robot Assembly

The 3D assembly experience in `3D/assemble.html` is the original gesture-driven assembly environment backed by `3D/assemble-app.js`.

It includes:

- a modular robot builder with multiple chassis, wheel, camera, LiDAR, and arm configurations
- gesture-based interaction using MediaPipe hand tracking
- keyboard fallback controls when camera access is unavailable
- a 3D-styled Canvas-rendered world with floating objects and moving humans
- a status panel showing equipped components and LiDAR scan results
- a simulated live robot camera panel
- object pickup and drop interactions when the robotic arm is extended

This experience focuses on immersive robot configuration and embodied interaction.

### 3. 3D Maze Navigation

The maze experience in `3D/index.html` is a separate 3D simulation built on `3D/app.js`.

It includes:

- procedural maze generation
- first-person maze navigation
- object and human placement inside the maze world
- a visible exit target and maze reset loop
- robot configuration controls for chassis, wheels, LiDAR, camera, and arm
- simulated LiDAR contacts and robot status feedback
- a mini-map / robot camera view
- manual and gesture-based control modes

This experience extends the robot beyond assembly into a challenge environment where the user can test mobility and perception.

---

## Landing Page

The landing page in `index.html` acts as the visual entry point to the platform and includes:

- animated background rendering
- React-based section composition
- GSAP-driven section transitions and scroll-triggered reveals
- branded navigation and route entry points
- direct links into all simulator experiences

It is designed to frame the playground as a polished open-science robotics product rather than just a single HTML demo.

---

## Feature Summary

### Modular Robot System

Across the simulator experiences, the robot can be configured with:

- `Chassis`
- `Wheels (WASD)`
- `LiDAR`
- `Camera (View)`
- `Arm (SPACE)`

The enabled modules affect movement, sensing, interaction, and visualization.

### Sensing and Perception

The repo simulates multiple sensing modalities:

- LiDAR-style detection in 2D and 3D
- first-person camera feeds
- object shape and color reporting
- human detection overlays in the 2D camera view

### Interaction

The project supports multiple interaction models:

- keyboard control
- mobile touch controls in the 2D simulator
- gesture control in the 3D assembly and maze experiences
- object pickup/drop using the robotic arm

### Persistence

The 2D simulator stores robot state, settings, and block state in `localStorage`, allowing the workspace to persist between reloads.

---

## Getting Started

### Option 1: Open directly

You can open the project directly in a browser:

1. Clone the repository:

```bash
git clone https://github.com/alphaonelabs/botlab.git
cd botlab
```

2. Open `index.html` in a modern browser.

This is enough for:

- the landing page
- the 2D robotics simulator
- manual fallback mode in the 3D experiences

### Option 2: Run a local static server

For full camera-based gesture control in the 3D experiences, use a local server so the browser can provide camera access under `localhost`:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/index.html
```

You can use any other static file server if preferred.

---

## Routes

| Route | Purpose |
|---|---|
| `index.html` | Animated landing page and simulator hub |
| `home.html` | 2D robotics simulator |
| `3D/assemble.html` | 3D robot assembly experience |
| `3D/index.html` | 3D maze simulation |

---

## Controls

### 2D Simulator

| Control | Action |
|---|---|
| `W` / `Arrow Up` | Move forward |
| `S` / `Arrow Down` | Move backward |
| `A` / `Arrow Left` | Turn left |
| `D` / `Arrow Right` | Turn right |
| `SPACE` | Pick up / drop block |
| Touch controls | Mobile movement and pickup |

### 3D Assembly

Manual mode:

- `W`, `A`, `S`, `D` move the robot
- `1` to `5` cycle robot parts
- `SPACE` picks up or drops an object
- `Q` / `Esc` stops the session

Gesture mode:

- right hand controls movement and aiming
- left hand handles freeze / action gestures
- pinch interaction is used to work with the toolbox

### 3D Maze

Manual mode:

- `W` / `S` drive forward and backward
- `A` / `D` steer
- `1` to `5` cycle robot parts
- `SPACE` picks up or drops an object
- `M` spawns a new maze
- `Q` / `Esc` stops the session

Gesture mode:

- right hand drives or steers the robot
- left hand handles freeze / action gestures

---

## Technical Highlights

### Frontend Stack

- HTML5
- CSS3
- JavaScript
- React 18 via CDN on the landing page
- Tailwind CSS via CDN
- GSAP for animated landing page transitions

### Simulation and Rendering

- Canvas 2D rendering for all simulator experiences
- custom real-time update/render loops
- custom robot drawing and part composition
- software-rendered 3D-style scenes
- procedural maze generation
- raycasting-based first-person maze rendering

### Vision / Gesture Input

- MediaPipe Tasks Vision for hand landmark detection
- gesture classification for robot control and interaction

---

## Project Structure

```text
alphaonelabs-virtual-robotics-playground/
├── index.html              # Landing page / navigation hub
├── home.html               # 2D robotics simulator
├── 3D/
│   ├── assemble.html       # 3D assembly entry page
│   ├── assemble-app.js     # Legacy 3D assembly logic
│   ├── assemble-style.css  # Styles for 3D assembly
│   ├── index.html          # 3D maze entry page
│   ├── app.js              # 3D maze logic
│   └── style.css           # Shared 3D maze styling
├── assets/
│   └── logo.png
├── README.md
├── CONTRIBUTING.md
└── LICENSE
```

---

## Browser Notes

- The 2D simulator works well when opened directly from disk.
- The 3D simulators can fall back to manual mode if camera access is not available.
- Full gesture control requires camera permission and a secure browser context such as `localhost`.

---

## Current Status

This project is an actively evolving prototype. The current repository already demonstrates:

- modular robot assembly
- sensor simulation
- object manipulation
- live UI telemetry
- gesture input
- 2D and 3D simulation paths
- a separate challenge-oriented maze environment

It is a strong base for future work in robotics education, simulation UX, and browser-native HRI experimentation.

---

## Contributing

Contributions, fixes, and improvements are welcome.

1. Fork the repository
2. Create a branch
3. Commit your changes
4. Push to your fork
5. Open a pull request

See [CONTRIBUTING.md](CONTRIBUTING.md) for repository guidelines.

---

## License

This project is licensed under the [MIT License](LICENSE).

---

Built by [Alpha One Labs](https://github.com/alphaonelabs) for open robotics experimentation and education.
