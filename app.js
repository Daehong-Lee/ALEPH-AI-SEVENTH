/* 플랜두씨 다이어리 2
 * 계획 안에서 할 일을 만들고, 완료 버튼이 실행 기록을 자동 생성합니다.
 * Supabase Auth + RLS. service_role/secret key는 브라우저에 넣지 않습니다.
 */
const SUPABASE_URL = "https://zmflojkomojuzhuhrdrr.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_kCpd_cxjudgfgPaHlmwaEA_DsYECMrw";
const configured = !SUPABASE_URL.includes("YOUR_PROJECT") && !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");
const { createClient } = window.supabase;
const sb = createClient(configured ? SUPABASE_URL : "https://placeholder.invalid", configured ? SUPABASE_ANON_KEY : "placeholder");
const state = { plans: [], planVersions: [], tasks: [], completions: [], logs: [], planCompletions: [], user: null };
const $ = id => document.getElementById(id);
const esc = v => String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const fmtDate = v => v ? new Date(v + (String(v).length===10 ? "T00:00:00+09:00" : "")).toLocaleDateString("ko-KR") : "-";
const fmtDateTime = v => v ? new Date(v).toLocaleString("ko-KR",{hour12:false}) : "-";
const kstDate = v => new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul"}).format(v ? new Date(v) : new Date());
const priorityText = { high:"높음", medium:"보통", low:"낮음" };
const priorityRank = { high:3, medium:2, low:1 };
function toast(m){$("toast").textContent=m;$("toast").classList.add("show");clearTimeout(window.__toastTimer);window.__toastTimer=setTimeout(()=>$("toast").classList.remove("show"),2600)}
function showError(e){console.error(e);toast(e?.message||"요청 처리 중 오류가 발생했습니다.")}
function setConnection(ok){$("connectionDot").className="dot "+(ok?"online":"offline");$("connectionText").textContent=ok?"Supabase 연결됨":"연결 안 됨"}
function setAuthView(on){$("authPanel").classList.toggle("hidden",on);$("appShell").classList.toggle("hidden",!on);$("publicNotice").classList.toggle("hidden",on);$("userEmail").textContent=state.user?.email||"";$("accountEmail").textContent=state.user?.email||"";$("signOutBtn").classList.toggle("hidden",!on)}

async function loadAll(){
  if(!configured){$("setupPanel").classList.remove("hidden");setConnection(false);setAuthView(false);return}
  const {data:{user}}=await sb.auth.getUser();state.user=user||null;
  if(!state.user){setConnection(true);setAuthView(false);return}
  setAuthView(true);
  const rs=await Promise.all([
    sb.from("d2_plans").select("*").order("created_at"),
    sb.from("d2_plan_versions").select("*").order("created_at",{ascending:false}),
    sb.from("d2_tasks").select("*").order("created_at"),
    sb.from("d2_task_completions").select("*").order("completed_at",{ascending:false}),
    sb.from("d2_execution_logs").select("*").order("completed_at",{ascending:false}),
    sb.from("d2_plan_completions").select("*").order("completed_at",{ascending:false})
  ]);
  for(const r of rs) if(r.error) throw r.error;
  [state.plans,state.planVersions,state.tasks,state.completions,state.logs,state.planCompletions]=rs.map(r=>r.data||[]);
  setConnection(true);renderAll();
}
function renderAll(){renderPlans();renderCompleted();renderLogs();renderDashboard()}
function completedPlanIds(){return new Set(state.planCompletions.map(c=>c.plan_id))}

