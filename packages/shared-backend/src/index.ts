// Reading and writing local Hexclave / Stack Auth config files.
//   config-file.ts    — resolve / read (jiti) / ensure / render / replace
//   config-updater.ts — updateConfigObject: the in-place AI-agent write flow
//   config-agent.ts   — the headless Claude agent runner (also exported via the
//                       "@hexclave/shared-backend/config-agent" subpath)
export * from "./config-file";
export * from "./config-updater";
