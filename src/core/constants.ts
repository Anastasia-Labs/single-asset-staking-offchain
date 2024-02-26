import { fromText } from "@anastasia-labs/lucid-cardano-fork";

export const SETNODE_PREFIX = "FSN";
export const CFOLD = "CFold";
export const RFOLD = "RFold";
export const RTHOLDER = "RTHolder";
export const TWENTY_FOUR_HOURS_MS = 86_400_000;
export const ONE_HOUR_MS = 3_600_000;

export const originNodeTokenName = fromText(SETNODE_PREFIX);
export const cFold = fromText(CFOLD);
export const rFold = fromText(RFOLD);

export const FOLDING_FEE_ADA = 1_000_000n;
export const MIN_ADA = 2_000_000n;
export const NODE_ADA = 3_000_000n;

export const TIME_TOLERANCE_MS =
  process.env.NODE_ENV == "emulator" ? 0 : 400_000;

export const PROTOCOL_PAYMENT_KEY =
  "014e9d57e1623f7eeef5d0a8d4e6734a562ba32cf910244cd74e1680";
export const PROTOCOL_STAKE_KEY =
  "5e8aa3f089868eaadf188426f49db6566624844b6c5d529b38f3b8a7";

export const PROTOCOL_FEE = 0.01;

// todo create a validator to deploy token name map
