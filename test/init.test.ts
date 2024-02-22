import {
  buildScripts,
  initNode,
  InitNodeConfig,
  initTokenHolder,
  InitTokenHolderConfig,
  ONE_HOUR_MS,
  parseUTxOsAtScript,
  replacer,
  SetNode,
  TWENTY_FOUR_HOURS_MS,
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
import { deploy, getRefUTxOs, initializeLucidContext, LucidContext } from "./setup.js";

beforeEach<LucidContext>(initializeLucidContext);

test<LucidContext>("Test - deploy - initTokenHolder - initNode", async ({
  lucid,
  users,
  emulator,
}) => {
  const logFlag = false;

  const [treasuryUTxO] = await lucid
    .selectWalletFrom({ address: users.treasury1.address })
    .wallet.getUtxos();
  const [reward1UTxO] = await lucid
    .selectWalletFrom({ address: users.reward1.address })
    .wallet.getUtxos();

  const currentTime = emulator.now();

  const newScripts = buildScripts(lucid, {
    nodePolicy: {
      initUTXO: treasuryUTxO,
      freezeStake: currentTime + ONE_HOUR_MS,
      endStaking: currentTime + ONE_HOUR_MS + TWENTY_FOUR_HOURS_MS,
      penaltyAddress: users.treasury1.address,    
      stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
      stakeTN: "MIN",
      minimumStake : 1_000,
    },
    rewardFoldValidator: {
      rewardCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
      rewardTN: "MIN",
    },
    rewardTokenHolder: {
      initUTXO: reward1UTxO,
    },
    unapplied: {
      nodePolicy: nodePolicy.cborHex,
      nodeValidator: nodeValidator.cborHex,
      nodeStakeValidator: nodeStakeValidator.cborHex,
      foldPolicy: foldPolicy.cborHex,
      foldValidator: foldValidator.cborHex,
      rewardFoldPolicy: rewardFoldPolicy.cborHex,
      rewardFoldValidator: rewardFoldValidator.cborHex,
      tokenHolderPolicy: tokenHolderPolicy.cborHex,
      tokenHolderValidator: tokenHolderValidator.cborHex,
    },
  });

  expect(newScripts.type).toBe("ok");
  if (newScripts.type == "error") return;

  // DEPLOY
  lucid.selectWalletFromSeed(users.account3.seedPhrase);

  const deployTime = emulator.now();
  const deployRefScripts = await deploy(lucid, emulator, newScripts.data, deployTime);
  
  expect(deployRefScripts.type).toBe("ok");
  if (deployRefScripts.type == "error") return;
  // Find node refs script
  const deployPolicyId = deployRefScripts.data.deployPolicyId;

  const refUTxOs = await getRefUTxOs(lucid, deployPolicyId);

  // INIT PROJECT TOKEN HOLDER
  const initTokenHolderConfig: InitTokenHolderConfig = {
    initUTXO: reward1UTxO,
    rewardCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    rewardTN: "MIN",
    rewardAmount: 90_000_000,
    scripts: {
      tokenHolderPolicy: newScripts.data.tokenHolderPolicy,
      tokenHolderValidator: newScripts.data.tokenHolderValidator,
    },
  };

  lucid.selectWalletFromSeed(users.reward1.seedPhrase);
  const initTokenHolderUnsigned = await initTokenHolder(
    lucid,
    initTokenHolderConfig
  );
  // console.log(initTokenHolderUnsigned);

  expect(initTokenHolderUnsigned.type).toBe("ok");
  if (initTokenHolderUnsigned.type == "ok") {
    const initTokenHolderSigned = await initTokenHolderUnsigned.data
      .sign()
      .complete();
    const initTokenHolderHash = await initTokenHolderSigned.submit();
  }

  emulator.awaitBlock(4);
  // console.log(
  //   "utxos at tokenholderScript",
  //   await utxosAtScript(lucid, newScripts.data.tokenHolderValidator)
  // );

  // INIT NODE - treasury1 account
  const initNodeConfig: InitNodeConfig = {
    initUTXO: treasuryUTxO,
    stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    stakeTN: "MIN",
    minimumStake: 1000,
    scripts: {
      nodePolicy: newScripts.data.nodePolicy,
      nodeValidator: newScripts.data.nodeValidator,
    },
    refScripts: {
      nodePolicy: refUTxOs.nodePolicyUTxO,
    },
  };
  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const initNodeUnsigned = await initNode(lucid, initNodeConfig);
  // console.log(initNodeUnsigned);

  expect(initNodeUnsigned.type).toBe("ok");
  if (initNodeUnsigned.type == "error") return;
  // console.log(tx.data.txComplete.to_json())
  const initNodeSigned = await initNodeUnsigned.data.sign().complete();
  const initNodeHash = await initNodeSigned.submit();
  // console.log(initNodeHash)

  emulator.awaitBlock(4);
  logFlag
    ? console.log(
        "initNode result ",
        JSON.stringify(
          await parseUTxOsAtScript(lucid, newScripts.data.nodeValidator, SetNode),
          replacer,
          2
        )
      )
    : null;
});
