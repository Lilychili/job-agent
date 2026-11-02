// Companies Claude found by searching the web, and which of them have a job board we can read.
import type pg from "pg";
import { normalizeCompany } from "./normalize";

export interface DiscoveredCompany {
  id: string;
  name: string;
  nameNorm: string;
  ats: "greenhouse" | "lever" | "ashby" | null;
  boardToken: string | null;
  reason: string;
  removed: boolean;
  checkedAt: Date;
}

export async function listDiscoveredCompanies(pool: pg.Pool): Promise<DiscoveredCompany[]> {
  const { rows } = await pool.query<DiscoveredCompany>(
    `select id, name, name_norm as "nameNorm", ats, board_token as "boardToken", reason, removed, checked_at as "checkedAt"
       from discovered_company order by (board_token is null), name`,
  );
  return rows;
}

/** A company with its board, or without one when none answered. A dismissed company stays dismissed. */
export async function saveDiscoveredCompany(
  pool: pg.Pool,
  c: { name: string; reason: string; board: { ats: "greenhouse" | "lever" | "ashby"; boardToken: string } | null },
): Promise<void> {
  await pool.query(
    `insert into discovered_company (name, name_norm, reason, ats, board_token)
     values ($1, $2, $3, $4, $5)
     on conflict (name_norm) do update
       set ats = excluded.ats, board_token = excluded.board_token, checked_at = now()
     where not discovered_company.removed`,
    [c.name, normalizeCompany(c.name), c.reason, c.board?.ats ?? null, c.board?.boardToken ?? null],
  );
}

/** The owner dismissed it: its name joins the companies to skip, so no board or list brings it back. */
export async function removeDiscoveredCompany(pool: pg.Pool, id: string): Promise<boolean> {
  const { rows } = await pool.query<{ name: string }>("update discovered_company set removed = true, updated_at = now() where id = $1 returning name", [id]);
  if (!rows[0]) return false;
  await pool.query(
    `update preferences
        set exclusions = jsonb_set(exclusions, '{companies}', (exclusions->'companies') || to_jsonb($1::text)), updated_at = now()
      where not exists (select 1 from jsonb_array_elements_text(exclusions->'companies') c where lower(c) = lower($1))`,
    [rows[0].name],
  );
  return true;
}
