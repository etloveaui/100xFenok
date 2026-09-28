export type WindDownStorageScope = {
  workspace: "learner" | "qa";
  objectName: string;
  profileMirrorKey: string;
  allowLegacySeed: boolean;
};

/** Deployment configuration only; never select a learner from request input. */
export function resolveWindDownStorageScope(value: unknown): WindDownStorageScope {
  if (value === undefined || value === "learner") {
    return {
      workspace: "learner",
      objectName: "mona-vnext-learning-profile-v1",
      profileMirrorKey: "data/mona-vnext/owner-test/learning-profile.json",
      allowLegacySeed: true,
    };
  }
  if (value === "qa") {
    return {
      workspace: "qa",
      objectName: "winddown-qa-learning-profile-v1",
      profileMirrorKey: "data/mona-vnext/qa/learning-profile.json",
      allowLegacySeed: false,
    };
  }
  throw new Error("WINDDOWN_STORAGE_SCOPE_INVALID");
}
