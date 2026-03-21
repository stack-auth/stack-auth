import fs from "node:fs";
import path from "node:path";

const generatedFilePath = path.join("src", "generated", "private-sign-up-risk-engine.ts");
const privateEnginePath = path.join("src", "private", "src", "sign-up-risk-engine.ts");

const generatedFileContents = fs.existsSync(privateEnginePath)
  ? `export { signUpRiskEngine } from "../private/src/sign-up-risk-engine";\n`
  : `export const signUpRiskEngine = null;\n`;

function main() {
  fs.mkdirSync(path.dirname(generatedFilePath), { recursive: true });

  const existingContents = fs.existsSync(generatedFilePath)
    ? fs.readFileSync(generatedFilePath, "utf8")
    : null;

  if (existingContents !== generatedFileContents) {
    fs.writeFileSync(generatedFilePath, generatedFileContents);
  }

  console.log("Successfully updated private sign-up risk engine entrypoint");
}

main();