function activeTasksForPlan(planId){return state.tasks.filter(t=>t.plan_id===planId&&!t.deleted_at)}
function completedTaskIds(){return new Set(state.completions.map(c=>c.task_id))}
function renderPlans(){
  const box=$("planList");
  if(!state.plans.length){box.innerHTML='<div class="empty panel">아직 계획이 없습니다. 새 계획을 만들어 시작하세요.</div>';return}
  const done=completedTaskIds(),donePlans=completedPlanIds(); box.innerHTML="";
  state.plans.filter(p=>!donePlans.has(p.id)).forEach(p=>{
    const pending=activeTasksForPlan(p.id).filter(t=>!done.has(t.id));
    const taskRows=pending.length?pending.map(t=>`<div class="plan-task-row"><div><strong>${esc(t.title)}</strong><div class="muted">${t.due_date?`마감 ${fmtDate(t.due_date)} · `:""}${priorityText[t.priority]} · 예상 ${t.expected_minutes||0}분${t.tags?.length?` · 태그: ${esc(t.tags.join(", ") )}`:""}</div></div><div class="card-actions"><button class="done" data-complete="${t.id}">완료</button><button data-edit-task="${t.id}">수정</button></div></div>`).join(""):'<p class="muted">진행 중인 할 일이 없습니다.</p>';
    const el=document.createElement("article");el.className="plan-card";
    el.innerHTML=`<div class="card-top"><div><span class="eyebrow">PLAN</span><h3>${esc(p.title)}</h3></div><span class="badge">${priorityText[p.priority]||p.priority}</span></div><p>${fmtDate(p.start_date)} ~ ${fmtDate(p.end_date)} · 계획 예상 ${p.expected_minutes||0}분</p><p><strong>성공 기준:</strong> ${esc(p.success_criteria)}</p><div class="plan-task-section"><div class="panel-heading"><h4>진행 중 · ${pending.length}</h4></div>${taskRows}</div><div class="card-actions"><button class="done" data-complete-plan="${p.id}">계획 완료</button><button data-edit-plan="${p.id}">계획 수정</button><button data-history-plan="${p.id}">수정 이력</button></div>`;
    box.appendChild(el);
  });
  box.querySelectorAll("[data-complete]").forEach(b=>b.onclick=()=>completeTask(b.dataset.complete));
  box.querySelectorAll("[data-complete-plan]").forEach(b=>b.onclick=()=>completePlan(b.dataset.completePlan));
  box.querySelectorAll("[data-edit-plan]").forEach(b=>b.onclick=()=>openPlan(b.dataset.editPlan));
  box.querySelectorAll("[data-history-plan]").forEach(b=>b.onclick=()=>showPlanHistory(b.dataset.historyPlan));
  box.querySelectorAll("[data-edit-task]").forEach(b=>b.onclick=()=>editTaskInline(b.dataset.editTask));
}
function renderCompleted(){
  const taskRows=state.logs.map(l=>({kind:"task",at:l.completed_at,log:l,task:state.tasks.find(t=>t.id===l.task_id),plan:state.plans.find(p=>p.id===state.tasks.find(t=>t.id===l.task_id)?.plan_id)}));
  const planRows=state.planCompletions.map(c=>({kind:"plan",at:c.completed_at,completion:c,plan:state.plans.find(p=>p.id===c.plan_id)}));
  const rows=[...planRows,...taskRows].sort((a,b)=>new Date(b.at)-new Date(a.at));
  const box=$("completedList");
  if(!rows.length){box.innerHTML='<div class="empty panel">아직 완료된 항목이 없습니다.</div>';return}
  box.innerHTML="";
  rows.forEach((row,i)=>{
    const el=document.createElement("article");el.className="panel completed-item";
    if(row.kind==="plan"){
      const p=row.plan, children=state.tasks.filter(t=>t.plan_id===p?.id&&!t.deleted_at);
      const childHtml=children.length?children.map(t=>`<li>${esc(t.title)}${t.tags?.length?` <span class="muted">· 태그: ${esc(t.tags.join(", "))}</span>`:""}</li>`).join(""):'<li>하위 할 일이 없습니다.</li>';
      el.innerHTML=`<div class="panel-heading"><div><span class="eyebrow">계획 완료 ${rows.length-i}</span><h3>${esc(p?.title||"삭제된 계획")}</h3></div><span class="badge">${fmtDateTime(row.at)}</span></div><p class="muted">하위 할 일</p><ul class="completed-plan-tasks">${childHtml}</ul>`;
    }else{
      const t=row.task,p=row.plan;
      el.innerHTML=`<div class="panel-heading"><div><span class="eyebrow">할 일 완료 ${rows.length-i}</span><h3>${esc(t?.title||"삭제된 항목")}</h3></div><span class="badge">${fmtDateTime(row.at)}</span></div><p class="muted">계획: ${esc(p?.title||"-")} · 예상 ${t?.expected_minutes||0}분${t?.due_date?` · 마감 ${fmtDate(t.due_date)}`:""}</p>${t?.tags?.length?`<p><strong>태그:</strong> ${esc(t.tags.join(", "))}</p>`:""}`;
    }
    box.appendChild(el);
  });
}
function renderLogs(){
  const box=$("logList"); if(!state.logs.length){box.innerHTML='<div class="empty panel">아직 실행 기록이 없습니다. 계획의 항목을 완료하면 여기에 자동으로 기록됩니다.</div>';return}
  const groups={};
  state.logs.forEach(l=>{const day=l.completed_date||kstDate(l.completed_at);(groups[day]??=[]).push(l)});
  box.innerHTML="";
  Object.keys(groups).sort((a,b)=>b.localeCompare(a)).forEach(day=>{
    const section=document.createElement("section");section.className="panel";
    section.innerHTML=`<div class="panel-heading"><h3>${fmtDate(day)}</h3><span class="muted">${groups[day].length}건</span></div>`;
    groups[day].forEach(l=>{const t=state.tasks.find(x=>x.id===l.task_id),p=state.plans.find(x=>x.id===t?.plan_id),row=document.createElement("div");row.className="history-row";row.innerHTML=`<strong>${esc(t?.title||"삭제된 항목")}</strong><p class="muted">계획: ${esc(p?.title||"-")} · 완료 ${fmtDateTime(l.completed_at)} · 예상 ${t?.expected_minutes||0}분${t?.tags?.length?` · 태그: ${esc(t.tags.join(", "))}`:""}</p>`;section.appendChild(row)});
    box.appendChild(section);
  });
}
function dateCutoff(days){if(days==="all")return null;const d=new Date();d.setDate(d.getDate()-Number(days));return d}
function reviewData(){const cutoff=dateCutoff($("reviewPeriod").value),done=completedTaskIds(),tasks=state.tasks.filter(t=>!t.deleted_at&&(!cutoff||new Date(t.created_at)>=cutoff)),delayed=tasks.filter(t=>!done.has(t.id)&&t.due_date&&t.due_date<kstDate()),expected=tasks.reduce((s,t)=>s+Number(t.expected_minutes||0),0),completedExpected=state.logs.filter(l=>tasks.some(t=>t.id===l.task_id)).reduce((s,l)=>s+Number(state.tasks.find(t=>t.id===l.task_id)?.expected_minutes||0),0);return{tasks,done,delayed,expected,completedExpected}}
function statButton(label,num,key){const b=document.createElement("button");b.className="stat";b.dataset.stat=key;b.innerHTML=`<span class="num">${num}</span><span class="label">${label}</span>`;return b}
function renderDashboard(){
  const d=reviewData(),box=$("stats");box.innerHTML="";[["할 일 수",d.tasks.length,"all"],["완료 수",d.tasks.filter(t=>d.done.has(t.id)).length,"done"],["지연 수",d.delayed.length,"delayed"],["예상(분)",d.expected,"time"]].forEach(x=>box.appendChild(statButton(...x)));box.querySelectorAll(".stat").forEach(b=>b.onclick=()=>showEvidence(b.dataset.stat));
  $("timeSummary").textContent=`계획에 적은 예상 시간 ${d.expected}분 · 완료된 항목의 예상 시간 ${d.completedExpected}분 · 미완료 예상 ${d.expected-d.completedExpected}분`;

  showEvidence("all",false)
}
function showEvidence(kind,scroll=true){const d=reviewData();let rows=d.tasks;if(kind==="done")rows=rows.filter(t=>d.done.has(t.id));if(kind==="delayed")rows=d.delayed;$("evidenceList").innerHTML="";if(!rows.length){$("evidenceList").innerHTML='<div class="empty">근거 기록이 없습니다.</div>';return}rows.forEach(t=>{const div=document.createElement("div");div.className="evidence-row";div.innerHTML=`<strong>${esc(t.title)}</strong><span class="muted"> · ${d.done.has(t.id)?"완료":"진행 중"} · 계획 ${esc(state.plans.find(p=>p.id===t.plan_id)?.title||"-")} · 예상 ${t.expected_minutes||0}분</span>`;$("evidenceList").appendChild(div)});if(scroll)$("evidenceList").scrollIntoView({behavior:"smooth",block:"start"})}

