import {
  Address,
  Assets,
  OutRef,
  PolicyId,
  TxComplete,
  UTxO,
} from "@anastasia-labs/lucid-cardano-fork";
import { CampaignStatus } from "./constants.js";

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

export type CreateConfig = {
  stakingConfig: {
    stakingInitUTXO: UTxO;
    rewardInitUTXO: UTxO;
    freezeStake: POSIXTime;
    endStaking: POSIXTime;
    penaltyAddress: Address;
    stakeCS: PolicyId;
    stakeTN: string;
    minimumStake: number;
    rewardCS: PolicyId;
    rewardTN: string;
  };
  configInitUTXO: UTxO;
  refScripts: {
    configPolicy: UTxO;
  };
  alwaysFails: CborHex;
  currentTime: POSIXTime;
};

export type FetchConfig = {
  configTN: string;
  refScripts: {
    configPolicy: UTxO;
  };
};

export type DeployRefScriptsConfig = {
  script: CborHex;
  name: string;
  alwaysFails: CborHex;
  currentTime: POSIXTime;
};

export type FetchRefScriptsConfig = {
  deployPolicyId: string;
  alwaysFails: CborHex;
};

export type InitTokenHolderConfig = {
  configTN: string;
  rewardInitUTXO: UTxO;
  rewardCS: string;
  rewardTN: string;
  rewardAmount: number;
  refScripts: {
    configPolicy: UTxO;
    tokenHolderPolicy: UTxO;
    tokenHolderValidator: UTxO;
  };
};

export type InitNodeConfig = {
  configTN: string;
  stakingInitUTXO: UTxO;
  stakeCS: PolicyId;
  stakeTN: string;
  minimumStake: number;
  refScripts: {
    configPolicy: UTxO;
    nodePolicy: UTxO;
    nodeValidator: UTxO;
  };
};

export type DInitNodeConfig = {
  configTN: string;
  refScripts: {
    configPolicy: UTxO;
    nodePolicy: UTxO;
    nodeValidator: UTxO;
  };
};

export type FetchCampaignStateConfig = {
  configTN: string;
  freezeStake: POSIXTime;
  endStaking: POSIXTime;
  stakeCS: PolicyId;
  stakeTN: string;
  rewardCS: PolicyId;
  rewardTN: string;
  currentTime?: POSIXTime;
  refScripts: {
    configPolicy: UTxO;
    nodeValidator: UTxO;
    nodePolicy: UTxO;
    foldPolicy: UTxO;
    foldValidator: UTxO;
    rewardFoldPolicy: UTxO;
    rewardFoldValidator: UTxO;
    tokenHolderPolicy: UTxO;
    tokenHolderValidator: UTxO;
  };
};

export type CampaignState = {
  campaignStatus: CampaignStatus;
  totalStake?: number;
  totalReward?: number;
};

export type FetchNodesConfig = {
  configTN: string;
  refScripts: {
    nodePolicy: UTxO;
    nodeValidator: UTxO;
  };
};

export type FetchUserNodeConfig = {
  configTN: string;
  userAddress: Address;
  refScripts: {
    nodePolicy: UTxO;
    nodeValidator: UTxO;
  };
};

export type InsertNodeConfig = {
  configTN: string;
  nodeUTxOs?: UTxO[];
  refScripts: {
    configPolicy: UTxO;
    nodeValidator: UTxO;
    nodePolicy: UTxO;
  };
  stakeCS: PolicyId;
  stakeTN: string;
  minimumStake: number;
  toStake: number;
  freezeStake: POSIXTime;
  currentTime?: POSIXTime;
};

export type RemoveNodeConfig = {
  configTN: string;
  nodeUTxOs?: UTxO[];
  refScripts: {
    configPolicy: UTxO;
    nodeValidator: UTxO;
    nodePolicy: UTxO;
  };
  freezeStake: POSIXTime;
  endStaking: POSIXTime;
  stakeCS: PolicyId;
  stakeTN: string;
  penaltyAddress: Address;
  currentTime?: POSIXTime;
};

export type InitFoldConfig = {
  configTN: string;
  refScripts: {
    nodeValidator: UTxO;
    nodePolicy: UTxO;
    configPolicy: UTxO;
    foldPolicy: UTxO;
    foldValidator: UTxO;
  };
  currentTime?: POSIXTime;
};

export type MultiFoldConfig = {
  configTN: string;
  nodeUTxOs?: UTxO[];
  refScripts: {
    configPolicy: UTxO;
    nodeValidator: UTxO;
    nodePolicy: UTxO;
    foldValidator: UTxO;
    foldPolicy: UTxO;
  };
  stakeCS: PolicyId;
  stakeTN: string;
  currentTime?: POSIXTime;
};

export type FoldNodeConfig = {
  configTN: string;
  nodeRefInput: OutRef;
  foldOutRef: OutRef;
  refScripts: {
    configPolicy: UTxO;
    foldPolicy: UTxO;
    foldValidator: UTxO;
  };
};

export type InitRewardFoldConfig = {
  configTN: string;
  rewardCS: string;
  rewardTN: string;
  refScripts: {
    configPolicy: UTxO;
    nodeValidator: UTxO;
    nodePolicy: UTxO;
    nodeStakeValidator: UTxO;
    foldPolicy: UTxO;
    foldValidator: UTxO;
    rewardFoldPolicy: UTxO;
    rewardFoldValidator: UTxO;
    tokenHolderPolicy: UTxO;
    tokenHolderValidator: UTxO;
  };
};

export type RewardFoldNodeConfig = {
  configTN: string;
  nodeUTxOs?: UTxO[];
  refScripts: {
    configPolicy: UTxO;
    nodeValidator: UTxO;
    nodePolicy: UTxO;
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
  configTN: string;
  nodeUTxOs?: UTxO[];
  refScripts: {
    configPolicy: UTxO;
    nodeValidator: UTxO;
    nodePolicy: UTxO;
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
  alwaysFails: CborHex;
  configPolicy: RawHex;
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

export type ReadableUTxO<T> = {
  outRef: OutRef;
  datum: T;
  assets: Assets;
};

export type AppliedScripts = {
  configPolicy: CborHex;
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

export type RefScripts = {
  configPolicy: UTxO;
  nodeValidator: UTxO;
  nodePolicy: UTxO;
  nodeStakeValidator: UTxO;
  foldPolicy: UTxO;
  foldValidator: UTxO;
  rewardFoldPolicy: UTxO;
  rewardFoldValidator: UTxO;
  tokenHolderPolicy: UTxO;
  tokenHolderValidator: UTxO;
};

export type Deploy = {
  tx: TxComplete;
  deployPolicyId: string;
};
