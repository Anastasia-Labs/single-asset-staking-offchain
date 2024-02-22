import {
  buildScripts,
  CborHex,
  deployRefScripts,
  DeployRefScriptsConfig,
  Emulator,
  fromText,
  generateAccountSeedPhrase,
  initNode,
  InitNodeConfig,
  initTokenHolder,
  InitTokenHolderConfig,
  Lucid,
  parseUTxOsAtScript,
  replacer,
  Script,
  toUnit,
  utxosAtScript,
  AppliedScripts,
  Deploy,
  Result,
  UTxO,
  InsertNodeConfig,
  insertNode,
  SetNode,
  POSIXTime
} from "../src/index.js";
import { test, expect, beforeEach } from "vitest";
import nodeValidator from "./compiled/nodeValidator.json";
import nodePolicy from "./compiled/nodePolicy.json";
import nodeStakeValidator from "./compiled/nodeStakeValidator.json"
import foldPolicy from "./compiled/foldPolicy.json";
import foldValidator from "./compiled/foldValidator.json";
import rewardFoldPolicy from "./compiled/rewardFoldPolicy.json";
import rewardFoldValidator from "./compiled/rewardFoldValidator.json";
import tokenHolderPolicy from "./compiled/tokenHolderPolicy.json"
import tokenHolderValidator from "./compiled/tokenHolderValidator.json"
import alwaysFailValidator from "./compiled/alwaysFails.json";

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
        fromText("MIN")
      )]: BigInt(10_000_000),
    }),
    reward1: await generateAccountSeedPhrase({
      lovelace: BigInt(500_000_000),
      [toUnit(
        "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
        fromText("MIN")
      )]: BigInt(100_000_000),
    }),
    account1: await generateAccountSeedPhrase({
      lovelace: BigInt(500_000_000),
      [toUnit(
        "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
        fromText("MIN")
      )]: BigInt(10_000_000),
    }),
    account2: await generateAccountSeedPhrase({
      lovelace: BigInt(500_000_000),
      [toUnit(
        "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
        fromText("MIN")
      )]: BigInt(10_000_000),
    }),
    account3: await generateAccountSeedPhrase({
      lovelace: BigInt(500_000_000),
      [toUnit(
        "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
        fromText("MIN")
      )]: BigInt(10_000_000),
    })
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

