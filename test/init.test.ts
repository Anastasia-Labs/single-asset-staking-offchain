import {
  CreateConfig,
  initNode,
  InitNodeConfig,
  initTokenHolder,
  InitTokenHolderConfig,
  ONE_HOUR_MS,
  parseUTxOsAtScript,
  replacer,
  SetNode,
  TWENTY_FOUR_HOURS_MS,
  createConfig,
  FetchConfig,
  fetchConfigReadableUTxO,
  utxosAtScript,
} from "../src/index.js";
import { test, expect, beforeEach } from "vitest";
import alwaysFails from "./compiled/alwaysFails.json";
import {
  buildDeployFetchRefScripts,
  initializeLucidContext,
  LucidContext,
} from "./setup.js";

beforeEach<LucidContext>(initializeLucidContext);

test<LucidContext>("Test - deploy - createConfig - initTokenHolder - initNode", async ({
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

  const fetchConfig: FetchConfig = {
    configTN: configTN,
    refScripts: refUTxOs,
  };
  const configUTxOResponse = await fetchConfigReadableUTxO(lucid, fetchConfig);
  if (configUTxOResponse.type == "error") return configUTxOResponse;

  // console.log(configUTxOResponse);

  // INIT PROJECT TOKEN HOLDER
  const initTokenHolderConfig: InitTokenHolderConfig = {
    configTN: configTN,
    rewardInitUTXO: reward1UTxO,
    rewardCS: "2c04fa26b36a376440b0615a7cdf1a0c2df061df89c8c055e2650505",
    rewardTN: "MIN",
    rewardAmount: 90_000_000,
    refScripts: refUTxOs,
  };

  lucid.selectWalletFromSeed(users.reward1.seedPhrase);
  const initTokenHolderUnsigned = await initTokenHolder(
    lucid,
    initTokenHolderConfig,
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
  logFlag
    ? console.log(
        "utxos at tokenholderScript",
        await utxosAtScript(
          lucid,
          refUTxOs.tokenHolderValidator.scriptRef?.script!,
        ),
      )
    : null;

  // INIT NODE - treasury1 account
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
