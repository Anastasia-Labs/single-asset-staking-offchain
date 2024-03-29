import { Lucid, TxComplete } from "@anastasia-labs/lucid-cardano-fork";
import { RemoveNodeConfig, Result } from "../core/types.js";
import { claimNode } from "./claimNode.js";
import { removeNode } from "./removeNode.js";

export const reclaimNode = async (
  lucid: Lucid,
  config: RemoveNodeConfig,
): Promise<Result<TxComplete>> => {
  config.currentTime ??= Date.now();

  if (config.currentTime < config.endStaking) return removeNode(lucid, config);
  else return claimNode(lucid, config);
};