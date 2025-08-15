import { runPretranslationCycle } from "../src/services/pretranslator.js";
import { createContextLogger } from "../src/config/logger.js";

const logger = createContextLogger("RunPretranslation");

(async () => {
  try {
    const res = await runPretranslationCycle();
    logger.info("Pretranslation completed", res);
    process.exit(0);
  } catch (e) {
    logger.error("Pretranslation failed", { error: e.message });
    process.exit(1);
  }
})();
