import { Template, defaultBuildLogger } from "e2b";
import { createVectaixTemplate } from "./template.mjs";

await Template.build(createVectaixTemplate(), "vectaix-agent-dev", {
  cpuCount: 1,
  memoryMB: 2048,
  onBuildLogs: defaultBuildLogger(),
});
