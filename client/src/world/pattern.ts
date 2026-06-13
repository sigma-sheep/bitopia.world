// Tile appearances. Colors for now (no image assets); typed so each can later
// carry texture/procedural descriptors without reshaping the world model.
//
// Each tile type gets its OWN pattern shape — they don't share one, because the
// surfaces a user actually sees differ:

// A floor is viewed from above: its top is the dominant surface; `side` is the
// thin 0.25 lip, faintly visible at the iso angle.
export type FloorPattern = {
  top: string;
  side: string;
};

// A wall is viewed edge-on: its top (a 5×0.25 sliver) is never meaningfully
// seen, so it isn't modeled. Only the broad vertical face matters.
export type WallPattern = {
  face: string;
};
