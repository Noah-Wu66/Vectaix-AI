import { Template, defaultBuildLogger } from "e2b";
import { createVectaixTemplate } from "./template.mjs";

await Template.build(createVectaixTemplate(), {
  alias: "vectaix-agent",
  cpuCount: 1,
  memoryMB: 2048,
  onBuildLogs: defaultBuildLogger(),
});
