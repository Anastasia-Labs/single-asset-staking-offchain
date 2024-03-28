import {
  CreateConfig,
  createConfig,
  initNode,
  InitNodeConfig,
  ONE_HOUR_MS,
  parseUTxOsAtScript,
  removeNode,
  RemoveNodeConfig,
  replacer,
  SetNode,
  TWENTY_FOUR_HOURS_MS,
} from "../src/index.js";
import { test, expect, beforeEach } from "vitest";
import alwaysFails from "./compiled/alwaysFails.json";
import {
  buildDeployFetchRefScripts,
  initializeLucidContext,
  insertThreeNodes,
  LucidContext,
} from "./setup.js";

beforeEach<LucidContext>(initializeLucidContext);

test<LucidContext>("Test - initNode - account1 insertNode - account2 insertNode - account3 insertNode - account2 removeNode", async ({
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
  const [configUTxO] = await lucid
    .selectWalletFrom({ address: users.account1.address })
    .wallet.getUtxos();

  const currentTime = emulator.now();

  // DEPLOY
  lucid.selectWalletFromSeed(users.account3.seedPhrase);
  const refUTxOsRes = await buildDeployFetchRefScripts(lucid, emulator);

  expect(refUTxOsRes.type).toBe("ok");
  if (refUTxOsRes.type == "error") return;
  const refUTxOs = refUTxOsRes.data;

  // CREATE CONFIG
  const createConfigObj: CreateConfig = {
    stakingConfig: {
      stakingInitUTXO: treasuryUTxO,
      rewardInitUTXO: reward1UTxO,
      freezeStake: currentTime + ONE_HOUR_MS,
      endStaking: currentTime + ONE_HOUR_MS + TWENTY_FOUR_HOURS_MS,
      penaltyAddress: users.treasury1.address,
      stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
      stakeTN: "MIN",
      minimumStake: 1_000_000_000_000,
      rewardCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
      rewardTN: "MIN",
    },
    configInitUTXO: configUTxO,
    refScripts: {
      configPolicy: refUTxOs.configPolicy,
    },
    alwaysFails: alwaysFails.cborHex,
    currentTime: emulator.now(),
  };

  lucid.selectWalletFromSeed(users.account1.seedPhrase);
  const createConfigUnsigned = await createConfig(lucid, createConfigObj);

  expect(createConfigUnsigned.type).toBe("ok");
  if (createConfigUnsigned.type == "error") return;
  const createConfigSigned = await createConfigUnsigned.data.tx
    .sign()
    .complete();
  await createConfigSigned.submit();

  const configTN = createConfigUnsigned.data.configTN;

  emulator.awaitBlock(4);

  // INIT NODE
  const initNodeConfig: InitNodeConfig = {
    configTN: configTN,
    stakingInitUTXO: treasuryUTxO,
    stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    stakeTN: "MIN",
    minimumStake: 1_000_000_000_000,
    refScripts: refUTxOs,
  };
  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const initNodeUnsigned = await initNode(lucid, initNodeConfig);

  expect(initNodeUnsigned.type).toBe("ok");
  if (initNodeUnsigned.type == "error") return;

  const initNodeSigned = await initNodeUnsigned.data.sign().complete();
  const initNodeHash = await initNodeSigned.submit();

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "initNode result ",
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

  // INSERT NODES, ACCOUNT 1 -> ACCOUNT 2 -> ACCOUNT 3
  // Total blocks elapsed in step - 12
  const freezeStake = currentTime + ONE_HOUR_MS;
  await insertThreeNodes(
    lucid,
    emulator,
    users,
    configTN,
    refUTxOs,
    freezeStake,
    logFlag,
  );

  // 1 block = 20 secs
  // 1 hour = 180 blocks
  // 24 hours = 4320 blocks

  // Total blocks eplased till now = 36 + 12 = 48

  // before freezeStake or within 1 hour - up to 148 blocks
  // emulator.awaitBlock(100); // Remove without penalty

  // after freezeStake and before endStaking
  // emulator.awaitBlock(200); // Remove with penalty

  // after endStaking
  // emulator.awaitBlock(5000); // Claim stake & reward

  // before freezeStake
  emulator.awaitBlock(100); // Remove without penalty

  // REMOVE NODE 1
  const removeNodeConfig: RemoveNodeConfig = {
    configTN: configTN,
    refScripts: refUTxOs,
    currentTime: emulator.now(),
    freezeStake: currentTime + ONE_HOUR_MS,
    endStaking: currentTime + ONE_HOUR_MS + TWENTY_FOUR_HOURS_MS,
    penaltyAddress: users.treasury1.address,
    stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    stakeTN: "MIN",
  };

  lucid.selectWalletFromSeed(users.account1.seedPhrase);
  const removeNodeUnsigned = await removeNode(lucid, removeNodeConfig);
  // console.log(removeNodeUnsigned);

  expect(removeNodeUnsigned.type).toBe("ok");
  if (removeNodeUnsigned.type == "error") return;

  const removeNodeSigned = await removeNodeUnsigned.data.sign().complete();
  const removeNodeHash = await removeNodeSigned.submit();

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "removeNode 1 result",
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
  logFlag
    ? console.log(
        "account1 address with stake",
        await lucid.utxosAt(users.account1.address),
      )
    : null;

  // after freezeStake before endStaking
  emulator.awaitBlock(100); // Remove with penalty

  // REMOVE NODE 2

  lucid.selectWalletFromSeed(users.account2.seedPhrase);
  const removeNodeUnsigned2 = await removeNode(lucid, {
    ...removeNodeConfig,
    currentTime: emulator.now(),
  });

  expect(removeNodeUnsigned2.type).toBe("ok");
  if (removeNodeUnsigned2.type == "error") return;
  // console.log(removeNodeUnsigned.data.txComplete.to_json())
  const removeNodeSigned2 = await removeNodeUnsigned2.data.sign().complete();
  const removeNodeHash2 = await removeNodeSigned2.submit();

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "removeNode 2 result",
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
  logFlag
    ? console.log(
        "treasury address with penalty",
        await lucid.utxosAt(users.treasury1.address),
      )
    : null;

  // FAIL REMOVE NODE 2

  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const removeNodeUnsigned3 = await removeNode(lucid, {
    ...removeNodeConfig,
    currentTime: emulator.now(),
  });

  expect(removeNodeUnsigned3.type).toBe("error");

  if (removeNodeUnsigned3.type == "ok") {
    const removeNodeSigned3 = await removeNodeUnsigned3.data.sign().complete();
    const removeNodeHash3 = await removeNodeSigned3.submit();
  }

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "failed removeNode result",
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

  // after endStaking
  emulator.awaitBlock(5000); //

  // FAIL REMOVE NODE 3

  lucid.selectWalletFromSeed(users.account3.seedPhrase);
  const removeNodeUnsigned4 = await removeNode(lucid, {
    ...removeNodeConfig,
    currentTime: emulator.now(),
  });

  // console.log(removeNodeUnsigned4);
  expect(removeNodeUnsigned4.type).toBe("error");
  if (removeNodeUnsigned4.type == "ok") return;

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "failed removeNode 3 result",
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
});
