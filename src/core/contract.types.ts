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
    ])
  ),
});
export type AddressD = Data.Static<typeof AddressSchema>;
export const AddressD = AddressSchema as unknown as AddressD;

export const NodeKeySchema = Data.Nullable(Data.Bytes());
// export const NodeKeySchema = Data.Enum([
//   Data.Object({ Key: Data.Tuple([Data.Bytes()]) }),
//   Data.Literal("Empty"),
// ]);
//
export type NodeKeySchema = Data.Static<typeof NodeKeySchema>;

export type NodeKey = Data.Static<typeof NodeKeySchema>;
export const NodeKey = NodeKeySchema as unknown as NodeKey;

export const SetNodeSchema = Data.Object({
  key: NodeKeySchema,
  next: NodeKeySchema,
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
]);
export type StakingNodeAction = Data.Static<typeof StakingNodeActionSchema>;
export const StakingNodeAction =
  StakingNodeActionSchema as unknown as StakingNodeAction;

export const StakingConfigSchema = Data.Object({
  initUTXO: OutputReferenceSchema,
  maxRaise: Data.Integer(),
  stakingDeadLine: Data.Integer(),
  penaltyAddress: AddressSchema,
});
export type StakingConfig = Data.Static<typeof StakingConfigSchema>;
export const StakingConfig =
  StakingConfigSchema as unknown as StakingConfig;

// data PNodeValidatorAction (s :: S)
//   = PLinkedListAct (Term s (PDataRecord '[]))
//   | PModifyCommitment (Term s (PDataRecord '[]))
//   | PRewardFoldAct (Term s (PDataRecord '["rewardsIdx" ':= PInteger]))

export const NodeValidatorActionSchema = Data.Enum([
  Data.Literal("LinkedListAct"),
  Data.Literal("ModifyCommitment"),
  Data.Literal("RewardFoldAct"),
  // Data.Object({
  //   RewardFoldAct: Data.Object({
  //     rewardsIdx: Data.Integer(),
  //   }),
  // }),
]);
export type NodeValidatorAction = Data.Static<typeof NodeValidatorActionSchema>;
export const NodeValidatorAction =
  NodeValidatorActionSchema as unknown as NodeValidatorAction;

export const FoldDatumSchema = Data.Object({
  currNode: SetNodeSchema,
  committed: Data.Integer(),
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

export const RewardFoldDatumSchema = Data.Object({
  currNode: SetNodeSchema,
  totalProjectTokens: Data.Integer(),
  totalCommitted: Data.Integer(),
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
  Data.Literal("RewardsFoldNode"),
  Data.Literal("RewardsReclaim"),
]);
export type RewardFoldAct = Data.Static<typeof RewardFoldActSchema>;
export const RewardFoldAct = RewardFoldActSchema as unknown as RewardFoldAct;

export const LiquiditySetNodeSchema = Data.Object({
  key: NodeKeySchema,
  next: NodeKeySchema,
  commitment: Data.Integer(),
});
export type LiquiditySetNode = Data.Static<typeof LiquiditySetNodeSchema>;
export const LiquiditySetNode = LiquiditySetNodeSchema as unknown as LiquiditySetNode;

export const LiquidityNodeActionSchema = Data.Enum([
  Data.Literal("PLInit"),
  Data.Literal("PLDInit"),
  Data.Object({
    PInsert: Data.Object({
      keyToInsert: PubKeyHashSchema,
      coveringNode: LiquiditySetNodeSchema,
    }),
  }),
  Data.Object({
    PRemove: Data.Object({
      keyToRemove: PubKeyHashSchema,
      coveringNode: LiquiditySetNodeSchema,
    }),
  }),
]);
export type LiquidityNodeAction = Data.Static<typeof LiquidityNodeActionSchema>;
export const LiquidityNodeAction = LiquidityNodeActionSchema as unknown as LiquidityNodeAction;  

export const StakingCredentialSchema =
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
  ])


export const LiquidityValidatorConfigSchema = Data.Object({
  stakingDeadLine: Data.Integer(),
  penaltyAddress: AddressSchema,
  commitCredential: StakingCredentialSchema,
  rewardCredential: StakingCredentialSchema,
});
export type LiquidityValidatorConfig = Data.Static<typeof LiquidityValidatorConfigSchema>;
export const LBELockConfig =
LiquidityValidatorConfigSchema as unknown as LiquidityValidatorConfig;

export const LiquidityPolicyConfigSchema = Data.Object({
  initUTXO: OutputReferenceSchema,
  stakingDeadLine: Data.Integer(),
  penaltyAddress: AddressSchema,
});
export type LiquidityPolicyConfig = Data.Static<typeof LiquidityPolicyConfigSchema>;
export const LiquidityPolicyConfig =
LiquidityPolicyConfigSchema as unknown as LiquidityPolicyConfig;