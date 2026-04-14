const TOKEN_KEY="competence_hub_token";
const roles={expert:"Эксперт",teacher:"Преподаватель",student:"Студент"};
const competencyLabels={know:"Знать",can:"Уметь",master:"Владеть"};
const assessmentLabels={question_answer:"Вопрос-ответ",test:"Тест"};

const state={
  token:localStorage.getItem(TOKEN_KEY),
  user:null,
  authMode:"login",
  activePage:"workspace",
  disciplines:[],
  expert:{currentDiscipline:null,themes:[],currentTheme:null,elements:[]},
  teacher:{currentDiscipline:null,themes:[],selectedThemeIds:[]},
};

const elements={
  loginView:document.getElementById("login-view"),
  registerView:document.getElementById("register-view"),
  appView:document.getElementById("app-view"),
  loginForm:document.getElementById("login-form"),
  registerForm:document.getElementById("register-form"),
  registerBackButton:document.getElementById("register-back-button"),
  showLoginTab:document.getElementById("show-login-tab"),
  showRegisterTab:document.getElementById("show-register-tab"),
  profileButton:document.getElementById("profile-button"),
  logoutButton:document.getElementById("logout-button"),
  sessionPanel:document.getElementById("session-panel"),
  sessionName:document.getElementById("session-name"),
  sessionRole:document.getElementById("session-role"),
  flash:document.getElementById("flash"),
  registerUsernameStatus:document.getElementById("register-username-status"),
  profileUsernameStatus:document.getElementById("profile-username-status"),
  profileView:document.getElementById("profile-view"),
  profileForm:document.getElementById("profile-form"),
  profileBackButton:document.getElementById("profile-back-button"),
  profileRoleBadge:document.getElementById("profile-role-badge"),
  expertView:document.getElementById("expert-view"),
  teacherView:document.getElementById("teacher-view"),
  studentView:document.getElementById("student-view"),
  expertDisciplinesScreen:document.getElementById("expert-screen-disciplines"),
  expertDisciplineScreen:document.getElementById("expert-screen-discipline"),
  expertThemeScreen:document.getElementById("expert-screen-theme"),
  expertOpenDisciplineCreate:document.getElementById("expert-open-discipline-create"),
  expertCloseDisciplineCreate:document.getElementById("expert-close-discipline-create"),
  expertDisciplineCreatePanel:document.getElementById("expert-discipline-create-panel"),
  expertOpenThemeCreate:document.getElementById("expert-open-theme-create"),
  expertCloseThemeCreate:document.getElementById("expert-close-theme-create"),
  expertThemeCreatePanel:document.getElementById("expert-theme-create-panel"),
  expertOpenElementCreate:document.getElementById("expert-open-element-create"),
  expertCloseElementCreate:document.getElementById("expert-close-element-create"),
  expertElementCreatePanel:document.getElementById("expert-element-create-panel"),
  expertDisciplineForm:document.getElementById("expert-discipline-form"),
  expertThemeForm:document.getElementById("expert-theme-form"),
  expertElementForm:document.getElementById("expert-element-form"),
  expertElementType:document.getElementById("expert-element-type"),
  expertAssessmentWrap:document.getElementById("expert-assessment-format-wrap"),
  expertParentLabel:document.getElementById("expert-parent-label"),
  expertParentSelect:document.getElementById("expert-parent-select"),
  expertRefreshDisciplines:document.getElementById("expert-refresh-disciplines"),
  expertBackToDisciplines:document.getElementById("expert-back-to-disciplines"),
  expertBackToDiscipline:document.getElementById("expert-back-to-discipline"),
  expertDisciplinesList:document.getElementById("expert-disciplines-list"),
  expertDisciplinesEmpty:document.getElementById("expert-disciplines-empty"),
  expertDisciplineCount:document.getElementById("expert-discipline-count"),
  expertDisciplineTitle:document.getElementById("expert-discipline-title"),
  expertDisciplineDescription:document.getElementById("expert-discipline-description"),
  expertThemesList:document.getElementById("expert-themes-list"),
  expertThemesEmpty:document.getElementById("expert-themes-empty"),
  expertThemeCount:document.getElementById("expert-theme-count"),
  expertThemeTitle:document.getElementById("expert-theme-title"),
  expertThemeDescription:document.getElementById("expert-theme-description"),
  expertThemeRequired:document.getElementById("expert-theme-required"),
  expertElementsList:document.getElementById("expert-elements-list"),
  expertElementsEmpty:document.getElementById("expert-elements-empty"),
  expertElementCount:document.getElementById("expert-element-count"),
  expertTreeRoot:document.getElementById("expert-tree-root"),
  teacherDisciplinesScreen:document.getElementById("teacher-screen-disciplines"),
  teacherSelectionScreen:document.getElementById("teacher-screen-selection"),
  teacherRefreshDisciplines:document.getElementById("teacher-refresh-disciplines"),
  teacherBackToDisciplines:document.getElementById("teacher-back-to-disciplines"),
  teacherSaveSelection:document.getElementById("teacher-save-selection"),
  teacherDisciplinesList:document.getElementById("teacher-disciplines-list"),
  teacherDisciplinesEmpty:document.getElementById("teacher-disciplines-empty"),
  teacherDisciplineCount:document.getElementById("teacher-discipline-count"),
  teacherDisciplineTitle:document.getElementById("teacher-discipline-title"),
  teacherDisciplineDescription:document.getElementById("teacher-discipline-description"),
  teacherSelectionCount:document.getElementById("teacher-selection-count"),
  teacherThemesList:document.getElementById("teacher-themes-list"),
  teacherThemesEmpty:document.getElementById("teacher-themes-empty"),
  teacherThemeCount:document.getElementById("teacher-theme-count"),
};