function taskDraftFromForm(row){return{title:row.querySelector("[data-field=title]").value.trim(),due_date:row.querySelector("[data-field=due]").value||null,priority:row.querySelector("[data-field=priority]").value,tags:row.querySelector("[data-field=tags]").value.split(",").map(x=>x.trim()).filter(Boolean),expected_minutes:Number(row.querySelector("[data-field=minutes]").value||0)}}
function taskEditorRow(t={}){const row=document.createElement("div");row.className="plan-task-editor-row";row.dataset.taskId=t.id||"";row.innerHTML=`<div class="two-col"><label>할 일<input data-field="title" value="${esc(t.title||"")}" maxlength="160" required></label><label>마감일<input data-field="due" type="date" value="${t.due_date||""}"></label></div><div class="two-col"><label>우선순위<select data-field="priority"><option value="high" ${t.priority==="high"?"selected":""}>높음</option><option value="medium" ${!t.priority||t.priority==="medium"?"selected":""}>보통</option><option value="low" ${t.priority==="low"?"selected":""}>낮음</option></select></label><label>예상 시간(분)<input data-field="minutes" type="number" min="0" value="${t.expected_minutes??0}"></label></div><label>태그<input data-field="tags" value="${esc((t.tags||[]).join(", "))}" placeholder="예: 집중, 자료조사"></label><div class="card-actions"><button type="button" class="danger-btn" data-remove-task>항목 제거</button></div>`;row.querySelector("[data-remove-task]").onclick=()=>row.remove();return row}
function resetPlanTaskEditors(tasks=[]){const box=$("planTaskEditorList");box.innerHTML="";tasks.forEach(t=>box.appendChild(taskEditorRow(t)))}
function openPlan(id){const p=state.plans.find(x=>x.id===id);if(p&&completedPlanIds().has(p.id)){toast("완료된 계획은 수정할 수 없습니다.");return}$("planId").value=p?.id||"";$("planFormTitle").textContent=p?"계획 수정":"새 계획";$("planTitle").value=p?.title||"";$("planStart").value=p?.start_date||"";$("planEnd").value=p?.end_date||"";$("planPriority").value=p?.priority||"medium";$("planSuccess").value=p?.success_criteria||"";$("planMinutes").value=p?.expected_minutes??0;resetPlanTaskEditors(p?activeTasksForPlan(p.id).filter(t=>!completedTaskIds().has(t.id)):[]);$("planEditor").classList.remove("hidden")}
async function savePlan(e){
  e.preventDefault();const id=$("planId").value,payload={user_id:state.user.id,title:$("planTitle").value.trim(),start_date:$("planStart").value,end_date:$("planEnd").value,priority:$("planPriority").value,success_criteria:$("planSuccess").value.trim(),expected_minutes:Number($("planMinutes").value||0)};
  if(!payload.title||!payload.success_criteria||!payload.start_date||!payload.end_date){toast("계획 필수값을 입력하세요.");return}
  try{
    let planId=id;
    if(id){const r=await sb.from("d2_plans").update(payload).eq("id",id);if(r.error)throw r.error}
    else {const r=await sb.from("d2_plans").insert(payload).select("id").single();if(r.error)throw r.error;planId=r.data.id}
    const rows=[...$("planTaskEditorList").children];
    const existing=new Set(state.tasks.filter(t=>t.plan_id===planId).map(t=>t.id));
    for(const row of rows){const d=taskDraftFromForm(row);if(!d.title)throw new Error("할 일 이름을 입력하세요.");const taskId=row.dataset.taskId;if(taskId){const r=await sb.from("d2_tasks").update({...d,user_id:state.user.id,plan_id:planId}).eq("id",taskId);if(r.error)throw r.error;existing.delete(taskId)}else{const r=await sb.from("d2_tasks").insert({...d,user_id:state.user.id,plan_id:planId});if(r.error)throw r.error}}
    for(const removedId of existing){const t=state.tasks.find(x=>x.id===removedId);if(t&&!completedTaskIds().has(removedId)){const r=await sb.from("d2_tasks").update({deleted_at:new Date().toISOString()}).eq("id",removedId);if(r.error)throw r.error}}
    closeModal("planEditor");await loadAll();toast(id?"계획을 수정했습니다.":"계획과 하위 할 일을 저장했습니다.")
  }catch(err){showError(err)}
}
function showPlanHistory(id){const rows=state.planVersions.filter(x=>x.plan_id===id),box=$("planHistory");box.classList.remove("hidden");box.innerHTML=`<div class="panel-heading"><h3>계획 수정 이력</h3><button class="secondary" id="closeHistory">닫기</button></div>`;if(!rows.length){box.innerHTML+='<p class="empty">수정 이력이 없습니다.</p>';return}rows.forEach(v=>{const d=document.createElement("div");d.className="history-row";d.innerHTML=`<strong>${fmtDateTime(v.created_at)}</strong><p>${esc(v.title)} · ${fmtDate(v.start_date)} ~ ${fmtDate(v.end_date)} · ${priorityText[v.priority]} · ${v.expected_minutes}분</p><p>${esc(v.success_criteria)}</p>`;box.appendChild(d)});$("closeHistory").onclick=()=>box.classList.add("hidden")}
function editTaskInline(id){const t=state.tasks.find(x=>x.id===id);if(!t)return;openPlan(t.plan_id);setTimeout(()=>{const row=[...$("planTaskEditorList").children].find(x=>x.dataset.taskId===id);if(row)row.scrollIntoView({behavior:"smooth",block:"center"})},0)}

