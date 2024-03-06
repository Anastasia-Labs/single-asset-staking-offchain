import {
  deployRefScripts,
  Emulator,
  fromText,
  generateAccountSeedPhrase,
  Lucid,
  parseUTxOsAtScript,
  replacer,
  toUnit,
  RefScripts,
  AppliedScripts,
  Deploy,
  Result,
  UTxO,
  InsertNodeConfig,
  insertNode,
  SetNode,
  POSIXTime,
  REF_SCRIPT_TNs,
  buildScripts,
  fetchRefScripts,
  CampaignStatus,
  CreateConfig,
  FetchCampaignStateConfig,
  fetchCampaignState,
} from "../src/index.js";
import { expect } from "vitest";
import alwaysFails from "./compiled/alwaysFails.json";
import configPolicy from "./compiled/configPolicy.json";
import nodeValidator from "./compiled/nodeValidator.json";
import nodePolicy from "./compiled/nodePolicy.json";
import nodeStakeValidator from "./compiled/nodeStakeValidator.json";
import foldPolicy from "./compiled/foldPolicy.json";
import foldValidator from "./compiled/foldValidator.json";
import rewardFoldPolicy from "./compiled/rewardFoldPolicy.json";
import rewardFoldValidator from "./compiled/rewardFoldValidator.json";
import tokenHolderPolicy from "./compiled/tokenHolderPolicy.json";
import tokenHolderValidator from "./compiled/tokenHolderValidator.json";

export type LucidContext = {
  lucid: Lucid;
  users: any;
  emulator: Emulator;
};

// INITIALIZE EMULATOR + ACCOUNTS
export async function initializeLucidContext(context: LucidContext) {
  context.users = {
    treasury1: await generateAccountSeedPhrase({
      lovelace: BigInt(500_000_000),
      [toUnit(
        "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
        fromText("MIN"),
      )]: BigInt(10_000_000),
    }),
    reward1: await generateAccountSeedPhrase({
      lovelace: BigInt(500_000_000),
      [toUnit(
        "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
        fromText("MIN"),
      )]: BigInt(100_000_000),
    }),
    account1: await generateAccountSeedPhrase({
      lovelace: BigInt(500_000_000),
      [toUnit(
        "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
        fromText("MIN"),
      )]: BigInt(10_000_000),
    }),
    account2: await generateAccountSeedPhrase({
      lovelace: BigInt(500_000_000),
      [toUnit(
        "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
        fromText("MIN"),
      )]: BigInt(10_000_000),
    }),
    account3: await generateAccountSeedPhrase({
      lovelace: BigInt(500_000_000),
      [toUnit(
        "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
        fromText("MIN"),
      )]: BigInt(10_000_000),
    }),
  };

  context.emulator = new Emulator([
    context.users.treasury1,
    context.users.reward1,
    context.users.account1,
    context.users.account2,
    context.users.account3,
  ]);

  context.lucid = await Lucid.new(context.emulator);
}

export async function buildDeployFetchRefScripts(
  lucid: Lucid,
  emulator: Emulator,
): Promise<Result<RefScripts>> {
  const newScripts = buildScripts(lucid, {
    alwaysFails: alwaysFails.cborHex,
    configPolicy: configPolicy.cborHex,
    nodePolicy: nodePolicy.cborHex,
    nodeValidator: nodeValidator.cborHex,
    nodeStakeValidator: nodeStakeValidator.cborHex,
    foldPolicy: foldPolicy.cborHex,
    foldValidator: foldValidator.cborHex,
    rewardFoldPolicy: rewardFoldPolicy.cborHex,
    rewardFoldValidator: rewardFoldValidator.cborHex,
    tokenHolderPolicy: tokenHolderPolicy.cborHex,
    tokenHolderValidator: tokenHolderValidator.cborHex,
  });

  expect(newScripts.type).toBe("ok");
  if (newScripts.type == "error") return newScripts;

  const deployTime = emulator.now();
  const deployRefScripts = await deploy(
    lucid,
    emulator,
    newScripts.data,
    deployTime,
  );

  expect(deployRefScripts.type).toBe("ok");
  if (deployRefScripts.type == "error") return deployRefScripts;
  // Find node refs script
  const deployPolicyId = deployRefScripts.data.deployPolicyId;

  const refScripts = await fetchRefScripts(lucid, {
    deployPolicyId: deployPolicyId,
    alwaysFails: alwaysFails.cborHex,
  });

  expect(refScripts.type).toBe("ok");
  if (refScripts.type == "error") return refScripts;

  return { type: "ok", data: refScripts.data };
}

