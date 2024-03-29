import {
  createConfig,
  CreateConfig,
  FoldDatum,
  initFold,
  InitFoldConfig,
  initStaking,
  InitStakingConfig,
  ONE_HOUR_MS,
  parseUTxOsAtScript,
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

test<LucidContext>("Test - initStaking - account1 insertNode - account2 insertNode - account3 insertNode - treasury1 initFold", async ({
  lucid,
  users,
  emulator,
}) => {
  const logFlag = false;

  const [treasuryUTxO] = await lucid
    .selectWalletFrom({ address: users.treasury1.address })
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

  // INIT STAKING
  const initStakingConfig: InitStakingConfig = {
    configTN: configTN,
    stakingInitUTXO: treasuryUTxO,
    stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    stakeTN: "MIN",
    minimumStake: 1_000_000_000_000,
    rewardCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    rewardTN: "MIN",
    rewardAmount: 8_000_000_000_000,
    refScripts: refUTxOs,
  };

  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const initStakingUnsigned = await initStaking(lucid, initStakingConfig);
  // console.log(initStakingUnsigned);

  expect(initStakingUnsigned.type).toBe("ok");
  if (initStakingUnsigned.type == "error") return;
  // console.log(tx.data.txComplete.to_json())
  const initStakingSigned = await initStakingUnsigned.data.sign().complete();
  await initStakingSigned.submit();

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "initStaking result ",
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

  // Incorrect INIT FOLD - Init before endStaking

  const initFoldConfig: InitFoldConfig = {
    refScripts: refUTxOs,
    configTN: configTN,
    currentTime: emulator.now(),
  };

  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const initFoldUnsignedF = await initFold(lucid, initFoldConfig);

  // console.log(initFoldUnsignedF);
  expect(initFoldUnsignedF.type).toBe("error");
  if (initFoldUnsignedF.type == "ok") return;

  // Wait for endStaking to pass
  emulator.awaitBlock(5000);

  // INIT FOLD

  lucid.selectWalletFromSeed(users.treasury1.seedPhrase);
  const initFoldUnsigned = await initFold(lucid, {
    ...initFoldConfig,
    currentTime: emulator.now(),
  });

  // console.log(initFoldUnsigned);
  expect(initFoldUnsigned.type).toBe("ok");
  if (initFoldUnsigned.type == "error") return;
  // console.log(insertNodeUnsigned.data.txComplete.to_json())

  const initFoldSigned = await initFoldUnsigned.data.sign().complete();
  const initFoldHash = await initFoldSigned.submit();

  emulator.awaitBlock(100);

  logFlag
    ? console.log(
        "init fold result",
        JSON.stringify(
          await parseUTxOsAtScript(
            lucid,
            refUTxOs.foldValidator.scriptRef?.script!,
            FoldDatum,
          ),
          replacer,
          2,
        ),
      )
    : null;
});
