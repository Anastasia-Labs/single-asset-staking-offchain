import {
  buildScripts,
  FoldDatum,
  initFold,
  InitFoldConfig,
  initNode,
  InitNodeConfig,
  multiFold,
  MultiFoldConfig,
  ONE_HOUR_MS,
  parseUTxOsAtScript,
  replacer,
  SetNode,
  sortByOutRefWithIndex,
  TWENTY_FOUR_HOURS_MS,
} from "../src/index.js";
import { test, expect, beforeEach } from "vitest";
import nodeValidator from "./compiled/nodeValidator.json";
import nodePolicy from "./compiled/nodePolicy.json";
import foldPolicy from "./compiled/foldPolicy.json";
import foldValidator from "./compiled/foldValidator.json";
import rewardFoldPolicy from "./compiled/rewardFoldPolicy.json";
import rewardFoldValidator from "./compiled/rewardFoldValidator.json";
import tokenHolderPolicy from "./compiled/tokenHolderPolicy.json";
import tokenHolderValidator from "./compiled/tokenHolderValidator.json";
import nodeStakeValidator from "./compiled/nodeStakeValidator.json";
import {
  deploy,
  getRefUTxOs,
  initializeLucidContext,
  insertThreeNodes,
  LucidContext,
} from "./setup.js";

beforeEach<LucidContext>(initializeLucidContext);

test.skip<LucidContext>("Test - initNode - account1 insertNode - account2 insertNode - account3 insertNode - treasury1 initFold - treasury1 multiFold", async ({
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
      minimumStake: 1_000,
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
  const deployRefScripts = await deploy(
    lucid,
    emulator,
    newScripts.data,
    deployTime,
  );

  expect(deployRefScripts.type).toBe("ok");
  if (deployRefScripts.type == "error") return;
  // Find node refs script
  const deployPolicyId = deployRefScripts.data.deployPolicyId;

  const refUTxOs = await getRefUTxOs(lucid, deployPolicyId);

  // INIT NODE
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

  expect(initNodeUnsigned.type).toBe("ok");
  if (initNodeUnsigned.type == "error") return;

  const initNodeSigned = await initNodeUnsigned.data.sign().complete();
  const initNodeHash = await initNodeSigned.submit();
  // console.log(initNodeHash)

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "initNode result ",
        JSON.stringify(
          await parseUTxOsAtScript(
            lucid,
            newScripts.data.nodeValidator,
            SetNode,
          ),
          replacer,
          2,
        ),
      )
    : null;

  // INSERT NODES, ACCOUNT 1 -> ACCOUNT 2 -> ACCOUNT 3
  const freezeStake = currentTime + ONE_HOUR_MS;
  await insertThreeNodes(
    lucid,
    emulator,
    users,
    newScripts.data,
    refUTxOs,
    freezeStake,
    logFlag,
  );

  // Wait for endStaking to pass
  emulator.awaitBlock(5000);

  // INIT FOLD
  const initFoldConfig: InitFoldConfig = {
    scripts: {
      nodeValidator: newScripts.data.nodeValidator,
      nodePolicy: newScripts.data.nodePolicy,
      foldPolicy: newScripts.data.foldPolicy,
      foldValidator: newScripts.data.foldValidator,
    },
    currentTime: emulator.now(),
  };

  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const initFoldUnsigned = await initFold(lucid, initFoldConfig);

  expect(initFoldUnsigned.type).toBe("ok");
  if (initFoldUnsigned.type == "error") return;

  const initFoldSigned = await initFoldUnsigned.data.sign().complete();
  const initFoldHash = await initFoldSigned.submit();

  emulator.awaitBlock(4);

  // TEST NEW FUNCTIONS

  // console.log(
  //   "unsorted keys",
  //   await parseUTxOsAtScript(lucid, newScripts.data.nodeValidator, SetNode)
  // );
  //
  // console.log(
  //   "reduce sorted keys with index",
  //   JSON.stringify(
  //     sortByOutRefWithIndex(
  //       await parseUTxOsAtScript(lucid, newScripts.data.nodeValidator, SetNode)
  //     ),
  //     replacer,
  //     2
  //   )
  // );
  //
  // const chunksNodeRefInputs = chunkArray(
  //   (await parseUTxOsAtScript(lucid, newScripts.data.nodeValidator, SetNode)).map(
  //     (readableUTxO) => {
  //       return readableUTxO.outRef;
  //     }
  //   ),
  //   2
  // );

  // MULTIFOLD

  const multiFoldConfig: MultiFoldConfig = {
    nodeRefInputs: sortByOutRefWithIndex(
      await parseUTxOsAtScript(lucid, newScripts.data.nodeValidator, SetNode),
    ).map((data) => {
      return data.value.outRef;
    }),
    indices: sortByOutRefWithIndex(
      await parseUTxOsAtScript(lucid, newScripts.data.nodeValidator, SetNode),
    ).map((data) => {
      return data.index;
    }),
    scripts: {
      foldPolicy: newScripts.data.foldPolicy,
      foldValidator: newScripts.data.foldValidator,
    },
    currentTime: emulator.now(),
    stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    stakeTN: "MIN",
  };

  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const multiFoldUnsigned = await multiFold(lucid, multiFoldConfig);
  // console.log(multiFoldUnsigned)

  expect(multiFoldUnsigned.type).toBe("ok");
  if (multiFoldUnsigned.type == "error") return;
  // console.log(insertNodeUnsigned.data.txComplete.to_json())
  const multiFoldSigned = await multiFoldUnsigned.data.sign().complete();
  const multiFoldHash = await multiFoldSigned.submit();

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "Multifold result",
        JSON.stringify(
          await parseUTxOsAtScript(
            lucid,
            newScripts.data.foldValidator,
            FoldDatum,
          ),
          replacer,
          2,
        ),
      )
    : null;
});
