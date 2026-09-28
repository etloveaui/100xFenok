import path from "node:path";
import { MONA_VNEXT_DATA_NAMESPACE } from "@/features/mona-vnext/memory/monaVnextNamespace";
import {
  classifyMonaVnextLearningProfile,
  createEmptyMonaVnextLearningProfile,
  normalizeMonaVnextLearningProfile,
  type MonaVnextLearningProfile,
} from "@/features/mona-vnext/memory/fsrsLearningProfile";
import { readMonaVnextLearningProfileThroughCoordinator } from "@/features/mona-vnext/memory/learningProfileCoordinatorClient";
import { createMonaVnextObjectStore } from "@/features/mona-vnext/storage/objectStore";

const MEMORY_DIR = path.join("data", MONA_VNEXT_DATA_NAMESPACE, "owner-test");
const LEARNING_PROFILE_PATH = path.join(MEMORY_DIR, "learning-profile.json");

export async function readMonaVnextLearningProfileState() {
  const store = await createMonaVnextObjectStore();
  let profile: MonaVnextLearningProfile;
  if (store.backend === "cloudflare-kv") {
    profile = await readMonaVnextLearningProfileThroughCoordinator();
  } else {
    const raw = await store.readText(LEARNING_PROFILE_PATH);
    profile = raw
      ? normalizeMonaVnextLearningProfile(JSON.parse(raw))
      : createEmptyMonaVnextLearningProfile();
  }
  return profile;
}

export async function readMonaVnextLearningProfile(now = new Date()) {
  const profile = await readMonaVnextLearningProfileState();
  const selection = classifyMonaVnextLearningProfile(profile, now);
  return {
    updatedAt: profile.updatedAt,
    recordCount: Object.keys(profile.records).length,
    ...selection,
  };
}
