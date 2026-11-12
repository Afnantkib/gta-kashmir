export interface MissionDefinition {
  id: string;
  title: string;
  category: 'race' | 'taxi' | 'delivery' | 'pursuit' | 'shikara';
  startPoint: { x: number; z: number; name: string };
  checkpoints: { x: number; z: number; name: string }[];
  timeLimitSec: number;
  rewardCash: number;
  rewardXp: number;
  description: string;
}

export const MISSIONS: MissionDefinition[] = [
  {
    id: 'race_blvd_01',
    title: 'Boulevard Circuit Sprint',
    category: 'race',
    startPoint: { x: 0, z: -400, name: 'Ghat No. 1' },
    checkpoints: [
      { x: -3.5, z: -250, name: 'Ahdoos Curve' },
      { x: 0, z: -100, name: 'Ghat 9 Straight' },
      { x: -12, z: 9, name: 'Nishat Bagh Grand Gate' },
      { x: 0, z: 240, name: 'Boulevard North' },
      { x: -2, z: 380, name: 'Burger Barn Finish' },
    ],
    timeLimitSec: 90,
    rewardCash: 5000,
    rewardXp: 250,
    description: 'High-speed street race along Boulevard Road! Hit all checkpoints before time runs out.',
  },
  {
    id: 'taxi_tourist_01',
    title: 'Tourist Express to Nishat Gate',
    category: 'taxi',
    startPoint: { x: 10, z: -150, name: 'Ghat No. 9 Promenade' },
    checkpoints: [
      { x: -18, z: 9, name: 'Nishat Bagh Mughal Gate' },
    ],
    timeLimitSec: 80,
    rewardCash: 2500,
    rewardXp: 150,
    description: 'Pick up tourists from Dal Lake Ghat No. 9 and rush them safely to Nishat Bagh gate.',
  },
  {
    id: 'deliv_kahwa_01',
    title: 'Hot Kahwa & Saffron Rush',
    category: 'delivery',
    startPoint: { x: -10, z: 160, name: 'Saffron Sweets Bazaar' },
    checkpoints: [
      { x: 11, z: 60, name: 'H.B. Golden Lily Dock' },
      { x: -20, z: 385, name: 'Burger Barn Terrace' },
    ],
    timeLimitSec: 100,
    rewardCash: 4000,
    rewardXp: 200,
    description: 'Deliver piping hot Kashmiri Kahwa and pure saffron to the houseboats and cafes before it gets cold.',
  },
  {
    id: 'pursuit_escape_01',
    title: 'Police Pursuit & Checkpoint Run',
    category: 'pursuit',
    startPoint: { x: 0, z: 395, name: 'Police Checkpoint Barrier' },
    checkpoints: [
      { x: 3.5, z: 100, name: 'Southbound Lane' },
      { x: 0, z: -350, name: 'Dalgate Safehouse' },
    ],
    timeLimitSec: 90,
    rewardCash: 6000,
    rewardXp: 350,
    description: 'Trigger the police alert at Checkpoint 4, outrun the interceptor patrol cars, and reach Dalgate!',
  },
  {
    id: 'shikara_reg_01',
    title: 'Dal Lake Houseboat Regatta',
    category: 'shikara',
    startPoint: { x: 22, z: -390, name: 'Dalgate Shikara Pier' },
    checkpoints: [
      { x: 38, z: -250, name: 'H.B. Lake Victoria' },
      { x: 39, z: 60, name: 'H.B. Golden Lily' },
      { x: 42, z: 180, name: 'H.B. Queen of Heaven' },
    ],
    timeLimitSec: 110,
    rewardCash: 3500,
    rewardXp: 180,
    description: 'Paddle through Dal Lake waterways between luxury houseboats and collect lotus markers.',
  },
];