export async function deploy(
  lucid: Lucid, 
  emulator: Emulator, 
  scripts: AppliedScripts, 
  deployTime: number
): Promise<Result<Deploy>> {
  const deploy1 = await deployRefScripts(lucid, {
    script: scripts.nodePolicy,
    name: "StakingPolicy",
    alwaysFails: alwaysFailValidator.cborHex,
    currentTime: deployTime
  });

  expect(deploy1.type).toBe("ok");
  if (deploy1.type == "ok") {
    (await deploy1.data.tx.sign().complete()).submit();
    emulator.awaitBlock(4);
  }

  const deploy2 = await deployRefScripts(lucid, {
    script: scripts.nodeValidator,
    name: "StakingValidator",
    alwaysFails: alwaysFailValidator.cborHex,
    currentTime: deployTime
  });

  expect(deploy2.type).toBe("ok");
  if (deploy2.type == "ok") {
    (await deploy2.data.tx.sign().complete()).submit();
    emulator.awaitBlock(4);
  }

  const deployStake = await deployRefScripts(lucid, {
    script: scripts.nodeStakeValidator,
    name: "StakingStakeValidator",
    alwaysFails: alwaysFailValidator.cborHex,
    currentTime: deployTime
  });

  expect(deployStake.type).toBe("ok");
  if (deployStake.type == "ok") {
    (await deployStake.data.tx.sign().complete()).submit();
    emulator.awaitBlock(4);
  }

  const deploy3 = await deployRefScripts(lucid, {
    script: scripts.foldPolicy,
    name: "FoldPolicy",
    alwaysFails: alwaysFailValidator.cborHex,
    currentTime: deployTime
  });

  expect(deploy3.type).toBe("ok");
  if (deploy3.type == "ok") {
    (await deploy3.data.tx.sign().complete()).submit();
    emulator.awaitBlock(4);
  }

  const deploy4 = await deployRefScripts(lucid, {
    script: scripts.foldValidator,
    name: "FoldValidator",
    alwaysFails: alwaysFailValidator.cborHex,
    currentTime: deployTime
  });

  expect(deploy4.type).toBe("ok");
  if (deploy4.type == "ok") {
    (await deploy4.data.tx.sign().complete()).submit();
    emulator.awaitBlock(4);
  }

  const deploy5 = await deployRefScripts(lucid, {
    script: scripts.rewardFoldPolicy,
    name: "RewardFoldPolicy",
    alwaysFails: alwaysFailValidator.cborHex,
    currentTime: deployTime
  });

  expect(deploy5.type).toBe("ok");
  if (deploy5.type == "ok") {
    (await deploy5.data.tx.sign().complete()).submit();
    emulator.awaitBlock(4);
  }

  const deploy6 = await deployRefScripts(lucid, {
    script: scripts.rewardFoldValidator,
    name: "RewardFoldValidator",
    alwaysFails: alwaysFailValidator.cborHex,
    currentTime: deployTime
  });

  if(deploy6.type == "error"){
    console.log(deploy6.error);
  }
  expect(deploy6.type).toBe("ok");
  if (deploy6.type == "ok") {
    (await deploy6.data.tx.sign().complete()).submit();
    emulator.awaitBlock(4);
  }

  const deploy7 = await deployRefScripts(lucid, {
    script: scripts.tokenHolderPolicy,
    name: "TokenHolderPolicy",
    alwaysFails: alwaysFailValidator.cborHex,
    currentTime: deployTime
  });

  expect(deploy7.type).toBe("ok");
  if (deploy7.type == "ok") {
    (await deploy7.data.tx.sign().complete()).submit();
    emulator.awaitBlock(4);
  }

  const deploy8 = await deployRefScripts(lucid, {
    script: scripts.tokenHolderValidator,
    name: "TokenHolderValidator",
    alwaysFails: alwaysFailValidator.cborHex,
    currentTime: deployTime
  });

  expect(deploy8.type).toBe("ok");
  if (deploy8.type == "ok") {
    (await deploy8.data.tx.sign().complete()).submit();
    emulator.awaitBlock(4);
  }

  return deploy1;
}