async function completePlan(id){try{const r=await sb.rpc("d2_complete_plan_once",{p_plan_id:id});if(r.error)throw r.error;await loadAll();toast("계획을 완료로 옮겼습니다.")}catch(e){showError(e)}}
async function completeTask(id){try{const r=await sb.rpc("d2_complete_task_once",{p_task_id:id});if(r.error)throw r.error;await loadAll();toast("완료했습니다. 실행 기록에 오늘 날짜로 자동 편입했습니다.")}catch(e){showError(e)}}
async function undoTask(id){try{const r=await sb.rpc("d2_undo_task_completion",{p_task_id:id});if(r.error)throw r.error;await loadAll();toast("완료를 취소했습니다. 실행 기록에서도 제거됩니다.")}catch(e){showError(e)}}

async function saveReviewNote(){
  const targetId=$("reviewTargetPlan").value;
  const note=$("reviewNoteText").value.trim();
  if(!targetId){toast("넘길 기존 계획을 선택하세요.");return}
  if(!note){toast("돌아본 내용을 한 줄 입력하세요.");return}
  if(!state.plans.some(p=>p.id===targetId)){toast("존재하는 계획만 선택할 수 있습니다.");return}
  try{const r=await sb.from("d2_review_notes").insert({user_id:state.user.id,target_plan_id:targetId,note});if(r.error)throw r.error;await loadAll();toast("선택한 기존 계획으로 돌아보기 내용을 연결했습니다.")}catch(e){showError(e)}
}

