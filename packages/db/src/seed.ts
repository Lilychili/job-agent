// Optional demo data: a confirmed demo Profile, Preferences and a Settings row, so the board
// can be clicked end to end without onboarding. NOT needed for real use: onboarding (/setup) fills
// all of this in. Don't run it if you want to start from an empty Profile.
import { createDb, createPool, preferences, profile, settings } from "./index";

const pool = createPool();
const db = createDb(pool);

try {
  if ((await db.select({ id: profile.id }).from(profile).limit(1)).length === 0) {
    await db.insert(profile).values({
      confirmed: true,
      contact: { name: "Demo Owner", email: "owner@example.com", location: "Barcelona" },
      facts: [
        { id: "f-role-1", kind: "role", text: "Senior Frontend Engineer", org: "Acme", startDate: "2021-03" },
        { id: "f-skill-ts", kind: "skill", text: "TypeScript" },
        { id: "f-skill-react", kind: "skill", text: "React" },
      ],
    });
    console.log("Seeded demo profile (confirmed).");
  }
  if ((await db.select({ id: preferences.id }).from(preferences).limit(1)).length === 0) {
    await db.insert(preferences).values({
      locations: ["Barcelona", "Remote EU"],
      remote: "any",
      stackMustHave: ["TypeScript"],
    });
    console.log("Seeded preferences.");
  }
  if ((await db.select({ id: settings.id }).from(settings).limit(1)).length === 0) {
    await db.insert(settings).values({});
    console.log("Seeded settings.");
  }
} finally {
  await pool.end();
}
