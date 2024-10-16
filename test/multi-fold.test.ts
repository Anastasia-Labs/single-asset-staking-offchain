import {
  createConfig,
  CreateConfig,
  FoldDatum,
  initFold,
  InitFoldConfig,
  initStaking,
  InitStakingConfig,
  multiFold,
  MultiFoldConfig,
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

test<LucidContext>("Test - initStaking - account1 insertNode - account2 insertNode - account3 insertNode - treasury1 initFold - treasury1 multiFold", async ({
  lucid,
  users,
  emulator,
}) => {
  const logFlag = false;

  // const [treasuryUTxO] = await lucid
  //   .selectWalletFrom({ address: users.treasury1.address })
  //   .wallet.getUtxos();

  const treasuryAddress = users.treasury1.address;
  const [treasuryUTxO] = await lucid.config().provider.getUtxos(treasuryAddress);

  // const [configUTxO] = await lucid
  //   .selectWalletFrom({ address: users.account1.address })
  //   .wallet.getUtxos();

    const accountAddress = users.account1.address;
    const [configUTxO] = await lucid.config().provider.getUtxos(accountAddress);

  const currentTime = emulator.now();

  // DEPLOY
  lucid.selectWallet.fromSeed(users.account3.seedPhrase);
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

  lucid.selectWallet.fromSeed(users.account1.seedPhrase);
  const createConfigUnsigned = await createConfig(lucid, createConfigObj);

  expect(createConfigUnsigned.type).toBe("ok");
  if (createConfigUnsigned.type == "error") return;
  const createConfigSigned = await createConfigUnsigned.data.tx
    .sign.withWallet()
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

  lucid.selectWallet.fromSeed(users.treasury1.seedPhrase);
  const initStakingUnsigned = await initStaking(lucid, initStakingConfig);
  // console.log(initStakingUnsigned);

  expect(initStakingUnsigned.type).toBe("ok");
  if (initStakingUnsigned.type == "error") return;
  // console.log(tx.data.txComplete.to_json())
  const initStakingSigned = await initStakingUnsigned.data.sign.withWallet().complete();
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

  // Wait for endStaking to pass
  emulator.awaitBlock(5000);

  // INIT FOLD
  const initFoldConfig: InitFoldConfig = {
    refScripts: refUTxOs,
    configTN: configTN,
    currentTime: emulator.now(),
  };

  lucid.selectWallet.fromSeed(users.treasury1.seedPhrase);
  const initFoldUnsigned = await initFold(lucid, initFoldConfig);

  expect(initFoldUnsigned.type).toBe("ok");
  if (initFoldUnsigned.type == "error") return;

  const initFoldSigned = await initFoldUnsigned.data.sign.withWallet().complete();
  const initFoldHash = await initFoldSigned.submit();

  emulator.awaitBlock(4);

  // TEST NEW FUNCTIONS

  // console.log(
  //   "unsorted keys",
  //   await parseUTxOsAtScript(lucid, refUTxOs.nodeValidator, SetNode)
  // );
  //
  // console.log(
  //   "reduce sorted keys with index",
  //   JSON.stringify(
  //     sortByOutRefWithIndex(
  //       await parseUTxOsAtScript(lucid, refUTxOs.nodeValidator, SetNode)
  //     ),
  //     replacer,
  //     2
  //   )
  // );
  //
  // const chunksNodeRefInputs = chunkArray(
  //   (await parseUTxOsAtScript(lucid, refUTxOs.nodeValidator, SetNode)).map(
  //     (readableUTxO) => {
  //       return readableUTxO.outRef;
  //     }
  //   ),
  //   2
  // );

  // MULTIFOLD

  const multiFoldConfig: MultiFoldConfig = {
    refScripts: refUTxOs,
    configTN: configTN,
    currentTime: emulator.now(),
    stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    stakeTN: "MIN",
  };

  lucid.selectWallet.fromSeed(users.treasury1.seedPhrase);
  const multiFoldUnsigned = await multiFold(lucid, multiFoldConfig);
  // console.log(multiFoldUnsigned)

  expect(multiFoldUnsigned.type).toBe("ok");
  if (multiFoldUnsigned.type == "error") return;
  // console.log(insertNodeUnsigned.data.txComplete.to_json())
  const multiFoldSigned = await multiFoldUnsigned.data.sign.withWallet().complete();
  await multiFoldSigned.submit();

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "Multifold result",
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
