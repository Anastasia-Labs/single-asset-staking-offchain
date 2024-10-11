import {
  CreateConfig,
  createConfig,
  FoldDatum,
  initFold,
  InitFoldConfig,
  initStaking,
  InitStakingConfig,
  initRewardFold,
  InitRewardFoldConfig,
  multiFold,
  MultiFoldConfig,
  ONE_HOUR_MS,
  parseUTxOsAtScript,
  replacer,
  RewardFoldDatum,
  SetNode,
  TWENTY_FOUR_HOURS_MS,
  utxosAtScript,
  validatorToRewardAddress,
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

test<LucidContext>("Test - initRewardTokenHolder - initStaking  - insertNodes - initFold - multiFold - initRewardFold", async ({
  lucid,
  users,
  emulator,
}) => {
  const logFlag = false;
  const network = lucid.config().network;
  // const [treasuryUTxO] = await lucid
  //   .selectWalletFrom({ address: users.treasury1.address })
  //   .wallet.getUtxos();
  const treasury1Address = users.treasury1.address;
  const [treasuryUTxO] = await lucid.config().provider.getUtxos(treasury1Address);

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

  // REGISTER STAKE VALIDATOR
  emulator.distributeRewards(BigInt(100_000_000));

  const nodeStakeRewardAddress = validatorToRewardAddress(network,
    refUTxOs.nodeStakeValidator.scriptRef!,
  );

  await lucid.awaitTx(
    await (
      await (
        await lucid.newTx().registerStake(nodeStakeRewardAddress!).complete()
      )
        .sign.withWallet()
        .complete()
    ).submit(),
  );

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
        "utxos at tokenholderScript",
        await utxosAtScript(
          lucid,
          refUTxOs.tokenHolderValidator.scriptRef?.script!,
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
  emulator.awaitBlock(6000);

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
  // console.log(insertNodeUnsigned.data.txComplete.to_json())
  const initFoldSigned = await initFoldUnsigned.data.sign.withWallet().complete();
  const initFoldHash = await initFoldSigned.submit();

  emulator.awaitBlock(4);

  // MULTIFOLD

  const multiFoldConfig: MultiFoldConfig = {
    refScripts: refUTxOs,
    configTN: configTN,
    currentTime: emulator.now(),
    stakeCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    stakeTN: "MIN",
  };

  const multiFoldUnsigned = await multiFold(lucid, multiFoldConfig);
  // console.log(multiFoldUnsigned)

  expect(multiFoldUnsigned.type).toBe("ok");
  if (multiFoldUnsigned.type == "error") return;
  // console.log(insertNodeUnsigned.data.txComplete.to_json())
  lucid.selectWallet.fromSeed(users.treasury1.seedPhrase);
  const multiFoldSigned = await multiFoldUnsigned.data.sign.withWallet().complete();
  const multiFoldHash = await multiFoldSigned.submit();

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

  const initRewardFoldConfig: InitRewardFoldConfig = {
    rewardCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    penaltyAddress: users.treasury1.address,
    rewardTN: "MIN",
    refScripts: refUTxOs,
    configTN: configTN,
  };

  lucid.selectWallet.fromSeed(users.treasury1.seedPhrase);
  const initRewardFoldUnsigned = await initRewardFold(
    lucid,
    initRewardFoldConfig,
  );
  // console.log(initRewardFoldUnsigned);

  expect(initRewardFoldUnsigned.type).toBe("ok");
  if (initRewardFoldUnsigned.type == "error") return;

  const initRewardFoldSigned = await initRewardFoldUnsigned.data
    .sign.withWallet()
    .complete();
  const initRewardFoldHash = await initRewardFoldSigned.submit();

  emulator.awaitBlock(4);

  logFlag
    ? console.log(
        "Init Reward Fold Result",
        JSON.stringify(
          await parseUTxOsAtScript(
            lucid,
            refUTxOs.rewardFoldValidator.scriptRef?.script!,
            RewardFoldDatum,
          ),
          replacer,
          2,
        ),
      )
    : null;
});
