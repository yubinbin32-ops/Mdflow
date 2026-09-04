import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repo_root TEXT NOT NULL,
  graph_revision INTEGER NOT NULL DEFAULT 0,
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  contract TEXT NOT NULL DEFAULT '',
  delivery_state TEXT NOT NULL DEFAULT 'proposed',
  health_state TEXT NOT NULL DEFAULT 'unknown',
  priority TEXT NOT NULL DEFAULT 'normal',
  confidence TEXT NOT NULL DEFAULT 'confirmed',
  tags_json TEXT NOT NULL DEFAULT '[]',
  current_revision INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_refs (
  id TEXT PRIMARY KEY,
  block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  symbol TEXT,
  role TEXT NOT NULL DEFAULT 'implementation',
  git_commit TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS localized_text (
  entity_type TEXT NOT NULL CHECK(entity_type IN ('block', 'chain', 'link', 'plan')),
  entity_id TEXT NOT NULL,
  locale TEXT NOT NULL CHECK(locale IN ('en', 'zh-Hans')),
  field TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(entity_type, entity_id, locale, field)
);

CREATE TABLE IF NOT EXISTS chains (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'feature',
  intent TEXT NOT NULL DEFAULT '',
  input_contract TEXT NOT NULL DEFAULT '',
  output_contract TEXT NOT NULL DEFAULT '',
  delivery_state TEXT NOT NULL DEFAULT 'planned',
  health_state TEXT NOT NULL DEFAULT 'unknown',
  priority TEXT NOT NULL DEFAULT 'normal',
  current_revision INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  goal TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  priority TEXT NOT NULL DEFAULT 'normal',
  proposed_delta_json TEXT NOT NULL DEFAULT '[]',
  next_action TEXT NOT NULL DEFAULT '',
  blockers_json TEXT NOT NULL DEFAULT '[]',
  current_revision INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_chain_refs (
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  chain_id TEXT NOT NULL REFERENCES chains(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(plan_id, chain_id)
);

CREATE TABLE IF NOT EXISTS chain_members (
  chain_id TEXT NOT NULL REFERENCES chains(id) ON DELETE CASCADE,
  member_type TEXT NOT NULL CHECK(member_type IN ('block', 'chain')),
  member_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(chain_id, member_type, member_id)
);

CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK(source_type IN ('block', 'chain')),
  source_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK(target_type IN ('block', 'chain')),
  target_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  contract TEXT NOT NULL DEFAULT '',
  health_state TEXT NOT NULL DEFAULT 'unknown',
  current_revision INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chain_nodes (
  chain_id TEXT NOT NULL REFERENCES chains(id) ON DELETE CASCADE,
  block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'path',
  PRIMARY KEY(chain_id, block_id)
);

CREATE TABLE IF NOT EXISTS chain_edges (
  chain_id TEXT NOT NULL REFERENCES chains(id) ON DELETE CASCADE,
  link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(chain_id, link_id)
);

CREATE TABLE IF NOT EXISTS background_scopes (
  block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK(scope_type IN ('project', 'lens', 'chain', 'repo')),
  scope_value TEXT NOT NULL DEFAULT '*',
  PRIMARY KEY(block_id, scope_type, scope_value)
);

CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK(target_type IN ('block', 'chain', 'link', 'plan')),
  target_id TEXT NOT NULL,
  title TEXT NOT NULL,
  criteria TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  current_revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS change_sets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  task TEXT NOT NULL DEFAULT '',
  git_head TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  change_set_id TEXT NOT NULL REFERENCES change_sets(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  revision INTEGER NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS change_feed (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  change_set_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blocks_project ON blocks(project_id, archived);
CREATE INDEX IF NOT EXISTS idx_chains_project ON chains(project_id, archived);
CREATE INDEX IF NOT EXISTS idx_links_project ON links(project_id, archived);
CREATE INDEX IF NOT EXISTS idx_plans_project ON plans(project_id, archived, status);
CREATE INDEX IF NOT EXISTS idx_plan_chain_refs_plan ON plan_chain_refs(plan_id, position);
CREATE INDEX IF NOT EXISTS idx_chain_nodes_chain ON chain_nodes(chain_id, position);
CREATE INDEX IF NOT EXISTS idx_chain_edges_chain ON chain_edges(chain_id, position);
CREATE INDEX IF NOT EXISTS idx_background_scopes_block ON background_scopes(block_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_target ON checkpoints(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_history_entity ON history(entity_type, entity_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_change_feed_project ON change_feed(project_id, sequence DESC);
CREATE INDEX IF NOT EXISTS idx_localized_text_entity ON localized_text(entity_type, entity_id, locale);
`;

function tableSql(database, name) {
  return database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)?.sql ?? "";
}

function migratePlanCapableTables(database) {
  const localizedSql = tableSql(database, "localized_text");
  const checkpointSql = tableSql(database, "checkpoints");
  if (localizedSql.includes("'plan'") && checkpointSql.includes("'plan'")) return;
  database.exec("PRAGMA foreign_keys = OFF;");
  try {
    database.exec("BEGIN IMMEDIATE;");
    if (!localizedSql.includes("'plan'")) {
      database.exec(`
        DROP INDEX IF EXISTS idx_localized_text_entity;
        CREATE TABLE localized_text_v2 (
          entity_type TEXT NOT NULL CHECK(entity_type IN ('block', 'chain', 'link', 'plan')),
          entity_id TEXT NOT NULL,
          locale TEXT NOT NULL CHECK(locale IN ('en', 'zh-Hans')),
          field TEXT NOT NULL,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(entity_type, entity_id, locale, field)
        );
        INSERT INTO localized_text_v2 SELECT * FROM localized_text;
        DROP TABLE localized_text;
        ALTER TABLE localized_text_v2 RENAME TO localized_text;
      `);
    }
    if (!checkpointSql.includes("'plan'")) {
      database.exec(`
        DROP INDEX IF EXISTS idx_checkpoints_target;
        CREATE TABLE checkpoints_v2 (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          target_type TEXT NOT NULL CHECK(target_type IN ('block', 'chain', 'link', 'plan')),
          target_id TEXT NOT NULL,
          title TEXT NOT NULL,
          criteria TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending',
          evidence_json TEXT NOT NULL DEFAULT '[]',
          current_revision INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO checkpoints_v2 SELECT * FROM checkpoints;
        DROP TABLE checkpoints;
        ALTER TABLE checkpoints_v2 RENAME TO checkpoints;
      `);
    }
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys = ON;");
  }
  database.exec("CREATE INDEX IF NOT EXISTS idx_localized_text_entity ON localized_text(entity_type, entity_id, locale);");
  database.exec("CREATE INDEX IF NOT EXISTS idx_checkpoints_target ON checkpoints(target_type, target_id);");
}

function backfillChainPaths(database) {
  database.exec(`
    INSERT OR IGNORE INTO chain_nodes(chain_id, block_id, position, role)
    SELECT chain_id, member_id, position, 'path'
    FROM chain_members WHERE member_type = 'block';

    INSERT OR IGNORE INTO chain_edges(chain_id, link_id, position)
    SELECT source.chain_id, links.id, source.position
    FROM chain_nodes source
    JOIN chain_nodes target
      ON target.chain_id = source.chain_id AND target.position = source.position + 1
    JOIN links
      ON links.source_type = 'block' AND links.source_id = source.block_id
     AND links.target_type = 'block' AND links.target_id = target.block_id
    WHERE links.archived = 0;
  `);
}

export function openDatabase(databasePath) {
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA busy_timeout = 3000;");
  database.exec(SCHEMA);
  migratePlanCapableTables(database);
  backfillChainPaths(database);
  return database;
}

export function transaction(database, callback) {
  database.exec("BEGIN IMMEDIATE;");
  try {
    const result = callback();
    database.exec("COMMIT;");
    return result;
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}
