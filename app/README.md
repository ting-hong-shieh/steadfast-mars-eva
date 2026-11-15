# app: helmet view

Written with an AI tool (Claude). See `../AI_USE.md`.

What an astronaut sees on a walking EVA in Gale crater, drawn over real NASA ground. Every
element on screen, how it is made, what it rests on and its limit is listed in
`../docs/methods.md`. Read that file before you change what the screen shows. This page does
not repeat it.

## Run

    npm install
    npm run dev

Test: `npm test` (checks with a known answer for the planner, the oxygen model, the stations,
the line of sight and the finish-plan chance), then `npm run build && npm run capture`
(screenshots in `captures/`, fails on any page error). The whole set takes hours where the scene
is drawn in software, so a list of shots and a size can follow:
`node tools/capture.mjs captures tour,card desktop`.

`npm run routes` plans the walk with each choice of the plan screen and the way home from across
the square, on the shipped ground, and writes `../docs/checks/route_factors_check.json`.

## Keys

Every key also has a button at the bottom of the screen.

| Key | What it does |
|---|---|
| W S | Walk forward and back. A D turn. Drag to look |
| P | Walk the route by itself |
| Tab | Fold the panels to the short view, and open them again |
| C | Show the ground types in the model's colours |
| M | Open the world map. A click on the corner map does the same |
| L | Switch the map between the surface image and the geologic map |
| + − | Zoom the corner map. The mouse wheel over the map does the same |
| V | Look down at the footstep cues |
| G | Open or close the agent card |
| N | Sound on or off |
| ? | Start the guided tour again |
| Enter, Esc | Take or refuse a new route when the display suggests one off route |
| 1 2 3 | Choose on the card at a station |
| T | Simulator: add 30 minutes to the EVA clock |
| E | Simulator: the partner starts to use more oxygen |
| R | Simulator: start or stop the replay of the measured particle event |

## URL options

Any option skips the start screen, so captures and shared links open on the walk.

| Option | Meaning |
|---|---|
| `s=<m>` | Distance along the route |
| `t=<h>` | Hours elapsed (0 to 8) |
| `auto=1` | Auto walk |
| `look=down`, `look=back`, `yaw=<deg>` | Where the view points |
| `side=<m>` | Start that far to the right of the route |
| `alarm=1` | Replay of the particle event from the start |
| `ev2=median`, `ev2=max`, `ev2=<number>` | The partner's oxygen multiple |
| `classes=1` | Ground types in the model's colours |
| `agent=1` | Agent card open |
| `map=0` to `map=4`, `map=off`, `mapopen=0` to `mapopen=4`, `layer=geology` | Corner map |
| `hud=focus` | Start with the panels folded |
| `keys=0` | Hide the key bar |
| `intro=1`, `cleared=1` | Show the start screen, as before or after the guided tour |
| `tour=<1 to 7>` | Open one step of the guided tour (1 is the plan screen, 4 the stop at a station) |
| `steep=0`, `shade=1`, `load=<0, 10, 20, 30>`, `depart=<06:00, 08:08, 15:30>` | The choices of the plan screen: steep ground as an obstacle (on unless `steep=0`), avoid terrain shadow, carried load in kg, hour of departure |
| `demo=1` | Play the guided tour by itself |
| `explain=<id>` | Open one data-layer card (`terrain`, `imagery`, `ground`, `radiation`, `weather`, `geology`, `link`, `oxygen`, `sim`) |
| `cine=0`, `cine=1`, `cinek=<0 to 0.89>` | The descent (after the plan screen of the tour, and after travel on the world map): skip it, play it, hold it at one moment |
| `glass=<0 to 1>`, `sat=<0 to 3>` | The cards over the view: how dark their glass is and how much of the view's colour it keeps (0.35 and 1.1 when not given) |
| `site=<id>` | Another place on Curiosity's path |
| `world`, `world=<id>` | Open the world map, with one place chosen |
| `npc=0` | No rover and no robot in the scene |
| `game=0` | The display without the start screen, the guided tour, the station card and the layer cards |
| `fig=old`, `tint=assumed`, `look=old`, `ground=plain` | Earlier looks, kept for comparison |

`s=193` puts the walker 6 m before the first station, so its card opens at once. It is a
shortcut for captures.