export async function deploy(
  lucid: Lucid,
  emulator: Emulator,
  scripts: AppliedScripts,
  deployTime: number,
): Promise<Result<Deploy>> {
  let deploy: Result<Deploy> = {
    type: "error",
    error: new Error("Deploy Failed"),
  };

  for (const [key, value] of Object.entries(REF_SCRIPT_TNs)) {
    deploy = await deployRefScripts(lucid, {
      script: scripts[key],
      name: value,
      alwaysFails: alwaysFails.cborHex,
      currentTime: deployTime,
    });

    expect(deploy.type).toBe("ok");
    if (deploy.type == "ok") {
      (await deploy.data.tx.sign().complete()).submit();
      emulator.awaitBlock(4);
    }
  }

  return deploy;
}

// Inserts three nodes belonging to account 1, 2 & 3 in the same order
export async function insertThreeNodes(
  lucid: Lucid,
  emulator: Emulator,
  users: any,
  configTN: string,
  refUTxOs: RefScripts,
  freezeStake: POSIXTime,
  logFlag: boolean,
): Promise<void> {
  // INSERT NODE ACCOUNT 1

  const insertNodeConfig: InsertNodeConfig = {
    configTN: configTN,
    refScripts: refUTxOs,
    stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    stakeTN: "MIN",
    minimumStake: 1_000,
    toStake: 4_000,
    freezeStake: freezeStake,
    currentTime: emulator.now(),
  };

  lucid.selectWalletFromSeed(users.account1.seedPhrase);
  const insertNodeUnsigned = await insertNode(lucid, insertNodeConfig);
  // console.log(insertNodeUnsigned);

  expect(insertNodeUnsigned.type).toBe("ok");
  if (insertNodeUnsigned.type == "error") return;

  // console.log(insertNodeUnsigned.data.txComplete.to_json())
  lucid.selectWalletFromSeed(users.account1.seedPhrase);
  const insertNodeSigned = await insertNodeUnsigned.data.sign().complete();
  const insertNodeHash = await insertNodeSigned.submit();

  emulator.awaitBlock(4);

  // INSERT NODE ACCOUNT 2

  const insertNodeConfig2: InsertNodeConfig = {
    ...insertNodeConfig,
    toStake: 5_000,
    currentTime: emulator.now(),
  };

  lucid.selectWalletFromSeed(users.account2.seedPhrase);
  const insertNodeUnsigned2 = await insertNode(lucid, insertNodeConfig2);

  expect(insertNodeUnsigned2.type).toBe("ok");
  if (insertNodeUnsigned2.type == "error") return;

  const insertNodeSigned2 = await insertNodeUnsigned2.data.sign().complete();
  const insertNodeHash2 = await insertNodeSigned2.submit();

  emulator.awaitBlock(4);

  // INSERT NODE ACCOUNT 3

  const insertNodeConfig3: InsertNodeConfig = {
    ...insertNodeConfig,
    toStake: 5_000,
    currentTime: emulator.now(),
  };

  lucid.selectWalletFromSeed(users.account3.seedPhrase);
  const insertNodeUnsigned3 = await insertNode(lucid, insertNodeConfig3);

  expect(insertNodeUnsigned3.type).toBe("ok");
  if (insertNodeUnsigned3.type == "error") return;
  // console.log(insertNodeUnsigned.data.txComplete.to_json())

  const insertNodeSigned3 = await insertNodeUnsigned3.data.sign().complete();
  const insertNodeHash3 = await insertNodeSigned3.submit();

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "insertNode result",
        JSON.stringify(
          await parseUTxOsAtScript(
            lucid,
            refUTxOs.nodeValidator.scriptRef?.script!,
            SetNode,
          ),
          replacer,
          2,
        ),
      )
    : null;
}

export async function checkCampaignStatus(
  lucid: Lucid,
  emulator: Emulator,
  expectedStatus: CampaignStatus,
  refUTxOs: RefScripts,
  configTN: string,
  config: CreateConfig,
): Promise<void> {
  const campaignStateConfig: FetchCampaignStateConfig = {
    configTN: configTN,
    ...config.stakingConfig,
    refScripts: refUTxOs,
    currentTime: emulator.now(),
  };

  const campaignState = await fetchCampaignState(lucid, campaignStateConfig);

  // console.log(campaignState);
  expect(campaignState.type).toBe("ok");
  if (campaignState.type == "error") return;
  expect(campaignState.data.campaignStatus).toBe(expectedStatus);
}
