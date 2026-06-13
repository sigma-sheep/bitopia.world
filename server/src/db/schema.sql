CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,            -- privy user id
  address TEXT NOT NULL,          -- embedded wallet address
  username TEXT UNIQUE,           -- chosen handle (the ENS label); null until claimed
  ens_name TEXT,                  -- <username>.bitopiaworld.eth once issued
  avatar_seed TEXT NOT NULL,
  room_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  ens_name TEXT,
  width INTEGER NOT NULL DEFAULT 30,
  height INTEGER NOT NULL DEFAULT 30,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  ens_name TEXT,
  wallet_id TEXT NOT NULL,        -- Privy server wallet id
  wallet_address TEXT NOT NULL,
  personality TEXT NOT NULL,
  story TEXT NOT NULL,
  behavior TEXT NOT NULL,
  room_id TEXT NOT NULL,
  avatar_seed TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  text TEXT NOT NULL,
  ts INTEGER NOT NULL
);
