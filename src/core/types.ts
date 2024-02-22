import {
  Address,
  Assets,
  OutRef,
  PolicyId,
  TxComplete,
  UTxO,
} from "@anastasia-labs/lucid-cardano-fork";
import { SetNode } from "./contract.types.js";

export type CborHex = string;
export type RawHex = string;
export type POSIXTime = number;

export type Result<T> =
  | { type: "ok"; data: T }
  | { type: "error"; error: Error };

export type Either<L, R> =
  | { type: "left"; value: L }
  | { type: "right"; value: R };

export type AssetClass = {
  policyId: string;
  tokenName: string;
};

export type DeployRefScriptsConfig = {
  script: CborHex;
  name: string;
  alwaysFails: CborHex;
  currentTime: POSIXTime;
};

export type InitTokenHolderConfig = {
  initUTXO: UTxO;
  rewardCS: string;
  rewardTN: string;
  rewardAmount: number;
  scripts: {
    tokenHolderPolicy: CborHex;
    tokenHolderValidator: CborHex;
  };
  refScripts?: {
    tokenHolderPolicy?: UTxO;
  };
};

export type InitNodeConfig = {
  initUTXO: UTxO;
  stakeCS: PolicyId;
  stakeTN: string;
  minimumStake : number;
  scripts: {
    nodePolicy: CborHex;
    nodeValidator: CborHex;
  };
  refScripts?: {
    nodePolicy?: UTxO;
  };
};

export type DInitNodeConfig = {
  scripts: {
    nodePolicy: CborHex;
    nodeValidator: CborHex;
  };
  refScripts?: {
    nodePolicy?: UTxO;
    nodeValidator: UTxO;
  };
};

export type InsertNodeConfig = {
  nodeUTxOs?: UTxO[];
  scripts: {
    nodePolicy: CborHex;
    nodeValidator: CborHex;
  };
  refScripts?: {
    nodeValidator?: UTxO;
    nodePolicy?: UTxO;
  };
  stakeCS: PolicyId;
  stakeTN: string;
  minimumStake : number;
  toStake: number;
  freezeStake: POSIXTime;
  currentTime?: POSIXTime;
};

export type RemoveNodeConfig = {
  nodeUTxOs?: UTxO[];
  scripts: {
    nodePolicy: CborHex;
    nodeValidator: CborHex;
  };
  refScripts?: {
    nodeValidator?: UTxO;
    nodePolicy?: UTxO;
  };
  freezeStake: POSIXTime;
  endStaking: POSIXTime;
  stakeCS: PolicyId;
  stakeTN: string;
  penaltyAddress: Address;
  currentTime?: POSIXTime;
};

export type InitFoldConfig = {
  scripts: {
    nodeValidator: CborHex;
    nodePolicy: CborHex;
    foldPolicy: CborHex;
    foldValidator: CborHex;
  };
  refScripts?: {
    foldPolicy?: UTxO 
  }
  currentTime?: POSIXTime;
};

export type MultiFoldConfig = {
  nodeRefInputs: OutRef[];
  indices: number[];
  scripts: {
    foldPolicy: CborHex;
    foldValidator: CborHex;
  };
  refScripts?: {
    foldValidator?: UTxO 
  }
  stakeCS: PolicyId;
  stakeTN: string;
  currentTime?: POSIXTime;
};

export type FoldNodeConfig = {
  nodeRefInput: OutRef;
  foldOutRef: OutRef;
  scripts: {
    foldPolicy: CborHex;
    foldValidator: CborHex;
  };
};

export type InitRewardFoldConfig = {
  rewardCS: string;
  rewardTN: string;
  scripts: {
    nodeValidator: CborHex;
    nodePolicy: CborHex;
    foldPolicy: CborHex;
    foldValidator: CborHex;
    rewardFoldPolicy: CborHex;
    rewardFoldValidator: CborHex;
    tokenHolderPolicy: CborHex;
    tokenHolderValidator: CborHex;
    nodeStakeValidator: CborHex;
  };
  refScripts?: {
    nodeValidator?: UTxO;
    nodePolicy?: UTxO;
    foldPolicy?: UTxO;
    foldValidator?: UTxO;
    rewardFoldPolicy?: UTxO;
    rewardFoldValidator?: UTxO;
    tokenHolderPolicy?: UTxO;
    tokenHolderValidator?: UTxO;
    nodeStakeValidator: UTxO;
  };
};

export type RewardFoldNodeConfig = {
  nodeInputs?: UTxO[];
  scripts: {
    nodeValidator: CborHex;
    nodeStakeValidator: CborHex;
    rewardFoldPolicy: CborHex;
    rewardFoldValidator: CborHex;
  };
  refScripts: {
    nodeValidator: UTxO;
    nodeStakeValidator: UTxO;
    rewardFoldPolicy: UTxO;
    rewardFoldValidator: UTxO;
  };
  rewardCS: PolicyId;
  rewardTN: string;
  stakeCS: PolicyId;
  stakeTN: string;
  currentTime?: POSIXTime;
};

export type RewardFoldNodesConfig = {
  nodeInputs: OutRef[];
  scripts: {
    nodeValidator: CborHex;
    nodeStakeValidator: CborHex;
    rewardFoldPolicy: CborHex;
    rewardFoldValidator: CborHex;
  };
  refScripts: {
    nodeValidator: UTxO;
    nodeStakeValidator: UTxO;
    rewardFoldPolicy: UTxO;
    rewardFoldValidator: UTxO;
  };
  rewardCS: PolicyId;
  rewardTN: string;
  stakeCS: PolicyId;
  stakeTN: string;
  currentTime?: POSIXTime;
};

export type BuildScriptsConfig = {
  nodePolicy: {
    initUTXO: UTxO;
    freezeStake: POSIXTime;
    endStaking: POSIXTime;
    penaltyAddress: Address;
    stakeCS: PolicyId;
    stakeTN: string;
    minimumStake : number;
  };
  rewardFoldValidator: {
    rewardCS: PolicyId;
    rewardTN: string;
  };
  rewardTokenHolder: {
    initUTXO: UTxO;
  };
  unapplied: {
    nodePolicy: RawHex;
    nodeValidator: RawHex;
    nodeStakeValidator: RawHex;
    foldPolicy: RawHex;
    foldValidator: RawHex;
    rewardFoldPolicy: RawHex;
    rewardFoldValidator: RawHex;
    tokenHolderValidator: RawHex;
    tokenHolderPolicy: RawHex;
  };
};

export type ReadableUTxO<T> = {
  outRef: OutRef;
  datum: T;
  assets: Assets;
};

export type AppliedScripts = {
  nodePolicy: CborHex;
  nodeValidator: CborHex;
  nodeStakeValidator: CborHex;
  foldPolicy: CborHex;
  foldValidator: CborHex;
  rewardFoldPolicy: CborHex;
  rewardFoldValidator: CborHex;
  tokenHolderPolicy: CborHex;
  tokenHolderValidator: CborHex;
};

export type Deploy = {
  tx: TxComplete;
  deployPolicyId: string;
};