import { Track } from './track.js';

// Tracks: every vertex is [x, y, height, cornerRadius] in physics units
// (10 units = 1 metre in the 3D world). Vertex 0 is the start/finish line and
// is always on a straight. The geometry has been checked: every corner radius
// is larger than the wall's distance from the centreline (otherwise the inner
// wall would fold over itself), and no part of a track comes closer to
// another part than two wall widths - except the bridge of the figure-eight,
// where the two legs are 8 metres apart vertically.
// Names and descriptions come from i18n.js (track.<id>.name/desc);
// `difficulty` is 'easy' | 'medium' | 'hard'.

export const TRACKS = [
  new Track({
    id: 'valley',
    difficulty: 'easy',
    theme: 'valley',
    roadWidth: 160,
    runoffWidth: 60,
    verts: [
      [0, 0, 0, 0], [1400, 0, 10, 350], [2100, 600, 30, 250], [1750, 1200, 40, 170],
      [1300, 700, 25, 200], [800, 950, 15, 220], [250, 1350, 40, 300],
      [-550, 1150, 50, 280], [-650, 0, 15, 280],
    ],
  }),
  new Track({
    id: 'figure8',
    difficulty: 'medium',
    theme: 'sunset',
    roadWidth: 150,
    runoffWidth: 55,
    bridgeHeight: 60,
    verts: [
      [500, -361, 0, 0], [1150, -830, 0, 300], [1750, 0, 5, 300], [1150, 830, 20, 300],
      [400, 289, 80, 0], [0, 0, 80, 0], [-400, -289, 80, 0],
      [-1150, -830, 20, 300], [-1750, 0, 5, 300], [-1150, 830, 0, 300], [0, 0, 0, 0],
    ],
  }),
  new Track({
    id: 'mountain',
    difficulty: 'hard',
    theme: 'alpine',
    roadWidth: 140,
    runoffWidth: 45,
    verts: [
      [0, 0, 0, 0], [1150, 0, 32, 150], [1150, -340, 64, 150], [-100, -340, 112, 150],
      [-100, -700, 160, 150], [1300, -700, 208, 250], [1950, -200, 160, 300],
      [1600, 450, 80, 250], [-350, 450, 0, 200], [-350, 0, 0, 150],
    ],
  }),
  new Track({
    id: 'city',
    difficulty: 'hard',
    theme: 'city',
    roadWidth: 130,
    runoffWidth: 25,
    verts: [
      [300, 0, 0, 0], [900, 0, 0, 110], [900, 450, 0, 100], [1400, 450, 0, 100],
      [1400, 900, 0, 110], [1070, 900, 0, 100], [950, 1000, 0, 100], [400, 1000, 0, 120],
      [400, 650, 0, 100], [-200, 650, 0, 130], [-200, 0, 0, 130],
    ],
  }),
  new Track({
    id: 'desert',
    difficulty: 'medium',
    theme: 'desert',
    roadWidth: 170,
    runoffWidth: 80,
    verts: [
      [0, 0, 0, 0], [1800, 0, 0, 400], [2500, 700, 20, 300], [2200, 1400, 40, 250],
      [1400, 1300, 30, 200], [900, 800, 20, 250], [300, 1500, 10, 350],
      [-800, 1300, 0, 400], [-900, 0, 0, 400],
    ],
  }),
];

export function getTrackById(id) {
  return TRACKS.find((t) => t.id === id);
}
