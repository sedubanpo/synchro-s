import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase environment variables are required.");

const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
const targetId = randomUUID();
const actor = {
  uid: "verification-staff",
  name: "공유상태 검증",
  position: "검증",
  iconUrl: null
};

let groupIds = [];
try {
  const rows = ["A", "B"].map((suffix) => ({
    role_view: "instructor",
    target_id: targetId,
    week_start: "2099-01-05",
    name: `공유 활성 검증 ${suffix}`,
    class_ids: [],
    snapshot_events: [],
    is_active: false,
    created_by_uid: actor.uid,
    created_by_name: actor.name,
    created_by_position: actor.position
  }));
  const { data: groups, error: insertError } = await supabase.from("timetable_groups").insert(rows).select("id");
  if (insertError) throw insertError;
  groupIds = (groups ?? []).map((group) => group.id);
  if (groupIds.length !== 2) throw new Error("검증용 시간표 그룹 두 건을 만들지 못했습니다.");

  for (const groupId of groupIds) {
    const { data, error } = await supabase.rpc("set_timetable_group_active_with_actor", {
      p_group_id: groupId,
      p_is_active: true,
      p_actor_uid: actor.uid,
      p_actor_name: actor.name,
      p_actor_position: actor.position,
      p_actor_icon_url: actor.iconUrl
    });
    if (error) throw error;
    if (data !== true) throw new Error("작업자 귀속 활성화 RPC가 true를 반환하지 않았습니다.");
  }

  const [{ data: verifiedGroups, error: groupError }, { data: history, error: historyError }] = await Promise.all([
    supabase.from("timetable_groups").select("id,is_active").in("id", groupIds),
    supabase
      .from("timetable_group_activity_history")
      .select("group_id,action,actor_uid,actor_name")
      .in("group_id", groupIds)
      .order("created_at", { ascending: true })
  ]);
  if (groupError) throw groupError;
  if (historyError) throw historyError;
  const active = (verifiedGroups ?? []).filter((group) => group.is_active === true);
  if (active.length !== 1 || active[0].id !== groupIds[1]) {
    throw new Error("다른 클라이언트가 읽을 서버 상태에 단일 활성 그룹이 유지되지 않았습니다.");
  }
  const actions = (history ?? []).map((item) => item.action);
  if (!actions.includes("activated") || !actions.includes("deactivated")) {
    throw new Error(`활성·비활성 이력이 모두 저장되지 않았습니다: ${actions.join(",")}`);
  }
  if ((history ?? []).some((item) => item.actor_uid !== actor.uid || item.actor_name !== actor.name)) {
    throw new Error("활성 상태 이력의 작업자 귀속 정보가 일치하지 않습니다.");
  }

  const pageSource = await readFile(new URL("../app/synchro-s/page.tsx", import.meta.url), "utf8");
  for (const marker of ["새 시간표 만들기", "StaffAvatar", "상태 이력", "setInterval(refreshSharedState, 15_000)"]) {
    if (!pageSource.includes(marker)) throw new Error(`화면 구현 표식을 찾지 못했습니다: ${marker}`);
  }

  console.log(JSON.stringify({
    ok: true,
    singleActiveGroup: active[0].id,
    activityActions: actions,
    actorName: actor.name,
    uiMarkersVerified: true
  }, null, 2));
} finally {
  if (groupIds.length > 0) {
    await supabase.from("timetable_groups").delete().in("id", groupIds);
  }
}