export async function getRefUTxOs(
  lucid: Lucid,
  deployPolicyId: string
): Promise<{
  nodeValidatorUTxO: UTxO,
  nodePolicyUTxO: UTxO,
  nodeStakeValidatorUTxO: UTxO,
  foldPolicyUTxO: UTxO,
  foldValidatorUTxO: UTxO,
  rewardPolicyUTxO: UTxO,
  rewardValidatorUTxO: UTxO,
  tokenHolderPolicyUTxO: UTxO,
  tokenHolderValidatorUTxO: UTxO,  
}>{
  const [nodeValidatorUTxO] = await lucid.utxosAtWithUnit(
    lucid.utils.validatorToAddress({
      type: "PlutusV2",
      script: alwaysFailValidator.cborHex,
    }),
    toUnit(deployPolicyId, fromText("StakingValidator"))
  );

  const [nodeStakeValidatorUTxO] = await lucid.utxosAtWithUnit(
    lucid.utils.validatorToAddress({
      type: "PlutusV2",
      script: alwaysFailValidator.cborHex,
    }),
    toUnit(deployPolicyId, fromText("StakingStakeValidator"))
  );

  const [nodePolicyUTxO] = await lucid.utxosAtWithUnit(
    lucid.utils.validatorToAddress({
      type: "PlutusV2",
      script: alwaysFailValidator.cborHex,
    }),
    toUnit(deployPolicyId, fromText("StakingPolicy"))
  );

  const [foldPolicyUTxO] = await lucid.utxosAtWithUnit(
    lucid.utils.validatorToAddress({
      type: "PlutusV2",
      script: alwaysFailValidator.cborHex,
    }),
    toUnit(deployPolicyId, fromText("FoldPolicy"))
  );

  const [foldValidatorUTxO] = await lucid.utxosAtWithUnit(
    lucid.utils.validatorToAddress({
      type: "PlutusV2",
      script: alwaysFailValidator.cborHex,
    }),
    toUnit(deployPolicyId, fromText("FoldValidator"))
  );

  const [rewardPolicyUTxO] = await lucid.utxosAtWithUnit(
    lucid.utils.validatorToAddress({
      type: "PlutusV2",
      script: alwaysFailValidator.cborHex,
    }),
    toUnit(deployPolicyId, fromText("RewardFoldPolicy"))
  );

  const [rewardValidatorUTxO] = await lucid.utxosAtWithUnit(
    lucid.utils.validatorToAddress({
      type: "PlutusV2",
      script: alwaysFailValidator.cborHex,
    }),
    toUnit(deployPolicyId, fromText("RewardFoldValidator"))
  );

  const [tokenHolderPolicyUTxO] = await lucid.utxosAtWithUnit(
    lucid.utils.validatorToAddress({
      type: "PlutusV2",
      script: alwaysFailValidator.cborHex,
    }),
    toUnit(deployPolicyId, fromText("TokenHolderPolicy"))
  );

  const [tokenHolderValidatorUTxO] = await lucid.utxosAtWithUnit(
    lucid.utils.validatorToAddress({
      type: "PlutusV2",
      script: alwaysFailValidator.cborHex,
    }),
    toUnit(deployPolicyId, fromText("TokenHolderValidator"))
  );

  return {
    nodeValidatorUTxO: nodeValidatorUTxO,
    nodePolicyUTxO: nodePolicyUTxO,
    nodeStakeValidatorUTxO: nodeStakeValidatorUTxO,
    foldPolicyUTxO: foldPolicyUTxO,
    foldValidatorUTxO: foldValidatorUTxO,
    rewardPolicyUTxO: rewardPolicyUTxO,
    rewardValidatorUTxO: rewardValidatorUTxO,
    tokenHolderPolicyUTxO: tokenHolderPolicyUTxO,
    tokenHolderValidatorUTxO: tokenHolderValidatorUTxO  
  }
}

// Inserts three nodes belonging to account 1, 2 & 3 in the same order
export async function insertThreeNodes(
  lucid: Lucid,
  emulator: Emulator,
  users: any,
  scripts: AppliedScripts,
  refUTxOs: {
    nodeValidatorUTxO: UTxO,
  nodePolicyUTxO: UTxO,
  nodeStakeValidatorUTxO: UTxO,
  foldPolicyUTxO: UTxO,
  foldValidatorUTxO: UTxO,
  rewardPolicyUTxO: UTxO,
  rewardValidatorUTxO: UTxO,
  tokenHolderPolicyUTxO: UTxO,
  tokenHolderValidatorUTxO: UTxO, 
  },
  freezeStake: POSIXTime,
  logFlag: Boolean
): Promise<void> {
  // INSERT NODE ACCOUNT 1

  const insertNodeConfig: InsertNodeConfig = {
    scripts: {
      nodePolicy: scripts.nodePolicy,
      nodeValidator: scripts.nodeValidator,
    },
    refScripts: {
      nodeValidator: refUTxOs.nodeValidatorUTxO,
      nodePolicy: refUTxOs.nodePolicyUTxO,
    },
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
          await parseUTxOsAtScript(lucid, scripts.nodeValidator, SetNode),
          replacer,
          2
        )
      )
    : null;
}