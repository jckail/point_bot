import { createContainer } from "./container";
import { loadEnv } from "./env";
import { createBotServer } from "./server";

const env = loadEnv();
const server = createBotServer({ env, useCases: createContainer(env) });
server.listen(env.PORT, () => {
  console.info(`[bot] listening on :${env.PORT}`);
});
