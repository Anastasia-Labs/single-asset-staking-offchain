import { LucidEvolution, TxSignBuilder } from "@lucid-evolution/lucid";
import { RemoveNodeConfig, Result } from "../core/types.js";
import { claimNode } from "./claimNode.js";
import { removeNode } from "./removeNode.js";

export const reclaimNode = async (
  lucid: LucidEvolution,
  config: RemoveNodeConfig,
): Promise<Result<TxSignBuilder>> => {
  config.currentTime ??= Date.now();

  if (config.currentTime < config.endStaking) return removeNode(lucid, config);
  else return claimNode(lucid, config);
};
