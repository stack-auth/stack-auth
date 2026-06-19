import { runBulldozerStudio } from "../src/databases/bulldozer/studio.js";

const port = process.env.BULLDOZER_STUDIO_PORT === undefined ? undefined : Number(process.env.BULLDOZER_STUDIO_PORT);

await runBulldozerStudio({ port });