async function exportAll(){const payload={exported_at:new Date().toISOString(),schema:"pds-schema-v2-auth-d2-plan-task-v2",account:{id:state.user?.id,email:state.user?.email},plans:state.plans,plan_versions:state.planVersions,tasks:state.tasks,task_completions:state.completions,execution_logs:state.logs};const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`plan-do-see-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href)}
async function deleteAccount(){const word=prompt("계정을 삭제하면 이 계정의 다이어리 자료도 함께 삭제됩니다. 계속하려면 DELETE를 입력하세요.");if(word!=="DELETE")return;try{const r=await sb.rpc("d2_delete_my_account");if(r.error)throw r.error;await sb.auth.signOut().catch(()=>{});state.user=null;state.plans=[];state.planVersions=[];state.tasks=[];state.completions=[];state.logs=[];state.planCompletions=[];setAuthView(false);toast("계정과 자료를 삭제했습니다.")}catch(e){showError(e)}}
async function signUp(){const email=$("authEmail").value.trim(),password=$("authPassword").value;if(!email||!password){toast("이메일과 비밀번호를 입력하세요.");return}try{const {data,error}=await sb.auth.signUp({email,password});if(error)throw error;if(data.session){await loadAll();toast("가입과 로그인이 완료되었습니다.")}else toast("가입되었습니다. 이메일 확인이 켜져 있다면 확인 링크를 눌러 주세요.")}catch(e){showError(e)}}
async function signIn(){const email=$("authEmail").value.trim(),password=$("authPassword").value;if(!email||!password){toast("이메일과 비밀번호를 입력하세요.");return}try{const {error}=await sb.auth.signInWithPassword({email,password});if(error)throw error;await loadAll();toast("로그인했습니다.")}catch(e){toast("이메일 또는 비밀번호가 올바르지 않습니다.")}}
async function signOut(){try{const {error}=await sb.auth.signOut();if(error)throw error;state.user=null;state.plans=[];state.planVersions=[];state.tasks=[];state.completions=[];state.logs=[];state.planCompletions=[];setAuthView(false);toast("로그아웃했습니다.")}catch(e){showError(e)}}
function closeModal(id){$(id).classList.add("hidden")}

document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));b.classList.add("active");$(b.dataset.tab).classList.add("active")});
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
$("newPlanBtn").onclick=()=>openPlan(null);$("planForm").onsubmit=savePlan;$("addPlanTaskBtn").onclick=()=>$("planTaskEditorList").appendChild(taskEditorRow());$("exportBtn").onclick=exportAll;$("deleteAccountBtn").onclick=deleteAccount;$("signUpBtn").onclick=signUp;$("signInBtn").onclick=signIn;$("signOutBtn").onclick=signOut;$("reviewPeriod").onchange=renderDashboard;
sb.auth.onAuthStateChange((_event,session)=>{state.user=session?.user||null;loadAll().catch(showError)});
loadAll().catch(showError);
