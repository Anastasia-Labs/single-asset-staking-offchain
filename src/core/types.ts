import {
  Address,
  Assets,
  OutRef,
  PolicyId,
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

export type AppliedScripts = {
  nodePolicy: string;
};

export type AssetClass = {
  policyId: string;
  tokenName: string;
};

export type DeployRefScriptsConfig = {
  script: CborHex;
  name: string;
  alwaysFails: CborHex;
  currenTime: POSIXTime;
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
};

export type InitNodeConfig = {
  initUTXO: UTxO;
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
  currenTime?: POSIXTime;
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
  currenTime?: POSIXTime;
};

export type InitFoldConfig = {
  scripts: {
    nodeValidator: CborHex;
    nodePolicy: CborHex;
    foldPolicy: CborHex;
    foldValidator: CborHex;
  };
  currenTime?: POSIXTime;
};

export type MultiFoldConfig = {
  nodeRefInputs: OutRef[];
  indices: number[];
  scripts: {
    foldPolicy: CborHex;
    foldValidator: CborHex;
  };
  currenTime?: POSIXTime;
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
  };
  refScripts?: {
    nodeValidator?: UTxO;
    nodePolicy?: UTxO;
    commitFoldPolicy?: UTxO;
    commitFoldValidator?: UTxO;
    rewardFoldPolicy?: UTxO;
    rewardFoldValidator?: UTxO;
    tokenHolderPolicy?: UTxO;
    tokenHolderValidator?: UTxO;
  };
};

export type RewardFoldConfig = {
  nodeInputs: UTxO[];
  scripts: {
    nodeValidator: CborHex;
    stakingStakeValidator: CborHex;
    rewardFoldPolicy: CborHex;
    rewardFoldValidator: CborHex;
  };
  refScripts: {
    nodeValidator: UTxO;
    stakingStakeValidator: UTxO;
    rewardFoldPolicy: UTxO;
    rewardFoldValidator: UTxO;
  };
  rewardCS: PolicyId;
  rewardTN: string;
  stakeCS: PolicyId;
  stakeTN: string;
};

export type BuildScriptsConfig = {
  stakingPolicy: {
    initUTXO: UTxO;
    freezeStake: POSIXTime;
    endStaking: POSIXTime;
    penaltyAddress: Address;
    stakeCS: PolicyId;
    stakeTN: string;
    minimumStake : number;
  };
  rewardValidator: {
    rewardCS: PolicyId;
    rewardTN: string;
  };
  rewardTokenHolder: {
    initUTXO: UTxO;
  };
  unapplied: {
    stakingPolicy: RawHex;
    stakingValidator: RawHex;
    stakingStakeValidator: RawHex;
    foldPolicy: RawHex;
    foldValidator: RawHex;
    rewardPolicy: RawHex;
    rewardValidator: RawHex;
    tokenHolderValidator: RawHex;
    tokenHolderPolicy: RawHex;
  };
};

export type ReadableUTxO = {
  outRef: OutRef;
  datum: SetNode;
  assets: Assets;
};
