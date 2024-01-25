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
  Scripts,
  Deploy,
  Result,
  UTxO,
  InsertNodeConfig,
  insertNode
} from "../src/index.js";
import { test, expect, beforeEach } from "vitest";
import stakingValidator from "./compiled/stakingValidator.json";
import stakingPolicy from "./compiled/stakingMint.json";
import stakingStakeValidator from "./compiled/stakingStakeValidator.json"
import foldPolicy from "./compiled/foldMint.json";
import foldValidator from "./compiled/foldValidator.json";
import rewardPolicy from "./compiled/rewardFoldMint.json";
import rewardValidator from "./compiled/rewardFoldValidator.json";
import tokenHolderPolicy from "./compiled/tokenHolderPolicy.json"
import tokenHolderValidator from "./compiled/tokenHolderValidator.json"
import alwaysFailValidator from "./compiled/alwaysFails.json";

export async function deploy(
  lucid: Lucid, 
  emulator: Emulator, 
  scripts: Scripts, 
  deployTime: number
): Promise<Result<Deploy>> {
  const deploy1 = await deployRefScripts(lucid, {
    script: scripts.stakingPolicy,
    name: "StakingPolicy",
    alwaysFails: alwaysFailValidator.cborHex,
    currenTime: deployTime
  });

  expect(deploy1.type).toBe("ok");
  if (deploy1.type == "ok") {
    (await deploy1.data.tx.sign().complete()).submit();
    emulator.awaitBlock(4);
  }

  const deploy2 = await deployRefScripts(lucid, {
    script: scripts.stakingValidator,
    name: "StakingValidator",
    alwaysFails: alwaysFailValidator.cborHex,
    currenTime: deployTime
  });

  expect(deploy2.type).toBe("ok");
  if (deploy2.type == "ok") {
    (await deploy2.data.tx.sign().complete()).submit();
    emulator.awaitBlock(4);
  }

  const deployStake = await deployRefScripts(lucid, {
    script: scripts.stakingStakeValidator,
    name: "StakingStakeValidator",
    alwaysFails: alwaysFailValidator.cborHex,
    currenTime: deployTime
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
    currenTime: deployTime
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
    currenTime: deployTime
  });

  expect(deploy4.type).toBe("ok");
  if (deploy4.type == "ok") {
    (await deploy4.data.tx.sign().complete()).submit();
    emulator.awaitBlock(4);
  }

  const deploy5 = await deployRefScripts(lucid, {
    script: scripts.rewardPolicy,
    name: "RewardFoldPolicy",
    alwaysFails: alwaysFailValidator.cborHex,
    currenTime: deployTime
  });

  expect(deploy5.type).toBe("ok");
  if (deploy5.type == "ok") {
    (await deploy5.data.tx.sign().complete()).submit();
    emulator.awaitBlock(4);
  }

  const deploy6 = await deployRefScripts(lucid, {
    script: scripts.rewardValidator,
    name: "RewardFoldValidator",
    alwaysFails: alwaysFailValidator.cborHex,
    currenTime: deployTime
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
    currenTime: deployTime
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
    currenTime: deployTime
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
  scripts: Scripts,
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
  logFlag: Boolean
): Promise<void> {
  // INSERT NODE ACCOUNT 1

  const insertNodeConfig: InsertNodeConfig = {
    scripts: {
      nodePolicy: scripts.stakingPolicy,
      nodeValidator: scripts.stakingValidator,
    },
    refScripts: {
      nodeValidator: refUTxOs.nodeValidatorUTxO,
      nodePolicy: refUTxOs.nodePolicyUTxO,
    },
    amountLovelace: 4_000_000,
    currenTime: emulator.now(),
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
    scripts: {
      nodePolicy: scripts.stakingPolicy,
      nodeValidator: scripts.stakingValidator,
    },
    refScripts: {
      nodeValidator: refUTxOs.nodeValidatorUTxO,
      nodePolicy: refUTxOs.nodePolicyUTxO,
    },
    amountLovelace: 5_000_000,
    currenTime: emulator.now(),
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
    scripts: {
      nodePolicy: scripts.stakingPolicy,
      nodeValidator: scripts.stakingValidator,
    },
    refScripts: {
      nodeValidator: refUTxOs.nodeValidatorUTxO,
      nodePolicy: refUTxOs.nodePolicyUTxO,
    },
    amountLovelace: 5_000_000,
    currenTime: emulator.now(),
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
          await parseUTxOsAtScript(lucid, scripts.stakingValidator),
          replacer,
          2
        )
      )
    : null;
}