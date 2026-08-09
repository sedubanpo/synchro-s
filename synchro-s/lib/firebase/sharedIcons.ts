import { getSynchroFirestore } from "@/lib/firebase/client";
import { buildSchoolIconRegistry, type SharedIconAsset } from "@/lib/sharedIcons";
import { collection, getDocs } from "firebase/firestore";

let cachedSchoolIcons: Map<string, string> | null = null;
let pendingSchoolIcons: Promise<Map<string, string>> | null = null;

export async function loadSchoolIconRegistry(forceRefresh = false): Promise<Map<string, string>> {
  if (!forceRefresh && cachedSchoolIcons) return cachedSchoolIcons;
  if (!forceRefresh && pendingSchoolIcons) return pendingSchoolIcons;

  pendingSchoolIcons = getDocs(collection(getSynchroFirestore(), "sharedIconAssets"))
    .then((snapshot) => {
      const assets = snapshot.docs.map((document) => document.data() as SharedIconAsset);
      cachedSchoolIcons = buildSchoolIconRegistry(assets);
      return cachedSchoolIcons;
    })
    .finally(() => {
      pendingSchoolIcons = null;
    });

  return pendingSchoolIcons;
}
