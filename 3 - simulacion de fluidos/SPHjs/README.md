# SPHjs

An interactive, dependency-free particle fluid demo for modern desktop and
mobile browsers.

## Run locally

```sh
npm start
```

Open [http://localhost:8000](http://localhost:8000).

The development server listens on all network interfaces, so another device
on the same LAN can also open `http://<this-computer's-ip>:8000`.

Motion sensors are restricted to secure contexts. They work on HTTPS
deployments and on `localhost`; loading a development machine over a plain
LAN IP will not expose the sensor API on most mobile browsers.

## Controls

- Choose the droplet tool, then hold or drag to pour fluid.
- Choose the hand tool to push fluid. Right-click, Shift-drag, or a second
  finger also pushes without changing tools.
- Choose the tilted-phone tool and accept the mobile browser permission prompt
  to toggle motion gravity.
- Choose the trash tool to clear the simulation.

## Implementation

- `js/WebGPUFluid.js`: fully GPU-resident particle state, atomic spatial grid,
  density/pressure relaxation, integration, collision handling, and two-pass
  textured water rendering. Particle state remains in GPU storage buffers
  between frames.
- `js/SPH.js`: fixed-step, typed-array SPH solver using an adjacent-cell
  spatial hash, one-pass particle pairs, bounded pressure corrections, and a
  vector velocity limit for the CPU fallback.
- `js/Renderer.js`: two-pass WebGL2 fallback renderer. Particle kernels are
  accumulated into a GPU texture, then thresholded in a full-screen shader;
  a non-pixel-scanning Canvas 2D fallback is also included.
- `js/MotionGravity.js`: user-gesture permission flow, low-pass filtering,
  and screen-orientation-aware IMU gravity.
- `js/index.js`: viewport sizing, adaptive render resolution, pointer input,
  and the fixed-timestep animation loop.

The renderer caps device pixel ratio and lowers render resolution under
sustained load. Particle limits are selected conservatively from available
device hints so accidental long presses do not lock up a phone.

On HTTPS, the app selects WebGPU automatically. If WebGPU or a compatible
adapter is unavailable, it falls back to the CPU solver with WebGL2 rendering.
For a repeatable dense-device check, open
`?particles=1800`; add `&gravity=left`, `right`, `up`, or `down` to exercise a
specific gravity direction.

Run the solver regression tests with `npm test`.

## License

MIT
