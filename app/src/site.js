// Written with an AI tool (Claude). See AI_USE.md.
// Which place in Gale crater the app shows. ?site=<id> picks one of the places in
// public/data/sites.json (tools/build_site_terrain.py). Without it: the main place, Curiosity's
// stop of sol 4709, the only one with rover-camera ground, ground classes and station photos.
//
// Every place is a real Curiosity stop (MSL PLACES). MEASURED: its position, sol and the orbital
// ground. OURS: the short names below, and at the other places the three stops of the walk, which
// are not rover targets. The display marks them IMAGINED.
const BASE = `${import.meta.env.BASE_URL}data/`;

// Our names for the places. Not names used by the mission.
const NAMES = {
  sol4709: ['BOXWORK', 'Main place. Rover-camera ground, ground types and Mastcam photos at the stops.'],
  sol0000: ['TOUCHDOWN', 'Where Curiosity landed. The flattest ground of the six.'],
  sol0717: ['FLATS', 'Crater floor on the way to the mountain.'],
  sol1720: ['FOOTHILL', 'The first climb.'],
  sol3036: ['TERRACE', 'Higher on the slope.'],
  sol4098: ['HIGH PASS', 'The steepest ground of the six.'],
};

export const SITE = { id: 'sol4709', main: true, x: 0, z: 0, sol: 4709, name: 'BOXWORK', base: BASE, all: [] };

export async function loadSites() {
  const j = await fetch(BASE + 'sites.json').then((r) => r.json());
  const all = [{ ...j.main, main: true, relief_m: null }, ...j.sites].map((s) => ({ ...s, name: NAMES[s.id][0], blurb: NAMES[s.id][1] }));
  const want = new URLSearchParams(location.search).get('site');
  const cur = all.find((s) => s.id === want && !s.main);
  Object.assign(SITE, cur ? { ...cur, main: false, base: `${BASE}sites/${cur.id}/` } : all[0], { all });
  if (!cur) SITE.base = BASE;
  return SITE;
}

// The walk at a place without rover targets: HAB at the rover stop and three stops 150 to 190 m
// away. IMAGINED: the positions are ours and nothing was documented there.
export const IMAGINED_PLACES = [
  { x: 0, z: 0, name: 'HAB' },
  { x: -105, z: -120, name: 'STN A', task: 'Imagined stop: not a rover target', workMin: 25, imagined: true },
  { x: 150, z: -20, name: 'STN B', task: 'Imagined stop: not a rover target', workMin: 25, imagined: true },
  { x: 60, z: 140, name: 'STN C', task: 'Imagined stop: not a rover target', workMin: 25, imagined: true },
  { x: 0, z: 0, name: 'HAB' },
];
