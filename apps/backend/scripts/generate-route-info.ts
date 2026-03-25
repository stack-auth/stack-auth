import { SmartRouter } from "@/smart-router";
import fs from "fs";

async function main() {
  const routes = await SmartRouter.listRoutes();
  const apiVersions = await SmartRouter.listApiVersions();
  fs.mkdirSync("src/generated", { recursive: true });
  fs.writeFileSync("src/generated/routes.json", JSON.stringify(routes, null, 2));
  fs.writeFileSync("src/generated/api-versions.json", JSON.stringify(apiVersions, null, 2));
  console.log("Successfully updated route info");
}
// eslint-disable-next-line no-restricted-syntax
main().catch((...args) => {
  console.error(`ERROR! Could not update route info`, ...args);
  process.exit(1);
});
