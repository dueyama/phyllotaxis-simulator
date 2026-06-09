# Phyllotaxis Simulator

An interactive browser simulator for phyllotactic pattern formation, based on the
Douady-Couder physical model [1] of primordia appearing at a repulsive-energy
minimum.

The app visualizes how a sequence of particles born near a central ring can form
Fibonacci parastichy pairs such as `3-5`, `5-8`, `8-13`, and `13-21` as the
dimensionless control parameter `G = V0T/R0` decreases.

## Features

- Real-time 2D phyllotaxis simulation in the browser.
- Potential-minimizing birth angle on the central ring.
- Outward radial motion with fixed `V0`; changing `G` changes the birth interval `T`.
- Presets for representative `G` values and staged transitions:
  - `G=3.0 -> 0.7`
  - `G=0.7 -> 0.5`
  - `G=0.5 -> 0.14`
  - `G=0.14 -> 0.044`
- Automatic spiral drawing after the visible particle field has been replaced by
  particles born after the target `G` was reached.
- Smooth visual motion option with a separate `dt` control.
- Localized UI:
  - Japanese when the browser language includes `ja`
  - English for all other browser languages

## Model

The simulator follows the core assumptions of Douady and Couder [1].

At each birth event, a new particle is placed on a circle of radius `R0` at the
angle that minimizes the total repulsive potential from existing particles. Existing
particles move outward at velocity `V0`. The displayed control parameter is:

```text
G = V0T / R0
```

where `T` is the birth interval. In this implementation, `R0` and `V0` are fixed,
so changing `G` changes `T`.

## Development

```bash
npm install
npm run dev
```

The development server uses Vite and binds to `127.0.0.1`.

## Build

```bash
npm run build
```

The generated site is a static Vite build and can be deployed directly to Vercel.

## Vercel Web Analytics

The app includes `@vercel/analytics` so Vercel can count visitors and page views
after deployment. Enable Web Analytics for the Vercel project from the Vercel
dashboard, then redeploy the site.

## References

[1] S. Douady and Y. Couder, "Phyllotaxis as a Physical Self-Organized Growth
Process," *Physical Review Letters* **68**(13), 2098-2101, 1992.

## Copyright

Copyright (c) 2026 dueyama. All rights reserved.
