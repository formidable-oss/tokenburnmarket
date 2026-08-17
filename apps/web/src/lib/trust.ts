/*
  Trust Level for a Builder, as shown next to a name in a member list.

  Placeholder until Usage and Receipt Streams land: nothing has been synced yet, so
  every Builder reads as Reported. Later tickets replace the body of this function
  with the real rollup and every caller inherits it.
*/
export type BuilderTrustLevel = "verified" | "reported";

export function builderTrustLevel(builder: { id: string }): BuilderTrustLevel {
  // The argument is already part of the contract so call sites survive the swap.
  void builder;
  return "reported";
}
