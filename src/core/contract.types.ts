import { Data } from "@anastasia-labs/lucid-cardano-fork";

export const PubKeyHashSchema = Data.Bytes({ minLength: 28, maxLength: 28 });
export type PubKeyHash = Data.Static<typeof PubKeyHashSchema>;
export const PubKeyHash = PubKeyHashSchema as unknown as PubKeyHash;

export const OutputReferenceSchema = Data.Object({
  txHash: Data.Object({ hash: Data.Bytes({ minLength: 32, maxLength: 32 }) }),
  outputIndex: Data.Integer(),
});
export type OutputReference = Data.Static<typeof OutputReferenceSchema>;
export const OutputReference =
  OutputReferenceSchema as unknown as OutputReference;

export const CredentialSchema = Data.Enum([
  Data.Object({
    PublicKeyCredential: Data.Tuple([
      Data.Bytes({ minLength: 28, maxLength: 28 }),
    ]),
  }),
  Data.Object({
    ScriptCredential: Data.Tuple([
      Data.Bytes({ minLength: 28, maxLength: 28 }),
    ]),
  }),
]);
export type CredentialD = Data.Static<typeof CredentialSchema>;
export const CredentialD = CredentialSchema as unknown as CredentialD;

export const AddressSchema = Data.Object({
  paymentCredential: CredentialSchema,
  stakeCredential: Data.Nullable(
    Data.Enum([
      Data.Object({ Inline: Data.Tuple([CredentialSchema]) }),
      Data.Object({
        Pointer: Data.Tuple([
          Data.Object({
            slotNumber: Data.Integer(),
            transactionIndex: Data.Integer(),
            certificateIndex: Data.Integer(),
          }),
        ]),
      }),
    ]),
  ),
});
export type AddressD = Data.Static<typeof AddressSchema>;
export const AddressD = AddressSchema as unknown as AddressD;

export const NodeKeySchema = Data.Nullable(Data.Bytes());
export type NodeKey = Data.Static<typeof NodeKeySchema>;
export const NodeKey = NodeKeySchema as unknown as NodeKey;

export const SetNodeSchema = Data.Object({
  key: NodeKeySchema,
  next: NodeKeySchema,
  configTN: Data.Bytes({ maxLength: 32 }),
});
export type SetNode = Data.Static<typeof SetNodeSchema>;
export const SetNode = SetNodeSchema as unknown as SetNode;

export const StakingNodeActionSchema = Data.Enum([
  Data.Literal("PInit"),
  Data.Literal("PDInit"),
  Data.Object({
    PInsert: Data.Object({
      keyToInsert: PubKeyHashSchema,
      coveringNode: SetNodeSchema,
    }),
  }),
  Data.Object({
    PRemove: Data.Object({
      keyToRemove: PubKeyHashSchema,
      coveringNode: SetNodeSchema,
    }),
  }),
  Data.Object({
    PClaim: Data.Object({
      keyToRemove: PubKeyHashSchema,
    }),
  }),
]);
export type StakingNodeAction = Data.Static<typeof StakingNodeActionSchema>;
export const StakingNodeAction =
  StakingNodeActionSchema as unknown as StakingNodeAction;

export const StakingConfigSchema = Data.Object({
  stakingInitUTxO: OutputReferenceSchema,
  freezeStake: Data.Integer(),
  endStaking: Data.Integer(),
  penaltyAddress: AddressSchema,
  stakeCS: Data.Bytes({ minLength: 28, maxLength: 28 }),
  stakeTN: Data.Bytes(),
  minimumStake: Data.Integer(),
  rewardCS: Data.Bytes({ minLength: 28, maxLength: 28 }),
  rewardTN: Data.Bytes(),
});
export type StakingConfig = Data.Static<typeof StakingConfigSchema>;
export const StakingConfig = StakingConfigSchema as unknown as StakingConfig;

export const NodeValidatorActionSchema = Data.Enum([
  Data.Literal("LinkedListAct"),
  Data.Literal("ModifyStake"),
  Data.Literal("RewardFoldAct"),
]);
export type NodeValidatorAction = Data.Static<typeof NodeValidatorActionSchema>;
export const NodeValidatorAction =
  NodeValidatorActionSchema as unknown as NodeValidatorAction;

export const FoldDatumSchema = Data.Object({
  currNode: SetNodeSchema,
  staked: Data.Integer(),
  owner: AddressSchema,
});
export type FoldDatum = Data.Static<typeof FoldDatumSchema>;
export const FoldDatum = FoldDatumSchema as unknown as FoldDatum;

export const FoldActSchema = Data.Enum([
  Data.Object({
    FoldNodes: Data.Object({
      nodeIdxs: Data.Array(Data.Integer()),
    }),
  }),
  Data.Literal("Reclaim"),
]);
export type FoldAct = Data.Static<typeof FoldActSchema>;
export const FoldAct = FoldActSchema as unknown as FoldAct;

export const FoldMintActSchema = Data.Enum([
  Data.Literal("MintFold"),
  Data.Literal("BurnFold"),
]);
export type FoldMintAct = Data.Static<typeof FoldMintActSchema>;
export const FoldMintAct = FoldMintActSchema as unknown as FoldMintAct;

export const RewardFoldMintActSchema = Data.Enum([
  Data.Literal("MintRewardFold"),
  Data.Literal("BurnRewardFold"),
]);
export type RewardFoldMintAct = Data.Static<typeof RewardFoldMintActSchema>;
export const RewardFoldMintAct =
  RewardFoldMintActSchema as unknown as RewardFoldMintAct;

export const RewardFoldDatumSchema = Data.Object({
  currNode: SetNodeSchema,
  totalRewardTokens: Data.Integer(),
  totalStaked: Data.Integer(),
  owner: AddressSchema,
});
export type RewardFoldDatum = Data.Static<typeof RewardFoldDatumSchema>;
export const RewardFoldDatum =
  RewardFoldDatumSchema as unknown as RewardFoldDatum;

export const RewardFoldActSchema = Data.Enum([
  Data.Object({
    RewardsFoldNodes: Data.Object({
      nodeIdxs: Data.Array(Data.Integer()),
      nodeOutIdxs: Data.Array(Data.Integer()),
    }),
  }),
  Data.Literal("RewardsReclaim"),
]);
export type RewardFoldAct = Data.Static<typeof RewardFoldActSchema>;
export const RewardFoldAct = RewardFoldActSchema as unknown as RewardFoldAct;

export const TokenHolderMintActionSchema = Data.Enum([
  Data.Literal("PMintHolder"),
  Data.Literal("PBurnHolder"),
]);
export type TokenHolderMintAction = Data.Static<
  typeof TokenHolderMintActionSchema
>;
export const TokenHolderMintAction =
  TokenHolderMintActionSchema as unknown as TokenHolderMintAction;
