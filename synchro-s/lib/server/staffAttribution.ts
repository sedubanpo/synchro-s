export type StaffAttribution = {
  uid: string | null;
  name: string | null;
  position: string | null;
  iconUrl: string | null;
};

export function getStaffAttribution(
  user: { id?: string | null } | null,
  profile: {
    full_name?: string | null;
    firebase_uid?: string | null;
    staff_position?: string | null;
    actor_icon_url?: string | null;
  } | null
): StaffAttribution {
  const rawUserId = profile?.firebase_uid?.trim() || user?.id?.trim() || "";
  return {
    uid: rawUserId && !rawUserId.startsWith("sheet:") ? rawUserId : null,
    name: profile?.full_name?.trim() || null,
    position: profile?.staff_position?.trim() || null,
    iconUrl: profile?.actor_icon_url?.trim() || null
  };
}