function showFlash(message,type="success"){elements.flash.textContent=message;elements.flash.className=`flash ${type}`;}
function clearFlash(){elements.flash.textContent="";elements.flash.className="flash hidden";}
function escapeHtml(value){return String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
function getAuthHeaders(){return state.token?{Authorization:`Bearer ${state.token}`}:{ }; }
function setFieldHint(node,message,kind=""){
  if(!node){return;}
  if(!message){
    node.textContent="";
    node.className="field-hint hidden";
    return;
  }
  node.textContent=message;
  node.className=`field-hint ${kind}`.trim();
}
function prettifyFieldName(field){
  const mapping={full_name:"ФИО",birth_date:"Дата рождения",role:"Роль пользователя",username:"Логин",password:"Пароль"};
  return mapping[field]||field;
}
function formatApiError(payload){
  if(!payload){return "Ошибка запроса.";}
  if(typeof payload.detail==="string"){return payload.detail;}
  if(Array.isArray(payload.detail)){
    return payload.detail.map((item)=>{
      if(typeof item==="string"){return item;}
      const loc=Array.isArray(item?.loc)?item.loc.filter((part)=>part!=="body"):[];
      const field=loc.length?prettifyFieldName(String(loc[loc.length-1])):"Поле";
      const message=typeof item?.msg==="string"?item.msg:"Некорректное значение.";
      return `${field}: ${message}`;
    }).join("; ");
  }
  if(typeof payload.message==="string"){return payload.message;}
  return "Ошибка запроса.";
}

function clearFormErrors(form){
  form.querySelectorAll(".input-error").forEach((field)=>field.classList.remove("input-error"));
  form.querySelectorAll(".field-error").forEach((node)=>node.remove());
}
function setFieldError(form,fieldName,message){
  const field=form.querySelector(`[name="${fieldName}"]`);
  if(!field){return;}
  field.classList.add("input-error");
  const host=field.closest("label")||field.parentElement;
  const errorNode=document.createElement("div");
  errorNode.className="field-error";
  errorNode.textContent=message;
  host.appendChild(errorNode);
}
function applyFormErrors(form,payload){
  if(!Array.isArray(payload?.detail)){return;}
  const messagesByField=new Map();
  payload.detail.forEach((item)=>{
    const loc=Array.isArray(item?.loc)?item.loc.filter((part)=>part!=="body"):[];
    if(!loc.length){return;}
    const field=String(loc[loc.length-1]);
    const message=typeof item?.msg==="string"?item.msg:"Некорректное значение.";
    if(!messagesByField.has(field)){messagesByField.set(field,[]);}
    messagesByField.get(field).push(message);
  });
  messagesByField.forEach((messages,field)=>setFieldError(form,field,messages.join(". ")));
}

async function apiRequest(path,options={}){
  const headers={...(options.body?{"Content-Type":"application/json"}:{}),...getAuthHeaders(),...(options.headers||{})};
  const response=await fetch(path,{...options,headers});
  if(response.status===401&&state.token){clearSession();renderAppState();throw new Error("Сессия завершилась. Войди в систему заново.");}
  if(!response.ok){
    let message="Ошибка запроса.";
    let payload=null;
    try{payload=await response.json();message=formatApiError(payload);}catch{message=response.statusText||message;}
    const error=new Error(message);
    error.payload=payload;
    error.status=response.status;
    throw error;
  }
  if(response.status===204){return null;}
  return response.json();
}

function setSession(token,user){state.token=token;state.user=user;localStorage.setItem(TOKEN_KEY,token);}
function clearSession(){
  state.token=null;state.user=null;state.disciplines=[];
  state.authMode="login";
  state.activePage="workspace";
  state.expert={currentDiscipline:null,themes:[],currentTheme:null,elements:[]};
  state.teacher={currentDiscipline:null,themes:[],selectedThemeIds:[]};
  localStorage.removeItem(TOKEN_KEY);
}

function switchAuthMode(mode){
  state.authMode=mode==="register"?"register":"login";
  const isLogin=state.authMode==="login";
  elements.loginView.classList.toggle("hidden",!isLogin);
  elements.registerView.classList.toggle("hidden",isLogin);
}

function renderAppState(){
  const isLoggedIn=Boolean(state.user);
  elements.sessionPanel.classList.toggle("hidden",!isLoggedIn);
  elements.appView.classList.toggle("hidden",!isLoggedIn);
  [elements.profileView,elements.expertView,elements.teacherView,elements.studentView].forEach((view)=>view.classList.add("hidden"));
  if(!isLoggedIn){
    elements.appView.classList.add("hidden");
    switchAuthMode(state.authMode);
    return;
  }
  elements.loginView.classList.add("hidden");
  elements.registerView.classList.add("hidden");
  elements.sessionName.textContent=state.user.full_name;
  elements.sessionRole.textContent=roles[state.user.role]||state.user.role;
  if(state.activePage==="profile"){
    elements.profileView.classList.remove("hidden");
    elements.profileRoleBadge.textContent=roles[state.user.role]||state.user.role;
    return;
  }
  if(state.user.role==="expert"){elements.expertView.classList.remove("hidden");}
  else if(state.user.role==="teacher"){elements.teacherView.classList.remove("hidden");}
  else{elements.studentView.classList.remove("hidden");}
}

function populateProfileForm(){
  if(!state.user){return;}
  elements.profileForm.querySelector('[name="full_name"]').value=state.user.full_name||"";
  elements.profileForm.querySelector('[name="birth_date"]').value=state.user.birth_date||"";
  elements.profileForm.querySelector('[name="username"]').value=state.user.username||"";
  elements.profileForm.querySelector('[name="password"]').value="";
  elements.profileRoleBadge.textContent=roles[state.user.role]||state.user.role;
  clearFormErrors(elements.profileForm);
  setFieldHint(elements.profileUsernameStatus,"","available");
}

async function checkUsernameAvailability(username,statusNode,{allowCurrentUsername=false}={}){
  const normalized=String(username||"").trim();
  if(normalized.length<3){
    setFieldHint(statusNode,"Логин должен содержать минимум 3 символа.","unavailable");
    return false;
  }
  if(allowCurrentUsername&&state.user&&normalized===state.user.username){
    setFieldHint(statusNode,"Это ваш текущий логин.","available");
    return true;
  }
  const result=await apiRequest(`/api/auth/username-availability?username=${encodeURIComponent(normalized)}`,{headers:{}});
  if(result.available){
    setFieldHint(statusNode,"Логин свободен.","available");
    return true;
  }
  setFieldHint(statusNode,"Этот логин уже занят.","unavailable");
  return false;
}

function openProfilePage(){
  if(!state.user){return;}
  state.activePage="profile";
  populateProfileForm();
  renderAppState();
}

function closeProfilePage(){
  state.activePage="workspace";
  renderAppState();
}

function showExpertScreen(screenName){
  const screens={disciplines:elements.expertDisciplinesScreen,discipline:elements.expertDisciplineScreen,theme:elements.expertThemeScreen};
  Object.values(screens).forEach((screen)=>screen.classList.add("hidden"));
  screens[screenName].classList.remove("hidden");
}

function showTeacherScreen(screenName){
  const screens={disciplines:elements.teacherDisciplinesScreen,selection:elements.teacherSelectionScreen};
  Object.values(screens).forEach((screen)=>screen.classList.add("hidden"));
  screens[screenName].classList.remove("hidden");
}

function togglePanel(panel,show){panel.classList.toggle("hidden",!show);}
function closeExpertPanels(){
  togglePanel(elements.expertDisciplineCreatePanel,false);
  togglePanel(elements.expertThemeCreatePanel,false);
  togglePanel(elements.expertElementCreatePanel,false);
}

function renderExpertDisciplines(){
  elements.expertDisciplinesList.innerHTML="";
  elements.expertDisciplineCount.textContent=String(state.disciplines.length);
  elements.expertDisciplinesEmpty.classList.toggle("hidden",state.disciplines.length>0);
  state.disciplines.forEach((discipline)=>{
    const article=document.createElement("article");
    article.className="item-card";
    article.innerHTML=`
      <h4>${escapeHtml(discipline.name)}</h4>
      <p>${escapeHtml(discipline.description||"Описание пока не указано.")}</p>
      <div class="item-actions">
        <span class="item-meta">Перейти к темам дисциплины</span>
        <button class="item-button" type="button">Открыть</button>
      </div>
    `;
    article.querySelector("button").addEventListener("click",()=>openExpertDiscipline(discipline.id));
    elements.expertDisciplinesList.appendChild(article);
  });
}

function renderExpertThemes(){
  const discipline=state.expert.currentDiscipline;
  elements.expertDisciplineTitle.textContent=discipline?.name||"Дисциплина";
  elements.expertDisciplineDescription.textContent=discipline?.description||"Описание пока не указано.";
  elements.expertThemesList.innerHTML="";
  elements.expertThemeCount.textContent=String(state.expert.themes.length);
  elements.expertThemesEmpty.classList.toggle("hidden",state.expert.themes.length>0);
  state.expert.themes.forEach((theme)=>{
    const article=document.createElement("article");
    article.className=`item-card ${theme.id===state.expert.currentTheme?.id?"selected":""}`.trim();
    article.innerHTML=`
      <h4>${escapeHtml(theme.title)}</h4>
      <p>${escapeHtml(theme.description||"Описание темы пока не указано.")}</p>
      <div class="item-actions">
        <span class="item-meta">№ ${theme.order_index} · ${theme.is_required?"обязательная":"необязательная"}</span>
        <button class="item-button" type="button">Открыть ЗУВ</button>
      </div>
    `;
    article.querySelector("button").addEventListener("click",()=>openExpertTheme(theme.id));
    elements.expertThemesList.appendChild(article);
  });
}

function createTreeCard(element){
  const article=document.createElement("article");
  article.className=`tree-card ${element.competency_type}`;
  const assessment=element.competency_type==="know"&&element.assessment_format?(assessmentLabels[element.assessment_format]||element.assessment_format):null;
  article.innerHTML=`
    <div class="tree-card-head">
      <h4>${escapeHtml(element.title)}</h4>
      <span class="tree-badge">${competencyLabels[element.competency_type]||element.competency_type}</span>
    </div>
    <p>${escapeHtml(element.description||"Описание элемента пока не указано.")}</p>
    <div class="tree-card-foot">
      <span class="tree-flag ${element.is_required?"":"optional"}">${element.is_required?"обязательный":"необязательный"}</span>
      ${assessment?`<span class="tree-flag">${escapeHtml(assessment)}</span>`:""}
    </div>
  `;
  return article;
}

function buildExpertTreeMaps(){
  const knows=state.expert.elements.filter((item)=>item.competency_type==="know");
  const cans=state.expert.elements.filter((item)=>item.competency_type==="can");
  const masters=state.expert.elements.filter((item)=>item.competency_type==="master");
  const knowById=new Map(knows.map((item)=>[item.id,item]));
  const canById=new Map(cans.map((item)=>[item.id,item]));
  const knowChildren=new Map();
  const canChildren=new Map();
  const masterChildren=new Map();
  for(const know of knows){
    if(know.parent_element_id&&knowById.has(know.parent_element_id)){
      const items=knowChildren.get(know.parent_element_id)||[];
      items.push(know);
      knowChildren.set(know.parent_element_id,items);
    }
  }
  for(const can of cans){
    if(can.parent_element_id&&knowById.has(can.parent_element_id)){
      const items=canChildren.get(can.parent_element_id)||[];
      items.push(can);
      canChildren.set(can.parent_element_id,items);
    }
  }
  for(const master of masters){
    if(master.parent_element_id&&canById.has(master.parent_element_id)){
      const items=masterChildren.get(master.parent_element_id)||[];
      items.push(master);
      masterChildren.set(master.parent_element_id,items);
    }
  }
  const rootKnows=knows.filter((item)=>!item.parent_element_id||!knowById.has(item.parent_element_id));
  const orphanCans=cans.filter((item)=>!item.parent_element_id||!knowById.has(item.parent_element_id));
  const orphanMasters=masters.filter((item)=>!item.parent_element_id||!canById.has(item.parent_element_id));
  return{rootKnows,knowChildren,canChildren,masterChildren,orphanCans,orphanMasters};
}

function buildKnowChains(maps){
  const chains=[];
  for(const root of maps.rootKnows){
    const chain=[root];
    const used=new Set([root.id]);
    let current=root;
    while(true){
      const children=(maps.knowChildren.get(current.id)||[]).filter((item)=>!used.has(item.id));
      if(children.length===0){break;}
      const next=children[0];
      chain.push(next);
      used.add(next.id);
      current=next;
    }
    chains.push(chain);
  }
  return chains;
}

function renderMasterStack(can,maps){
  const wrapper=document.createElement("div");
  wrapper.className="zuv-master-stack";
  wrapper.appendChild(createTreeCard(can));
  const masters=maps.masterChildren.get(can.id)||[];
  masters.forEach((master)=>{
    const link=document.createElement("div");
    link.className="zuv-link";
    wrapper.appendChild(link);
    wrapper.appendChild(createTreeCard(master));
  });
  return wrapper;
}

function renderKnowColumn(know,maps){
  const column=document.createElement("div");
  column.className="zuv-column";
  column.appendChild(createTreeCard(know));
  const cans=maps.canChildren.get(know.id)||[];
  if(cans.length){
    const drop=document.createElement("div");
    drop.className="zuv-drop";
    cans.forEach((can)=>{
      const link=document.createElement("div");
      link.className="zuv-link";
      drop.appendChild(link);
      drop.appendChild(renderMasterStack(can,maps));
    });
    column.appendChild(drop);
  }
  return column;
}

function renderExpertTree(){
  elements.expertTreeRoot.innerHTML="";
  const maps=buildExpertTreeMaps();
  const hasElements=state.expert.elements.length>0;
  elements.expertElementsEmpty.classList.toggle("hidden",hasElements);
  const chains=buildKnowChains(maps);
  chains.forEach((chain)=>{
    const lane=document.createElement("div");
    lane.className="zuv-lane";
    chain.forEach((know,index)=>{
      lane.appendChild(renderKnowColumn(know,maps));
      if(index<chain.length-1){
        const arrow=document.createElement("div");
        arrow.className="zuv-arrow";
        arrow.textContent="→";
        lane.appendChild(arrow);
      }
    });
    elements.expertTreeRoot.appendChild(lane);
  });
  const looseItems=[...maps.orphanCans,...maps.orphanMasters];
  if(looseItems.length){
    const orphanSection=document.createElement("section");
    orphanSection.className="tree-orphans";
    orphanSection.innerHTML="<h4>Элементы без корректной связи</h4>";
    const list=document.createElement("div");
    list.className="item-list";
    looseItems.forEach((item)=>{
      list.appendChild(createTreeCard(item));
    });
    orphanSection.appendChild(list);
    elements.expertTreeRoot.appendChild(orphanSection);
  }
}

function renderExpertElementsList(){
  elements.expertElementsList.innerHTML="";
  elements.expertElementCount.textContent=String(state.expert.elements.length);
  state.expert.elements.forEach((element)=>{
    const article=document.createElement("article");
    article.className="item-card";
    const parentText=element.parent_element_id?`Связан с элементом #${element.parent_element_id}`:"Без родительской связи";
    const assessmentText=element.assessment_format?` · ${assessmentLabels[element.assessment_format]||element.assessment_format}`:"";
    article.innerHTML=`
      <h4>${escapeHtml(element.title)}</h4>
      <p>${escapeHtml(element.description||"Описание элемента пока не указано.")}</p>
      <div class="item-actions">
        <span class="item-meta">${competencyLabels[element.competency_type]} · ${element.is_required?"обязательный":"необязательный"}${assessmentText}</span>
        <span class="item-meta">${parentText}</span>
      </div>
    `;
    elements.expertElementsList.appendChild(article);
  });
}

function renderExpertTheme(){
  const theme=state.expert.currentTheme;
  elements.expertThemeTitle.textContent=theme?.title||"Тема";
  elements.expertThemeDescription.textContent=theme?.description||"Описание темы пока не указано.";
  elements.expertThemeRequired.textContent=theme?.is_required?"Обязательная тема":"Необязательная тема";
  renderExpertElementsList();
  renderExpertTree();
  refreshElementFormOptions();
}

function renderTeacherDisciplines(){
  elements.teacherDisciplinesList.innerHTML="";
  elements.teacherDisciplineCount.textContent=String(state.disciplines.length);
  elements.teacherDisciplinesEmpty.classList.toggle("hidden",state.disciplines.length>0);
  state.disciplines.forEach((discipline)=>{
    const article=document.createElement("article");
    article.className="item-card";
    article.innerHTML=`
      <h4>${escapeHtml(discipline.name)}</h4>
      <p>${escapeHtml(discipline.description||"Описание пока не указано.")}</p>
      <div class="item-actions">
        <span class="item-meta">Открыть и выбрать темы</span>
        <button class="item-button" type="button">Открыть</button>
      </div>
    `;
    article.querySelector("button").addEventListener("click",()=>openTeacherDiscipline(discipline.id));
    elements.teacherDisciplinesList.appendChild(article);
  });
}

function renderTeacherSelection(){
  const discipline=state.teacher.currentDiscipline;
  elements.teacherDisciplineTitle.textContent=discipline?.name||"Дисциплина";
  elements.teacherDisciplineDescription.textContent=discipline?.description||"Описание пока не указано.";
  elements.teacherThemesList.innerHTML="";
  elements.teacherThemeCount.textContent=String(state.teacher.themes.length);
  elements.teacherSelectionCount.textContent=`Выбрано ${state.teacher.selectedThemeIds.length} тем`;
  elements.teacherThemesEmpty.classList.toggle("hidden",state.teacher.themes.length>0);
  state.teacher.themes.forEach((theme)=>{
    const wrapper=document.createElement("label");
    wrapper.className="selection-item";
    wrapper.innerHTML=`
      <input type="checkbox" value="${theme.id}" ${state.teacher.selectedThemeIds.includes(theme.id)?"checked":""}>
      <div>
        <strong>${escapeHtml(theme.title)}</strong>
        <p>${escapeHtml(theme.description||"Описание темы пока не указано.")}</p>
        <span class="item-meta">№ ${theme.order_index} · ${theme.is_required?"обязательная":"необязательная"}</span>
      </div>
    `;
    wrapper.querySelector("input").addEventListener("change",(event)=>{
      const themeId=Number(event.target.value);
      if(event.target.checked){state.teacher.selectedThemeIds=[...new Set([...state.teacher.selectedThemeIds,themeId])];}
      else{state.teacher.selectedThemeIds=state.teacher.selectedThemeIds.filter((id)=>id!==themeId);}
      elements.teacherSelectionCount.textContent=`Выбрано ${state.teacher.selectedThemeIds.length} тем`;
    });
    elements.teacherThemesList.appendChild(wrapper);
  });
}

function refreshElementFormOptions(){
  const type=elements.expertElementType.value;
  const knows=state.expert.elements.filter((item)=>item.competency_type==="know");
  const cans=state.expert.elements.filter((item)=>item.competency_type==="can");
  elements.expertAssessmentWrap.classList.toggle("hidden",type!=="know");
  elements.expertParentSelect.innerHTML="";
  if(type==="know"){
    elements.expertParentLabel.textContent="Связь с другим элементом 'Знать' (необязательно)";
    elements.expertParentSelect.append(new Option("Без связи",""));
    knows.forEach((item)=>elements.expertParentSelect.append(new Option(item.title,String(item.id))));
  }else if(type==="can"){
    elements.expertParentLabel.textContent="Элемент 'Знать', с которым связан этот элемент";
    elements.expertParentSelect.append(new Option("Выбери элемент 'Знать'",""));
    knows.forEach((item)=>elements.expertParentSelect.append(new Option(item.title,String(item.id))));
  }else{
    elements.expertParentLabel.textContent="Элемент 'Уметь', с которым связан этот элемент";
    elements.expertParentSelect.append(new Option("Выбери элемент 'Уметь'",""));
    cans.forEach((item)=>elements.expertParentSelect.append(new Option(item.title,String(item.id))));
  }
}

async function loadDisciplines(){
  state.disciplines=await apiRequest("/api/disciplines");
  renderExpertDisciplines();
  renderTeacherDisciplines();
}

async function openExpertDiscipline(disciplineId){
  closeExpertPanels();
  state.expert.currentDiscipline=state.disciplines.find((item)=>item.id===disciplineId)||null;
  state.expert.currentTheme=null;
  state.expert.elements=[];
  state.expert.themes=await apiRequest(`/api/disciplines/${disciplineId}/themes`);
  renderExpertThemes();
  showExpertScreen("discipline");
}

async function openExpertTheme(themeId){
  closeExpertPanels();
  state.expert.currentTheme=state.expert.themes.find((item)=>item.id===themeId)||null;
  state.expert.elements=await apiRequest(`/api/themes/${themeId}/elements`);
  renderExpertThemes();
  renderExpertTheme();
  showExpertScreen("theme");
}

async function openTeacherDiscipline(disciplineId){
  state.teacher.currentDiscipline=state.disciplines.find((item)=>item.id===disciplineId)||null;
  state.teacher.themes=await apiRequest(`/api/disciplines/${disciplineId}/themes`);
  const selection=await apiRequest(`/api/teacher/disciplines/${disciplineId}/theme-selection`);
  state.teacher.selectedThemeIds=selection.selected_theme_ids;
  renderTeacherSelection();
  showTeacherScreen("selection");
}

async function handleLogin(event){
  event.preventDefault();
  clearFlash();
  const form=event.currentTarget;
  clearFormErrors(form);
  const formData=new FormData(form);
  const payload={username:String(formData.get("username")||"").trim(),password:String(formData.get("password")||"")};
  try{
    const result=await apiRequest("/api/auth/login",{method:"POST",body:JSON.stringify(payload),headers:{}});
    setSession(result.token,result.user);
    state.activePage="workspace";
    renderAppState();
    await loadInitialWorkspace();
    showFlash(`Вход выполнен: ${roles[result.user.role]}.`,"success");
  }catch(error){
    if(error.status===409){setFieldError(form,"username","Этот логин уже занят.");}
    applyFormErrors(form,error.payload);
    showFlash(error.message,"error");
  }
}

async function handleRegister(event){
  event.preventDefault();
  clearFlash();
  const form=event.currentTarget;
  clearFormErrors(form);
  const formData=new FormData(form);
  const payload={
    full_name:String(formData.get("full_name")||"").trim(),
    birth_date:String(formData.get("birth_date")||""),
    role:String(formData.get("role")||"student"),
    username:String(formData.get("username")||"").trim(),
    password:String(formData.get("password")||""),
  };
  try{
    const available=await checkUsernameAvailability(payload.username,elements.registerUsernameStatus);
    if(!available){
      setFieldError(form,"username","Этот логин уже занят.");
      showFlash("Выбери другой логин.","error");
      return;
    }
    const result=await apiRequest("/api/auth/register",{method:"POST",body:JSON.stringify(payload),headers:{}});
    form.reset();
    setFieldHint(elements.registerUsernameStatus,"");
    const loginUsernameInput=elements.loginForm.querySelector('input[name="username"]');
    const loginPasswordInput=elements.loginForm.querySelector('input[name="password"]');
    loginUsernameInput.value=result.username;
    loginPasswordInput.value=result.password;
    switchAuthMode("login");
    renderAppState();
    loginUsernameInput.focus();
    showFlash(`Аккаунт создан. Логин: ${result.username}, пароль: ${result.password}`,"success");
  }catch(error){
    if(error.status===409){setFieldError(form,"username","Этот логин уже занят.");}
    applyFormErrors(form,error.payload);
    showFlash(error.message,"error");
  }
}

async function handleProfileSave(event){
  event.preventDefault();
  clearFlash();
  const form=event.currentTarget;
  clearFormErrors(form);
  const formData=new FormData(form);
  const payload={
    full_name:String(formData.get("full_name")||"").trim(),
    birth_date:String(formData.get("birth_date")||""),
    username:String(formData.get("username")||"").trim(),
    password:String(formData.get("password")||"").trim()||null,
  };
  try{
    const available=await checkUsernameAvailability(payload.username,elements.profileUsernameStatus,{allowCurrentUsername:true});
    if(!available){
      setFieldError(form,"username","Этот логин уже занят.");
      showFlash("Сохрани другой логин.","error");
      return;
    }
    const updatedUser=await apiRequest("/api/auth/profile",{method:"PUT",body:JSON.stringify(payload)});
    state.user=updatedUser;
    populateProfileForm();
    renderAppState();
    showFlash("Профиль сохранён.","success");
  }catch(error){
    if(error.status===409){setFieldError(form,"username","Этот логин уже занят.");}
    applyFormErrors(form,error.payload);
    showFlash(error.message,"error");
  }
}

async function handleLogout(){
  clearFlash();
  try{await apiRequest("/api/auth/logout",{method:"POST"});}catch{}
  clearSession();
  renderAppState();
  closeExpertPanels();
  showExpertScreen("disciplines");
  showTeacherScreen("disciplines");
  showFlash("Выход выполнен.","success");
}

async function loadInitialWorkspace(){
  await loadDisciplines();
  if(state.user.role==="expert"){closeExpertPanels();showExpertScreen("disciplines");}
  else if(state.user.role==="teacher"){showTeacherScreen("disciplines");}
}

async function restoreSession(){
  if(!state.token){return;}
  try{
    state.user=await apiRequest("/api/auth/me");
    renderAppState();
    await loadInitialWorkspace();
  }catch{
    clearSession();
    renderAppState();
  }
}

elements.loginForm.addEventListener("submit",handleLogin);
elements.registerForm.addEventListener("submit",handleRegister);
elements.showRegisterTab.addEventListener("click",(event)=>{
  event.preventDefault();
  clearFlash();
  clearFormErrors(elements.registerForm);
  setFieldHint(elements.registerUsernameStatus,"");
  switchAuthMode("register");
});
elements.registerBackButton.addEventListener("click",(event)=>{
  event.preventDefault();
  clearFlash();
  clearFormErrors(elements.registerForm);
  setFieldHint(elements.registerUsernameStatus,"");
  switchAuthMode("login");
});
elements.profileButton.addEventListener("click",()=>{clearFlash();openProfilePage();});
elements.profileBackButton.addEventListener("click",()=>{clearFlash();closeProfilePage();});
elements.profileForm.addEventListener("submit",handleProfileSave);
elements.registerForm.querySelector('[name="username"]').addEventListener("blur",async(event)=>{
  const username=event.target.value;
  if(!username.trim()){setFieldHint(elements.registerUsernameStatus,"");return;}
  try{await checkUsernameAvailability(username,elements.registerUsernameStatus);}
  catch(error){setFieldHint(elements.registerUsernameStatus,error.message,"unavailable");}
});
elements.profileForm.querySelector('[name="username"]').addEventListener("blur",async(event)=>{
  const username=event.target.value;
  if(!username.trim()){setFieldHint(elements.profileUsernameStatus,"");return;}
  try{await checkUsernameAvailability(username,elements.profileUsernameStatus,{allowCurrentUsername:true});}
  catch(error){setFieldHint(elements.profileUsernameStatus,error.message,"unavailable");}
});
elements.logoutButton.addEventListener("click",handleLogout);
elements.expertOpenDisciplineCreate.addEventListener("click",()=>togglePanel(elements.expertDisciplineCreatePanel,true));
elements.expertCloseDisciplineCreate.addEventListener("click",()=>togglePanel(elements.expertDisciplineCreatePanel,false));
elements.expertOpenThemeCreate.addEventListener("click",()=>togglePanel(elements.expertThemeCreatePanel,true));
elements.expertCloseThemeCreate.addEventListener("click",()=>togglePanel(elements.expertThemeCreatePanel,false));
elements.expertOpenElementCreate.addEventListener("click",()=>{refreshElementFormOptions();togglePanel(elements.expertElementCreatePanel,true);});
elements.expertCloseElementCreate.addEventListener("click",()=>togglePanel(elements.expertElementCreatePanel,false));
elements.expertElementType.addEventListener("change",refreshElementFormOptions);

elements.expertRefreshDisciplines.addEventListener("click",async()=>{
  clearFlash();
  try{await loadDisciplines();showFlash("Список дисциплин обновлён.","success");}
  catch(error){showFlash(error.message,"error");}
});

elements.expertBackToDisciplines.addEventListener("click",()=>{
  closeExpertPanels();
  state.expert.currentTheme=null;
  state.expert.elements=[];
  showExpertScreen("disciplines");
});

elements.expertBackToDiscipline.addEventListener("click",()=>{
  closeExpertPanels();
  state.expert.currentTheme=null;
  state.expert.elements=[];
  renderExpertThemes();
  showExpertScreen("discipline");
});

elements.expertDisciplineForm.addEventListener("submit",async(event)=>{
  event.preventDefault();
  clearFlash();
  const form=event.currentTarget;
  const formData=new FormData(form);
  const payload={name:String(formData.get("name")||"").trim(),description:String(formData.get("description")||"").trim()||null};
  try{
    const created=await apiRequest("/api/disciplines",{method:"POST",body:JSON.stringify(payload)});
    form.reset();
    togglePanel(elements.expertDisciplineCreatePanel,false);
    await loadDisciplines();
    showFlash(`Дисциплина "${created.name}" создана.`,"success");
  }catch(error){showFlash(error.message,"error");}
});

elements.expertThemeForm.addEventListener("submit",async(event)=>{
  event.preventDefault();
  clearFlash();
  if(!state.expert.currentDiscipline){showFlash("Сначала выбери дисциплину.","error");return;}
  const form=event.currentTarget;
  const formData=new FormData(form);
  const payload={
    title:String(formData.get("title")||"").trim(),
    description:String(formData.get("description")||"").trim()||null,
    order_index:Number(formData.get("order_index")||1),
    is_required:formData.get("is_required")==="on",
  };
  try{
    const created=await apiRequest(`/api/disciplines/${state.expert.currentDiscipline.id}/themes`,{method:"POST",body:JSON.stringify(payload)});
    form.reset();
    form.querySelector('input[name="order_index"]').value="1";
    form.querySelector('input[name="is_required"]').checked=true;
    togglePanel(elements.expertThemeCreatePanel,false);
    state.expert.themes=await apiRequest(`/api/disciplines/${state.expert.currentDiscipline.id}/themes`);
    renderExpertThemes();
    showFlash(`Тема "${created.title}" создана.`,"success");
  }catch(error){showFlash(error.message,"error");}
});

elements.expertElementForm.addEventListener("submit",async(event)=>{
  event.preventDefault();
  clearFlash();
  if(!state.expert.currentTheme){showFlash("Сначала открой тему.","error");return;}
  const form=event.currentTarget;
  const formData=new FormData(form);
  const rawParent=String(formData.get("parent_element_id")||"");
  const payload={
    competency_type:String(formData.get("competency_type")||"know"),
    title:String(formData.get("title")||"").trim(),
    description:String(formData.get("description")||"").trim()||null,
    is_required:formData.get("is_required")==="on",
    assessment_format:String(formData.get("assessment_format")||"")||null,
    parent_element_id:rawParent?Number(rawParent):null,
  };
  if(payload.competency_type==="can"&&!payload.parent_element_id){
    showFlash("Для элемента 'Уметь' нужно выбрать связанный элемент 'Знать'.","error");
    return;
  }
  if(payload.competency_type==="master"&&!payload.parent_element_id){
    showFlash("Для элемента 'Владеть' нужно выбрать связанный элемент 'Уметь'.","error");
    return;
  }
  try{
    const created=await apiRequest(`/api/themes/${state.expert.currentTheme.id}/elements`,{method:"POST",body:JSON.stringify(payload)});
    form.reset();
    form.querySelector('input[name="is_required"]').checked=true;
    form.querySelector('select[name="competency_type"]').value="know";
    refreshElementFormOptions();
    togglePanel(elements.expertElementCreatePanel,false);
    state.expert.elements=await apiRequest(`/api/themes/${state.expert.currentTheme.id}/elements`);
    renderExpertTheme();
    showFlash(`Элемент "${created.title}" добавлен в тему.`,"success");
  }catch(error){showFlash(error.message,"error");}
});

elements.teacherRefreshDisciplines.addEventListener("click",async()=>{
  clearFlash();
  try{await loadDisciplines();showFlash("Список дисциплин обновлён.","success");}
  catch(error){showFlash(error.message,"error");}
});

elements.teacherBackToDisciplines.addEventListener("click",()=>showTeacherScreen("disciplines"));

elements.teacherSaveSelection.addEventListener("click",async()=>{
  clearFlash();
  if(!state.teacher.currentDiscipline){showFlash("Сначала открой дисциплину.","error");return;}
  try{
    await apiRequest(`/api/teacher/disciplines/${state.teacher.currentDiscipline.id}/theme-selection`,{
      method:"PUT",
      body:JSON.stringify({selected_theme_ids:state.teacher.selectedThemeIds}),
    });
    showFlash("Выбранные темы сохранены за преподавателем.","success");
  }catch(error){showFlash(error.message,"error");}
});

async function bootstrap(){
  renderAppState();
  await restoreSession();
}

bootstrap();
