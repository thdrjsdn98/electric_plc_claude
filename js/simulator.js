// ============================================================
// PLC 명령어(IL) 인터프리터 — 실제 XG5000 프로그램을 그대로 해석 실행
// ============================================================
class PLC {
  constructor(){ this.bits={}; this.prev={}; this.timers={}; }
  get(d){
    if(d.endsWith('@EN')){ const t=this.timers[d.slice(0,-3)]; return t ? !!t.en : false; }
    return !!this.bits[d];
  }
  set(d,v){ this.bits[d]=v; }
}
const plc = new PLC();
// T1(T0001)·T2(T0002)는 사용자가 직접 설정시간을 바꿀 수 있게 함 (기본 5.0초 = 50틱)
// T0(FR)·T3(긴FR) 플리커는 원본 그대로 고정
const TIMER_OVERRIDE = { T0000: 40, T0001: 50, T0002: 50, T0003: 140 };
// 원본 IL이 같은 타이머를 물리주소(T0000)와 태그명(FR)을 섞어서 참조하는 경우가 있어 별칭 처리
const DEVICE_ALIAS = { 'FR':'T0000', '긴FR':'T0003', 'T':'T0001', 'T_2':'T0002' };

// ============================================================
// 도면 원본 이미지 하단 라벨 순서 그대로 재현한 실시간 상태 행
// (18개 원본 도면을 직접 열어 하단 동그라미 순서를 확인해 옮긴 것)
// ============================================================
const DIAGRAM_ROW_LABELS = {
  "1": ["EOCR","FR","YL","BZ","FLS","X","T","MC1","MC2","RL","GL"],
  "2": ["EOCR","YL","BZ","FLS","X","T","FR","MC1","MC2","RL","GL"],
  "3": ["EOCR","YL","BZ","MC1","MC2","FR","FLS","T","X","RL","GL"],
  "4": ["EOCR","YL","BZ","FLS","FR","X","MC1","MC2","T","RL","GL"],
  "5": ["EOCR","YL","BZ","FLS","X","T","FR","MC1","MC2","RL","GL"],
  "6": ["EOCR","YL","BZ","FLS","X","T","FR","MC1","RL","GL","MC2"],
  "7": ["EOCR","YL","BZ","FLS","FR","X","T","MC1","MC2","RL","GL"],
  "8": ["EOCR","BZ","FLS","X","FR","YL","T","MC1","MC2","RL","GL"],
  "9": ["EOCR","FR","YL","BZ","MC1","FLS","X","T","MC2","RL","GL"],
  "10": ["EOCR","YL","X1","T1","MC1","X2","T2","MC2","WL","RL","GL"],
  "11": ["EOCR","YL","X1","MC1","T1","X2","MC2","T2","WL","RL","GL"],
  "12": ["EOCR","YL","X1","MC1","T1","X2","MC2","T2","WL","RL","GL"],
  "13": ["EOCR","YL","X1","MC1","T1","X2","MC2","T2","WL","RL","GL"],
  "14": ["EOCR","YL","X1","X2","MC1","T1","RL","MC2","T2","GL","WL"],
  "15": ["EOCR","YL","X1","X2","MC1","T1","RL","MC2","T2","GL","WL"],
  "16": ["EOCR","YL","T1","T2","MC1","X1","RL","MC2","WL","X2","GL"],
  "17": ["EOCR","YL","X1","X2","MC1","T1","RL","MC2","WL","T2","GL"],
  "18": ["EOCR","YL","X1","X2","MC1","T1","RL","MC2","T2","GL","WL"],
};
const DLR_FIXED = {
  EOCR:{kind:'eocr'}, YL:{kind:'bit', addr:'P00020'}, BZ:{kind:'bit', addr:'P00021'},
  FLS:{kind:'bit', addr:'P00004'}, MC1:{kind:'bit', addr:'P00022'}, MC2:{kind:'bit', addr:'P00023'},
  RL:{kind:'bit', addr:'P00022'}, GL:{kind:'bit', addr:'P00023'}, WL:{kind:'bit', addr:'P00026'},
  X:{kind:'bit', addr:'M00000'}, X1:{kind:'bit', addr:'M00001'}, X2:{kind:'bit', addr:'M00002'},
  X3:{kind:'bit', addr:'M00003'}, X4:{kind:'bit', addr:'M00004'},
};
function dlrResolve(dnum, label){
  if(DLR_FIXED[label]) return DLR_FIXED[label];
  const prog = NEW_DIAGRAMS[String(dnum)] || [];
  const tonTargets = prog.filter(ins=>ins[0]==='TON').map(ins=> DEVICE_ALIAS[ins[1]] || ins[1]);
  if(label==='FR'){
    const t = tonTargets.find(a=>a==='T0000'||a==='T0003');
    return {kind:'timer', addr: t || 'T0000'};
  }
  if(label==='T'){
    const t = tonTargets.find(a=>a==='T0001');
    return {kind:'timer', addr: t || 'T0001'};
  }
  if(label==='T1') return {kind:'timer', addr:'T0001'};
  if(label==='T2') return {kind:'timer', addr:'T0002'};
  return {kind:'bit', addr:label};
}
function buildDiagramLiveRow(dnum){
  const row = document.getElementById('diagramLiveRow');
  const labels = DIAGRAM_ROW_LABELS[String(dnum)];
  if(!labels){ row.classList.remove('show'); row.innerHTML=''; row.__dlrItems = null; return; }
  row.innerHTML = labels.map(l=>`
    <div class="dlr-unit"><div class="dlr-dot" data-label="${l}">${l}</div></div>
  `).join('');
  row.__dlrItems = labels.map(l=> ({label:l, resolved: dlrResolve(dnum, l), el: row.querySelector(`[data-label="${l}"]`)}));
  row.classList.add('show');
}
function updateDiagramLiveRow(){
  const row = document.getElementById('diagramLiveRow');
  if(!row || !row.__dlrItems) return;
  row.__dlrItems.forEach(item=>{
    const r = item.resolved;
    let on = false, trip = false;
    if(r.kind === 'eocr'){
      trip = !!ui.eocr;
      on = !trip;
    } else if(r.kind === 'timer'){
      const timer = plc.timers[r.addr];
      on = !!(timer && timer.en);
    } else {
      on = !!plc.get(r.addr);
    }
    item.el.classList.toggle('on', on && !trip);
    item.el.classList.toggle('trip', trip);
  });
}

// ============================================================
// 원본 도면 이미지 위 실시간 통전 오버레이 (도면별 설정 기반)
// 원본 스캔(1754x1240) 이미지에서 직접 픽셀을 실측해 좌표를 구했습니다.
// 새 도면을 추가하려면: 해당 이미지를 추출해 좌표를 실측한 뒤
// OVERLAY_CONFIGS에 항목만 추가하면 됩니다. 라벨→비트/타이머 판별은
// 기존 dlrResolve()를 그대로 재사용하므로 좌표만 있으면 바로 동작합니다.
// (좌표를 측정하지 않은 도면은 OVERLAY_CONFIGS에 없으므로 오버레이가 자동으로 숨겨지고
//  기존의 원형 상태표시 줄만 보입니다.)
// ============================================================
const OVERLAY_CONFIGS = {
  "1": {
    railY: 292, coilY: 750, leftX: 593, rightX: 1570,
    x: { EOCR:593, FR:674, YL:755, BZ:837, FLS:919, X:1081, T:1163, MC1:1326, MC2:1407, RL:1489, GL:1570 },
    // FR 코일의 두 보조접점(A,B) — YL/BZ 열 위, y 658~702 구간의 실측 접점 위치
    frContacts: [
      { label:'FR-A', x:755, y1:658, y2:702, addr:'P00020' }, // FR-A → YL
      { label:'FR-B', x:837, y1:658, y2:702, addr:'P00021' }, // FR-B → BZ
    ],
  },
  "2": {
    railY: 292, coilY: 750, leftX: 593, rightX: 1570,
    x: { EOCR:593, YL:674, BZ:756, FLS:837, X:1000, T:1081, FR:1244, MC1:1326, MC2:1407, RL:1489, GL:1570 },
    // FR 코일의 두 보조접점 — FR/MC1 열 위, y 658~702 구간의 실측 접점 위치
    frContacts: [
      { label:'FR-1', x:1244, y1:658, y2:702, addr:'P00022' }, // → MC1
      { label:'FR-2', x:1326, y1:658, y2:702, addr:'P00023' }, // → MC2
    ],
  },
  "3": {
    railY: 292, coilY: 750, leftX: 593, rightX: 1489,
    x: { EOCR:593, YL:674, BZ:756, MC1:837, MC2:919, FR:1000, FLS:1081, T:1244, X:1326, RL:1407, GL:1489 },
    frContacts: [
      { label:'FR-1', x:837, y1:658, y2:702, addr:'P00022' }, // → MC1
      { label:'FR-2', x:919, y1:658, y2:702, addr:'P00023' }, // → MC2
    ],
  },
  "4": {
    railY: 292, coilY: 750, leftX: 593, rightX: 1570,
    x: { EOCR:593, YL:674, BZ:756, FLS:837, FR:1000, X:1081, MC1:1244, MC2:1326, T:1407, RL:1489, GL:1570 },
    // 이 도면의 "FR" 코일은 실제로는 긴FR(T0003) 타이머를 표시합니다.
    frContacts: [
      { label:'FR-1', x:1244, y1:535, y2:578, addr:'P00022' }, // → MC1
      { label:'FR-2', x:1326, y1:535, y2:578, addr:'P00023' }, // → MC2
    ],
  },
  "5": {
    railY: 292, coilY: 750, leftX: 593, rightX: 1570,
    x: { EOCR:593, YL:674, BZ:756, FLS:837, X:1000, T:1081, FR:1163, MC1:1244, MC2:1326, RL:1489, GL:1570 },
    frContacts: [
      { label:'FR-1', x:1244, y1:600, y2:645, addr:'P00022' }, // → MC1
      { label:'FR-2', x:1326, y1:600, y2:645, addr:'P00023' }, // → MC2
    ],
  },
  "6": {
    railY: 292, coilY: 750, leftX: 593, rightX: 1570,
    x: { EOCR:593, YL:674, BZ:756, FLS:837, X:1000, T:1081, FR:1244, MC1:1326, RL:1407, GL:1489, MC2:1570 },
    frContacts: [
      { label:'FR-1', x:1326, y1:560, y2:605, addr:'P00022' }, // → MC1
      { label:'FR-2', x:1570, y1:560, y2:605, addr:'P00023' }, // → MC2
    ],
  },
  "7": {
    railY: 292, coilY: 750, leftX: 593, rightX: 1570,
    x: { EOCR:593, YL:674, BZ:756, FLS:837, FR:1000, X:1081, T:1244, MC1:1326, MC2:1407, RL:1489, GL:1570 },
    // 이 도면의 "FR" 코일도 긴FR(T0003) 타이머 표시. 접점 1개가 MC1/MC2로 분기(근사 표시).
    frContacts: [
      { label:'FR-1', x:1163, y1:540, y2:580, addr:'P00022' },
    ],
  },
  "8": {
    railY: 292, coilY: 750, leftX: 593, rightX: 1570,
    x: { EOCR:593, BZ:674, FLS:755, X:837, FR:1000, YL:1081, T:1163, MC1:1325, MC2:1407, RL:1488, GL:1570 },
    frContacts: [
      { label:'FR-1', x:1000, y1:655, y2:695, addr:'P00020' }, // → YL
    ],
  },
  "9": {
    railY: 292, coilY: 750, leftX: 593, rightX: 1570,
    x: { EOCR:593, FR:674, YL:756, BZ:837, MC1:1000, FLS:1082, X:1244, T:1326, MC2:1407, RL:1489, GL:1570 },
    frContacts: [
      { label:'FR-A', x:756, y1:635, y2:685, addr:'P00020' }, // → YL
      { label:'FR-B', x:837, y1:635, y2:685, addr:'P00021' }, // → BZ
    ],
  },
  "10": {
    railY: 292, coilY: 750, leftX: 593, rightX: 1529,
    // 이 도면은 FR/긴FR을 쓰지 않는 2계통(X1·T1·MC1 / X2·T2·MC2) 구조라 보조접점이 없습니다.
    x: { EOCR:593, YL:674, X1:796, T1:878, MC1:959, X2:1041, T2:1122, MC2:1203, WL:1285, RL:1448, GL:1529 },
  },
  "11": {
    railY: 292, coilY: 750, leftX: 593, rightX: 1529,
    x: { EOCR:593, YL:674, X1:796, MC1:878, T1:959, X2:1041, MC2:1122, T2:1203, WL:1285, RL:1448, GL:1529 },
  },
  "12": {
    railY: 292, coilY: 750, leftX: 593, rightX: 1529,
    x: { EOCR:593, YL:674, X1:796, MC1:878, T1:959, X2:1041, MC2:1122, T2:1203, WL:1285, RL:1448, GL:1529 },
  },
  "13": {
    railY: 292, coilY: 750, leftX: 593, rightX: 1529,
    x: { EOCR:593, YL:674, X1:796, MC1:878, T1:959, X2:1041, MC2:1122, T2:1203, WL:1285, RL:1448, GL:1529 },
  },
  "14": {
    railY: 292, coilY: 750, leftX: 593, rightX: 1448,
    x: { EOCR:593, YL:674, X1:796, X2:878, MC1:959, T1:1041, RL:1122, MC2:1203, T2:1285, GL:1366, WL:1448 },
  },
  "15": {
    railY: 292, coilY: 750, leftX: 593, rightX: 1529,
    x: { EOCR:593, YL:674, X1:796, X2:878, MC1:959, T1:1041, RL:1203, MC2:1285, T2:1366, GL:1448, WL:1529 },
  },
  "16": {
    railY: 292, coilY: 750, leftX: 593, rightX: 1529,
    x: { EOCR:593, YL:674, T1:796, T2:878, MC1:959, X1:1041, RL:1203, MC2:1285, WL:1366, X2:1448, GL:1529 },
  },
  "17": {
    railY: 292, coilY: 750, leftX: 593, rightX: 1448,
    x: { EOCR:593, YL:674, X1:796, X2:878, MC1:959, T1:1041, RL:1122, MC2:1203, WL:1285, T2:1366, GL:1448 },
  },
  "18": {
    railY: 292, coilY: 750, leftX: 593, rightX: 1448,
    x: { EOCR:593, YL:674, X1:796, X2:878, MC1:959, T1:1041, RL:1122, MC2:1203, T2:1285, GL:1366, WL:1448 },
  },
};

function overlayTerminalOn(resolved){
  if(resolved.kind==='eocr') return !ui.eocr;
  if(resolved.kind==='timer'){ const tm = plc.timers[resolved.addr]; return !!(tm && tm.en); }
  return !!plc.get(resolved.addr);
}

const OVERLAY_SVGNS = 'http://www.w3.org/2000/svg';
let overlayBuiltFor = null;
let overlayWireEls = {}, overlayCoilEls = {}, overlayFrEls = {}, overlayCustomEls = {}, overlayLeftPowerEls = {}, overlayGroundEls = {};


// ============================================================
// 좌측 주회로(1~18 공통 기반) 실제 배선 추적 오버레이
// - 공개도면 공통 좌측 전력부(MCCB/EOCR/MC1/MC2/M1/M2) 중심
// - MC1/MC2 여자 상태에 맞춰 좌측 주회로 전류 흐름 표시
// ============================================================
const LEFT_POWER_REAL_FLOW = [
  // 도면 1 기준 실측 좌표 보정: 기존보다 오른쪽/아래로 맞춤
  // TB1 -> MCCB -> EOCR 입력부 : MCCB는 항상 ON으로 가정하므로 상시 통전
  {id:'lp-l1-src', state:'sourcePower', points:[[145,255],[145,307],[145,337],[145,426]]},
  {id:'lp-l2-src', state:'sourcePower', points:[[186,255],[186,307],[186,337],[186,426]]},
  {id:'lp-l3-src', state:'sourcePower', points:[[226,255],[226,307],[226,337],[226,426]]},

  // EOCR 통과 후 MC1/MC2 주접점 상단까지 : 주접점 전단은 상시 통전
  {id:'lp-l1-pre', state:'sourcePower', points:[[145,426],[145,480],[145,568]]},
  {id:'lp-l2-pre', state:'sourcePower', points:[[186,426],[186,480],[186,568]]},
  {id:'lp-l3-pre', state:'sourcePower', points:[[226,426],[226,480],[226,568]]},

  // FUSE 상/하단 제어전원 : MCCB ON 상태에서 항상 통전
  // 실측 결과 꺾임점은 x=511 (기존 489는 22px 오차), 상단 라인 y=373, 하단 라인 y=404
  {id:'lp-fuse-top-in', state:'fusePower', points:[[145,373],[349,373]]},
  {id:'lp-fuse-top-out', state:'fusePower', points:[[389,373],[511,373],[511,292],[593,292]]},
  {id:'lp-fuse-bot-in', state:'fusePower', points:[[226,404],[348,404]]},
  {id:'lp-fuse-bot-out', state:'fusePower', points:[[389,404],[511,404],[511,820],[593,820]]},

  // MC1 정회전 가지 -> TB2 -> M1 (모터 원 하단까지 실제 검은선 길이만큼 연장)
  {id:'lp-mc1-l1', state:'mc1Power', points:[[145,568],[145,608],[145,738],[145,826]]},
  {id:'lp-mc1-l2', state:'mc1Power', points:[[186,568],[186,608],[186,738],[186,826]]},
  {id:'lp-mc1-l3', state:'mc1Power', points:[[226,568],[226,608],[226,738],[226,826]]},

  // MC2 역회전 입력 교차배선 -> 실제 MC2 주접점 상단(원본 검은선 실측)
  // PE(267)는 상선이 아니므로 MC2 3상에서 제외한다.
  {id:'lp-mc2-feed1', state:'sourcePower', points:[[145,546],[349,546],[349,568],[349,608]]},
  {id:'lp-mc2-feed2', state:'sourcePower', points:[[186,526],[390,526],[390,568],[390,608]]},
  {id:'lp-mc2-feed3', state:'sourcePower', points:[[226,506],[431,506],[431,568],[431,608]]},

  // MC2 역회전 가지 -> TB3 -> M2 (MC2 실제 접점 x좌표, 모터 원 하단까지 연장)
  {id:'lp-mc2-l1', state:'mc2Power', points:[[349,608],[349,738],[349,826]]},
  {id:'lp-mc2-l2', state:'mc2Power', points:[[390,608],[390,738],[390,826]]},
  {id:'lp-mc2-l3', state:'mc2Power', points:[[431,608],[431,738],[431,826]]},
];

// 보호도체(PE)는 통전 애니메이션과 분리해 항상 녹색으로 표시한다.
// TB1 PE -> TB2/M1 PE/접지, TB1 PE -> TB3/M2 PE/접지의 원본 검은선 경로.
// 접지 기호(땅 표시) 바로 위까지 실제 검은선 길이만큼 연장.
const LEFT_POWER_GROUND_FLOW = [
  {id:'pe-m1', points:[[267,255],[267,480],[267,738],[267,826]]},
  {id:'pe-m2-bridge', points:[[267,480],[470,480],[470,738],[470,826]]},
];

function leftPowerStates(){
  const mc1 = !!plc.get('P00022');
  const mc2 = !!plc.get('P00023');
  return {
    sourcePower: true,   // MCCB ON 상시
    fusePower: true,     // FUSE 전후 제어전원 상시
    mc1Power: mc1,
    mc2Power: mc2,
  };
}

// ============================================================
// 도면 1 실제 배선 추적 오버레이
// - 원본 1754x1240 좌표계에 맞춰 검은 배선의 꺾임을 그대로 따라감
// - PLC 계산은 기존 NEW_DIAGRAMS/PLC 엔진을 그대로 사용
// - 2~18번은 기존 세로선 오버레이 방식 유지
// ============================================================
const DIAGRAM1_REAL_FLOW = [
  // 전원/공통 버스
  {id:'feed-pre',       state:'controlPower', points:[[489,292],[593,292]]},
  {id:'feed-normal',    state:'eocrNormal',   points:[[593,292],[1570,292]]},
  {id:'return-bus',     state:'controlPower', points:[[489,820],[1570,820]]},

  // EOCR 트립 표시/FR 점멸 계통 (원본 좌측 가지) — 실측 결과 중간 가로선은 y=496, 618
  {id:'trip-feed',      state:'eocrTripContact', points:[[593,292],[593,496],[674,496],[674,618]]},
  {id:'fr-coil-feed',   state:'fr',           points:[[674,618],[674,720]]},
  {id:'fr-return',      state:'fr',           points:[[674,780],[674,820]]},
  {id:'yl-feed',        state:'yl',           points:[[674,618],[755,618],[755,720]]},
  {id:'yl-return',      state:'yl',           points:[[755,780],[755,820]]},
  {id:'bz-feed',        state:'bz',           points:[[674,618],[837,618],[837,720]]},
  {id:'bz-return',      state:'bz',           points:[[837,780],[837,820]]},

  // FLS 입력 표시 가지
  {id:'fls-ind-feed',   state:'fls',          points:[[1081,496],[919,496],[919,720]]},
  {id:'fls-ind-return', state:'fls',          points:[[919,780],[919,820]]},

  // 자동(A) : SS(A) -> FLS -> X (X 코일 자체 열(1081)이 FLS 분기 끝(537)에서
  // 코일까지 실제로 이어지는 원본 배선. 기존 코드는 이 구간을 MC1 열(1326)에
  // 잘못 그려 MC1이 꺼져 있어도 그 자리에 빨간선이 겹쳐 보이는 버그가 있었음)
  {id:'auto-a-feed', state:'eocrNormal', points:[[1081,292],[1081,333]]},
  {id:'auto-fls-feed', state:'fls', points:[[1081,373],[1081,537]]},
  {id:'x-coil-feed', state:'x', points:[[1081,537],[1081,720]]},
  {id:'x-return', state:'x', points:[[1081,780],[1081,820]]},

  // 수동(M) : SS(M) -> PB0 -> PB1 또는 자기유지 접점
  {id:'manual-common',  state:'manualRun',    points:[[1163,292],[1163,496]]},
  {id:'manual-pb1',     state:'manualPB1',    points:[[1163,496],[1163,618]]},
  {id:'manual-hold',    state:'manualHold',   points:[[1163,496],[1244,496],[1244,618],[1163,618]]},

  // 자동 X 접점이 운전 버스를 직접 공급하는 가지
  {id:'x-contact-feed', state:'autoRun',      points:[[1326,292],[1326,618]]},

  // 운전 공통선 및 T/MC1/MC2
  {id:'run-bus',        state:'runBus',       points:[[1163,618],[1407,618]]},
  {id:'t-coil-feed',    state:'t',            points:[[1163,618],[1163,720]]},
  {id:'t-return',       state:'t',            points:[[1163,780],[1163,820]]},
  {id:'mc1-feed',       state:'mc1',          points:[[1326,618],[1326,720]]},
  {id:'mc1-return',     state:'mc1',          points:[[1326,780],[1326,820]]},
  {id:'mc2-feed',       state:'mc2',          points:[[1407,618],[1407,720]]},
  {id:'mc2-return',     state:'mc2',          points:[[1407,780],[1407,820]]},

  // MC1/MC2 보조접점 -> 표시등 RL/GL
  {id:'rl-feed',        state:'mc1',          points:[[1489,292],[1489,720]]},
  {id:'rl-return',      state:'mc1',          points:[[1489,780],[1489,820]]},
  {id:'gl-feed',        state:'mc2',          points:[[1570,292],[1570,720]]},
  {id:'gl-return',      state:'mc2',          points:[[1570,780],[1570,820]]},
];

function diagram1FlowStates(){
  const t0 = plc.timers['T0000'];
  const t1 = plc.timers['T0001'];
  const fr  = !!(t0 && t0.en);
  const t   = !!(t1 && t1.en);
  const yl  = !!plc.get('P00020');
  const bz  = !!plc.get('P00021');
  const x   = !!plc.get('M00000');
  const hold= !!plc.get('M00001');
  const mc1 = !!plc.get('P00022');
  const mc2 = !!plc.get('P00023');
  const fls = !!ui.fls;
  const controlPower = true;
  const eocrNormal = !ui.eocr;
  // EOCR 트립 접점(과부하 시 닫히는 접점) 자신의 상태 — 뒷단 FR/YL/BZ 결과를 기다리지 않음
  const eocrTripContact = !!ui.eocr;

  // 접점 하나하나의 통전 여부는 "그 접점 자신의 조건"만으로 판단한다.
  // (예: X의 a접점은 X 코일 자신이 여자되면 바로 닫힌 것으로 표시 —
  //  뒤쪽 MC1/T가 실제로 켜졌는지와는 무관하게, 접점 자체는 이미 닫혀 있음)
  // manual-common: SS가 M 위치 + 정지(PB0) 안 눌림 + EOCR 정상이면 이 구간까지는 항상 통전
  const manualRun = !ui.eocr && !ui.ss && !ui.pb0;
  // PB1을 누르는 순간 그 접점 자체가 닫힘 (뒷단 결과를 기다리지 않음)
  const manualPB1 = manualRun && !!ui.pb1;
  // 자기유지 접점(hold)도 PB1을 안 누른 상태에서 hold 비트가 서있으면 그 자체로 닫힘
  const manualHold = manualRun && !ui.pb1 && hold;
  // 자동 X의 a접점: X 코일이 여자되면 그 즉시 접점 닫힘 (EOCR 정상일 때)
  const autoRun = !ui.eocr && x;
  // 운전 공통선(run-bus)은 위 세 접점 경로 중 하나라도 실제로 닫혀 있으면 통전
  // (뒷단 MC1/T 출력을 거꾸로 참조하지 않고, 앞단 접점들의 OR로 순방향 계산)
  const runBus = manualPB1 || manualHold || autoRun;
  const tripAny = fr || yl || bz;
  const normalAny = x || fls || runBus || mc1 || mc2;
  const any = tripAny || normalAny;

  return { controlPower, eocrNormal, eocrTripContact, any, normalAny, tripAny, fr, yl, bz, fls, x, t, mc1, mc2,
           runBus, manualRun, manualPB1, manualHold, autoRun };
}

function diagram2FlowStates(){
  const x   = overlayTerminalOn(dlrResolve(2,'X'));
  const t   = overlayTerminalOn(dlrResolve(2,'T'));
  const fr  = overlayTerminalOn(dlrResolve(2,'FR'));
  const mc1 = overlayTerminalOn(dlrResolve(2,'MC1'));
  const mc2 = overlayTerminalOn(dlrResolve(2,'MC2'));
  const fls = !!ui.fls;
  const controlPower = true;
  const eocrNormal = !ui.eocr;
  const eocrTrip = !!ui.eocr;
  // SS가 A(자동) 위치인지 M(수동) 위치인지 — 접점 자신의 조건만으로 판단
  const ssAuto = !ui.eocr && !!ui.ss;
  const ssManual = !ui.eocr && !ui.ss;
  // 자동 분기: A 접점 다음에 FLS 접점을 지나야 함
  const autoBranch = ssAuto && !ui.fls;
  // 수동 분기: M 접점 -> PB0(정지 아님) 통과
  const manualPastPB0 = ssManual && !ui.pb0;
  // PB1을 누르거나, 이미 X가 켜져 있으면(자기유지) 통전
  const manualBranch = manualPastPB0 && (!!ui.pb1 || x);
  // 자동/수동 두 경로가 만나는 지점 — 어느 한쪽이라도 닫혀 있으면 통전
  const merged = autoBranch || manualBranch;
  // X 보조접점 다음에 T(타이머) 보조접점까지 지나야 FR로 이어짐(직렬)
  const xt = x && t;
  return { controlPower, eocrNormal, eocrTrip, ssAuto, ssManual, autoBranch,
           manualPastPB0, manualBranch, merged, x, t, xt, fr, mc1, mc2, fls };
}

const DIAGRAM2_REAL_FLOW = [
  {id:'feed-pre',    state:'controlPower', points:[[511,292],[634,292]]},
  {id:'feed-normal', state:'eocrNormal',   points:[[674,292],[1570,292]]},
  {id:'return-bus',  state:'controlPower', points:[[511,822],[1570,822]]},

  // EOCR 트립 표시(EOCR/YL/BZ 모두 트립 상태를 그대로 미러링)
  {id:'eocr-feed',   state:'eocrTrip', points:[[592,288],[592,741]]},
  {id:'eocr-return', state:'eocrTrip', points:[[592,781],[592,825]]},
  {id:'yl-branch',   state:'eocrTrip', points:[[589,536],[674,536]]},
  {id:'yl-feed',     state:'eocrTrip', points:[[674,618],[674,741]]},
  {id:'yl-return',   state:'eocrTrip', points:[[674,781],[674,825]]},
  {id:'bz-branch',   state:'eocrTrip', points:[[671,659],[756,659]]},
  {id:'bz-feed',     state:'eocrTrip', points:[[756,659],[756,740]]},
  {id:'bz-return',   state:'eocrTrip', points:[[756,784],[756,825]]},

  // FLS 상태 표시등 (플로트 스위치 입력을 그대로 미러링)
  {id:'fls-branch',  state:'fls', points:[[853,496],[1003,496]]},
  {id:'fls-feed',    state:'fls', points:[[837,496],[837,741]]},
  {id:'fls-return',  state:'fls', points:[[837,781],[837,825]]},

  // 자동(A) 경로: SS가 A위치 -> FLS 접점 -> 병합점 -> X 코일
  {id:'auto-a',      state:'ssAuto',    points:[[1000,288],[1000,333]]},
  {id:'auto-fls',    state:'autoBranch',points:[[1000,373],[1000,618]]},
  {id:'merge-to-x',  state:'merged',    points:[[1000,618],[1000,741]]},
  {id:'x-return',    state:'x',         points:[[1000,781],[1000,825]]},

  // 수동(M) 경로: SS가 M위치 -> PB0(정지 아님) -> PB1 또는 자기유지(X)
  {id:'manual-m',       state:'ssManual',      points:[[1081,288],[1081,333]]},
  {id:'manual-pb0',     state:'manualPastPB0', points:[[1081,373],[1081,537]]},
  {id:'manual-pb1hold', state:'manualBranch',  points:[[1081,577],[1081,621]]},
  // 자동<->수동 교차 브릿지: 두 경로가 실제로 만나는 지점 (어느 한쪽이든 살아있으면 통전)
  {id:'bridge-1',    state:'merged', points:[[996,618],[1056,618]]},
  {id:'bridge-2',    state:'merged', points:[[996,700],[1081,700]]},
  {id:'merge-to-t',  state:'x',      points:[[1081,700],[1081,741]]},
  {id:'t-return',    state:'t',      points:[[1081,781],[1081,825]]},

  // X의 보조접점(a접점) -> T의 보조접점(a접점) -> FR 코일 (직렬)
  {id:'x-aux-contact', state:'x',  points:[[1244,289],[1244,333]]},
  {id:'t-aux-contact', state:'xt', points:[[1244,373],[1244,414]]},
  {id:'fr-feed',       state:'fr', points:[[1244,455],[1244,741]]},
  {id:'fr-return',     state:'fr', points:[[1244,781],[1244,825]]},

  // X&&T 접점 통과 지점에서 MC1/MC2로도 분기
  {id:'xt-bus',      state:'xt',  points:[[1241,618],[1407,618]]},
  {id:'mc1-feed-a',  state:'mc1', points:[[1325,615],[1325,659]]},
  {id:'mc1-feed-b',  state:'mc1', points:[[1326,699],[1326,741]]},
  {id:'mc1-return',  state:'mc1', points:[[1326,781],[1326,825]]},
  {id:'mc2-feed',    state:'mc2', points:[[1406,699],[1407,739]]},
  {id:'mc2-return',  state:'mc2', points:[[1407,781],[1407,825]]},

  // RL/GL (MC1/MC2 보조접점으로 구동되는 표시등)
  {id:'rl-feed',    state:'mc1', points:[[1488,289],[1488,741]]},
  {id:'rl-return',  state:'mc1', points:[[1488,781],[1488,825]]},
  {id:'gl-feed',    state:'mc2', points:[[1570,293],[1570,741]]},
  {id:'gl-return',  state:'mc2', points:[[1570,781],[1570,825]]},
];

function diagram3FlowStates(){
  const x   = overlayTerminalOn(dlrResolve(3,'X'));     // M00000, 이번 스캔 결과값(자기참조 접점 표시용으로도 재사용)
  const fr  = overlayTerminalOn(dlrResolve(3,'FR'));
  const mc1 = overlayTerminalOn(dlrResolve(3,'MC1'));
  const mc2 = overlayTerminalOn(dlrResolve(3,'MC2'));
  const fls = !!ui.fls;
  const hold = !!plc.get('M00001');
  const controlPower = true;
  const eocrNormal = !ui.eocr;
  const eocrTrip = !!ui.eocr;
  const ssAuto = !ui.eocr && !!ui.ss;
  const ssManual = !ui.eocr && !ui.ss;
  // 자동 분기: A 접점 다음에 FLS 접점(이번 도면은 AND, 즉 FLS가 ON이어야 통전)
  const autoBranch = ssAuto && !!ui.fls;
  // X 자기 자신(직전 스캔 값) 또는 자동분기 중 하나라도 있으면 병합점 통전
  // (FR/MC1/MC2/FR타이머는 이 병합값을 그대로 사용 — X 코일 자체와는 다른 갈래)
  const merged = !ui.eocr && (x || autoBranch);
  // 수동 분기: M 접점 -> PB0(정지 아님) 통과
  const manualPastPB0 = ssManual && !ui.pb0;
  const manualPB1 = manualPastPB0 && !!ui.pb1;
  const manualHoldOnly = manualPastPB0 && hold;
  const manualBranch = manualPastPB0 && (!!ui.pb1 || hold);
  return { controlPower, eocrNormal, eocrTrip, ssAuto, ssManual, autoBranch, merged,
           manualPastPB0, manualPB1, manualHoldOnly, manualBranch, x, fr, mc1, mc2, fls };
}

const DIAGRAM3_REAL_FLOW = [
  {id:'feed-pre',    state:'controlPower', points:[[511,292],[634,292]]},
  {id:'feed-normal', state:'eocrNormal',   points:[[674,292],[1489,292]]},
  {id:'return-bus',  state:'controlPower', points:[[511,822],[1489,822]]},

  // EOCR 트립 표시(EOCR/YL/BZ 모두 트립 상태를 그대로 미러링)
  {id:'eocr-feed',   state:'eocrTrip', points:[[592,288],[592,741]]},
  {id:'eocr-return', state:'eocrTrip', points:[[592,781],[592,819]]},
  {id:'yl-branch',   state:'eocrTrip', points:[[589,537],[674,537]]},
  {id:'yl-feed',     state:'eocrTrip', points:[[674,618],[674,741]]},
  {id:'yl-return',   state:'eocrTrip', points:[[674,781],[674,819]]},
  {id:'bz-branch',   state:'eocrTrip', points:[[671,659],[755,659]]},
  {id:'bz-feed',     state:'eocrTrip', points:[[756,659],[756,825]]},

  // X 자기참조 접점(직전 스캔값) — 병합점까지
  {id:'x-contact',   state:'x',      points:[[918,289],[918,333]]},
  {id:'x-to-merge',  state:'x',      points:[[918,373],[918,537]]},

  // 자동(A) 경로: A 접점 -> FLS 접점(직렬) -> 병합점
  {id:'auto-a',      state:'ssAuto',    points:[[1000,288],[1000,333]]},
  {id:'auto-fls-in',  state:'ssAuto',   points:[[1000,373],[1000,455]]},
  {id:'auto-fls-out', state:'autoBranch', points:[[1000,495],[1000,537]]},

  // FLS 표시등(플로트 스위치 raw 입력을 그대로 표시 — 배선상 A분기에서 탭되어 있지만
  // 실제 표시는 항상 원시 입력값을 따름)
  {id:'fls-branch',  state:'fls', points:[[996,414],[1080,414]]},
  {id:'fls-feed',    state:'fls', points:[[1081,414],[1081,741]]},

  // 병합 이후: FR 코일, MC1/MC2 보조접점 분기
  {id:'merge-bridge', state:'merged', points:[[915,537],[1002,537]]},
  {id:'merge-to-fr',  state:'merged', points:[[1000,537],[1000,699]]},
  {id:'fr-feed',      state:'fr',     points:[[1000,699],[1000,741]]},
  {id:'fr-return',    state:'fr',     points:[[1000,781],[1000,819]]},
  {id:'merge-down',   state:'merged', points:[[918,537],[918,618]]},
  {id:'mc1-branch',   state:'mc1',    points:[[837,618],[922,618]]},
  {id:'mc1-feed',     state:'mc1',    points:[[837,619],[837,741]]},
  {id:'mc1-return',   state:'mc1',    points:[[837,781],[837,819]]},
  {id:'mc2-feed',     state:'mc2',    points:[[918,618],[919,741]]},
  {id:'mc2-return',   state:'mc2',    points:[[919,782],[919,825]]},

  // 수동(M) 경로: M -> PB0(정지 아님) -> [PB1 | 자기유지] -> T코일 / X코일
  {id:'manual-m',    state:'ssManual',      points:[[1244,289],[1244,333]]},
  {id:'manual-pb0',  state:'ssManual',      points:[[1244,373],[1244,414]]},
  {id:'manual-pb0-out', state:'manualPastPB0', points:[[1244,455],[1244,537]]},
  {id:'manual-pb1',  state:'manualPB1',     points:[[1244,577],[1244,621]]},
  {id:'manual-hold',  state:'manualHoldOnly', points:[[1325,496],[1326,537]]},
  {id:'manual-merge-bridge', state:'manualBranch', points:[[1244,569],[1326,569]]},
  {id:'t-feed',      state:'manualBranch',  points:[[1244,621],[1244,741]]},
  {id:'t-return',    state:'manualBranch',  points:[[1244,781],[1244,825]]},
  // T0001 자신의 접점(수동분기가 타이머 완료될 때까지 기다렸다가 X 코일로)
  {id:'t0001-contact', state:'manualBranch', points:[[1326,577],[1326,659]]},
  {id:'x-feed',      state:'x',             points:[[1326,699],[1326,741]]},
  {id:'x-return',    state:'x',             points:[[1326,782],[1326,825]]},

  // RL/GL (MC1/MC2 보조접점으로 구동되는 표시등)
  {id:'rl-feed',    state:'mc1', points:[[1407,288],[1407,741]]},
  {id:'rl-return',  state:'mc1', points:[[1407,781],[1407,825]]},
  {id:'gl-feed',    state:'mc2', points:[[1488,293],[1488,741]]},
  {id:'gl-return',  state:'mc2', points:[[1488,783],[1488,820]]},
];

// ==================== 도면 10 ====================
// IL 구조: X1/X2 각각 독립적인 PB자기유지 회로. X1이 서면 LS1 만족 시 T1 타이머가
// 돌기 시작하고, 타이머가 다 차야 MC1이 붙는다(X2/T2/MC2도 동일 구조, 독립적).
// WL은 "X1은 섰는데 아직 MC1이 안 붙었거나, X2는 섰는데 아직 MC2가 안 붙은" 상태 표시.
function diagram10FlowStates(){
  const x1=overlayTerminalOn(dlrResolve(10,'X1')), x2=overlayTerminalOn(dlrResolve(10,'X2'));
  const t1=overlayTerminalOn(dlrResolve(10,'T1')), t2=overlayTerminalOn(dlrResolve(10,'T2'));
  const mc1=overlayTerminalOn(dlrResolve(10,'MC1')), mc2=overlayTerminalOn(dlrResolve(10,'MC2'));
  const wl=overlayTerminalOn(dlrResolve(10,'WL'));
  const controlPower=true, eocrNormal=!ui.eocr, eocrTrip=!!ui.eocr;
  // 공통 프리픽스: EOCR 정상 + 정지(PB0) 안 눌림 — 이후 PB1/X1, PB2/X2 두 갈래가 나뉨
  const common = !ui.eocr && !ui.pb0;
  const pb1c = common && !!ui.pb1;
  const x1selfc = common && x1;     // X1 자기유지 접점 자신의 조건
  const ls1c = x1 && !!ui.ls1;      // X1 다음 LS1 접점
  const pb2c = common && !!ui.pb2;
  const x2selfc = common && x2;
  const ls2c = x2 && !!ui.ls2;
  // WL: X1은 섰지만 MC1 NC접점이 아직 닫혀있음(=MC1 미동작) — 또는 X2/MC2 마찬가지
  const wlBranch1 = x1 && !mc1;
  const wlBranch2 = x2 && !mc2;
  return { controlPower, eocrNormal, eocrTrip, common, pb1c, x1selfc, ls1c, pb2c, x2selfc, ls2c,
           wlBranch1, wlBranch2, x1, x2, t1, t2, mc1, mc2, wl };
}

const DIAGRAM10_REAL_FLOW = [
  {id:'feed-pre',    state:'controlPower', points:[[489,292],[634,292]]},
  {id:'feed-eocr-pb0', state:'eocrNormal', points:[[634,292],[715,292]]},
  {id:'feed-common', state:'common', points:[[715,292],[1529,292]]},
  {id:'return-bus',  state:'controlPower', points:[[489,822],[1529,822]]},

  // EOCR 표시등(전원 인가 시 항상 표시) / YL(트립 상태 그대로 미러링)
  {id:'eocr-feed',   state:'controlPower', points:[[593,288],[593,741]]},
  {id:'eocr-return', state:'controlPower', points:[[593,781],[593,825]]},
  {id:'yl-feed',     state:'eocrTrip', points:[[674,618],[674,741]]},
  {id:'yl-return',   state:'eocrTrip', points:[[674,781],[674,825]]},

  // X1 계열: PB1 | X1(자기유지) 병렬 -> 병합 -> X1코일 / (LS1->T1코일, T1접점->MC1코일)
  {id:'pb1-contact', state:'pb1c',   points:[[796,289],[796,333]]},
  {id:'x1-self-contact', state:'x1selfc', points:[[808,289],[808,333]]},
  {id:'x1-merge-bridge', state:'x1', points:[[796,373],[808,373]]},
  {id:'x1-common',   state:'x1', points:[[796,373],[796,618]]},
  {id:'x1-feed',     state:'x1', points:[[796,618],[796,741]]},
  {id:'x1-return',   state:'x1', points:[[796,781],[796,825]]},
  {id:'x1-branch',   state:'x1', points:[[796,618],[878,618]]},
  {id:'ls1-contact', state:'ls1c', points:[[878,618],[878,659]]},
  {id:'t1-feed',     state:'t1',  points:[[878,700],[878,741]]},
  {id:'t1-return',   state:'t1',  points:[[878,781],[878,825]]},
  {id:'t1-contact',  state:'mc1', points:[[959,618],[959,659]]},
  {id:'mc1-feed',    state:'mc1', points:[[959,700],[959,741]]},
  {id:'mc1-return',  state:'mc1', points:[[959,781],[959,825]]},

  // X2 계열 (X1과 동일 구조)
  {id:'pb2-contact', state:'pb2c',   points:[[1041,289],[1041,333]]},
  {id:'x2-self-contact', state:'x2selfc', points:[[1053,289],[1053,333]]},
  {id:'x2-merge-bridge', state:'x2', points:[[1041,373],[1053,373]]},
  {id:'x2-common',   state:'x2', points:[[1041,373],[1041,618]]},
  {id:'x2-feed',     state:'x2', points:[[1041,618],[1041,741]]},
  {id:'x2-return',   state:'x2', points:[[1041,781],[1041,825]]},
  {id:'x2-branch',   state:'x2', points:[[1041,618],[1122,618]]},
  {id:'ls2-contact', state:'ls2c', points:[[1122,618],[1122,659]]},
  {id:'t2-feed',     state:'t2',  points:[[1122,700],[1122,741]]},
  {id:'t2-return',   state:'t2',  points:[[1122,781],[1122,825]]},
  {id:'t2-contact',  state:'mc2', points:[[1203,618],[1203,659]]},
  {id:'mc2-feed',    state:'mc2', points:[[1203,700],[1203,741]]},
  {id:'mc2-return',  state:'mc2', points:[[1203,781],[1203,825]]},

  // WL: (X1 AND NOT MC1) OR (X2 AND NOT MC2)
  {id:'wl-x1-contact',  state:'x1',        points:[[1285,289],[1285,333]]},
  {id:'wl-mc1nc',       state:'wlBranch1', points:[[1285,373],[1285,455]]},
  {id:'wl-x2-contact',  state:'x2',        points:[[1366,289],[1366,333]]},
  {id:'wl-mc2nc',       state:'wlBranch2', points:[[1366,373],[1366,455]]},
  {id:'wl-merge-bridge', state:'wl',       points:[[1285,455],[1366,455]]},
  {id:'wl-feed',        state:'wl',        points:[[1285,455],[1285,741]]},
  {id:'wl-return',      state:'wl',        points:[[1285,781],[1285,825]]},

  // RL/GL (MC1/MC2 보조접점으로 구동되는 표시등)
  {id:'mc1-aux-rl',  state:'mc1', points:[[1448,289],[1448,741]]},
  {id:'rl-return-10',state:'mc1', points:[[1448,781],[1448,825]]},
  {id:'mc2-aux-gl',  state:'mc2', points:[[1529,289],[1529,741]]},
  {id:'gl-return-10',state:'mc2', points:[[1529,781],[1529,825]]},
];

// ==================== 도면 11 ====================
// 도면 10과 비슷해 보이지만 자기유지 방식이 다름: X1은 "PB1 OR T1타이머 완료"로
// 유지되고(X1 자신이 아니라 T1 완료 여부로 유지), MC1은 X1&&LS1로 바로 붙음(지연 없음).
// 대신 T1 타이머 자체가 "X1 AND NOT X2"일 때만 도는 상호배타 구조.
function diagram11FlowStates(){
  const x1=overlayTerminalOn(dlrResolve(11,'X1')), x2=overlayTerminalOn(dlrResolve(11,'X2'));
  const t1=overlayTerminalOn(dlrResolve(11,'T1')), t2=overlayTerminalOn(dlrResolve(11,'T2'));
  const mc1=overlayTerminalOn(dlrResolve(11,'MC1')), mc2=overlayTerminalOn(dlrResolve(11,'MC2'));
  const wl=overlayTerminalOn(dlrResolve(11,'WL'));
  const t1done = !!(plc.timers['T0001'] && plc.timers['T0001'].done);
  const t2done = !!(plc.timers['T0002'] && plc.timers['T0002'].done);
  const controlPower=true, eocrNormal=!ui.eocr, eocrTrip=!!ui.eocr;
  const common = !ui.eocr && !ui.pb0;
  const pb1c = common && !!ui.pb1;
  const t1selfc = common && t1done;      // T1 타이머 완료 접점(자기유지용)
  const ls1c = x1 && !!ui.ls1;
  const x2ncFeedT1 = x1 && !x2;          // X2 b접점 -> T1 타이머 인에이블
  const pb2c = common && !!ui.pb2;
  const t2selfc = common && t2done;
  const ls2c = x2 && !!ui.ls2;
  const x1ncFeedT2 = x2 && !x1;
  const wlBranch1 = x1 && !mc1;
  const wlBranch2 = x2 && !mc2;
  return { controlPower, eocrNormal, eocrTrip, common, pb1c, t1selfc, ls1c, x2ncFeedT1,
           pb2c, t2selfc, ls2c, x1ncFeedT2, wlBranch1, wlBranch2, x1, x2, t1, t2, mc1, mc2, wl };
}

const DIAGRAM11_REAL_FLOW = [
  {id:'feed-pre',    state:'controlPower', points:[[489,292],[634,292]]},
  {id:'feed-eocr-pb0', state:'eocrNormal', points:[[634,292],[715,292]]},
  {id:'feed-common', state:'common', points:[[715,292],[1529,292]]},
  {id:'return-bus',  state:'controlPower', points:[[489,822],[1529,822]]},

  {id:'eocr-feed',   state:'controlPower', points:[[593,288],[593,741]]},
  {id:'eocr-return', state:'controlPower', points:[[593,781],[593,825]]},
  {id:'yl-feed',     state:'eocrTrip', points:[[674,618],[674,741]]},
  {id:'yl-return',   state:'eocrTrip', points:[[674,781],[674,825]]},

  // X1 계열: PB1 | T1(완료접점) 병렬 -> X1코일 / LS1->MC1코일(직결) / X2(b)->T1코일
  {id:'pb1-contact', state:'pb1c',   points:[[796,289],[796,333]]},
  {id:'t1-self-contact', state:'t1selfc', points:[[808,289],[808,333]]},
  {id:'x1-merge-bridge', state:'x1', points:[[796,373],[808,373]]},
  {id:'x1-common',   state:'x1', points:[[796,373],[796,618]]},
  {id:'x1-feed',     state:'x1', points:[[796,618],[796,741]]},
  {id:'x1-return',   state:'x1', points:[[796,781],[796,825]]},
  {id:'x1-branch-mc1', state:'x1', points:[[796,618],[878,618]]},
  {id:'ls1-contact', state:'ls1c', points:[[878,615],[878,659]]},
  {id:'mc1-feed',    state:'mc1', points:[[878,700],[878,741]]},
  {id:'mc1-return',  state:'mc1', points:[[878,781],[878,825]]},
  {id:'x2nc-contact',state:'x2ncFeedT1', points:[[959,618],[959,659]]},
  {id:'t1-feed',     state:'t1',  points:[[959,700],[959,741]]},
  {id:'t1-return',   state:'t1',  points:[[959,781],[959,825]]},

  // X2 계열 (X1과 동일 구조, 역할만 반대)
  {id:'pb2-contact', state:'pb2c',   points:[[1041,289],[1041,333]]},
  {id:'t2-self-contact', state:'t2selfc', points:[[1053,289],[1053,333]]},
  {id:'x2-merge-bridge', state:'x2', points:[[1041,373],[1053,373]]},
  {id:'x2-common',   state:'x2', points:[[1041,373],[1041,618]]},
  {id:'x2-feed',     state:'x2', points:[[1041,618],[1041,741]]},
  {id:'x2-return',   state:'x2', points:[[1041,781],[1041,825]]},
  {id:'x2-branch-mc2', state:'x2', points:[[1041,618],[1122,618]]},
  {id:'ls2-contact', state:'ls2c', points:[[1122,615],[1122,659]]},
  {id:'mc2-feed',    state:'mc2', points:[[1122,700],[1122,741]]},
  {id:'mc2-return',  state:'mc2', points:[[1122,781],[1122,825]]},
  {id:'x1nc-contact',state:'x1ncFeedT2', points:[[1203,618],[1203,659]]},
  {id:'t2-feed',     state:'t2',  points:[[1203,700],[1203,741]]},
  {id:'t2-return',   state:'t2',  points:[[1203,781],[1203,825]]},

  // WL: (X1 AND NOT MC1) OR (X2 AND NOT MC2)
  {id:'wl-x1-contact',  state:'x1',        points:[[1285,289],[1285,333]]},
  {id:'wl-mc1nc',       state:'wlBranch1', points:[[1285,373],[1285,455]]},
  {id:'wl-x2-contact',  state:'x2',        points:[[1366,289],[1366,333]]},
  {id:'wl-mc2nc',       state:'wlBranch2', points:[[1366,373],[1366,455]]},
  {id:'wl-merge-bridge', state:'wl',       points:[[1285,455],[1366,455]]},
  {id:'wl-feed',        state:'wl',        points:[[1285,455],[1285,741]]},
  {id:'wl-return',      state:'wl',        points:[[1285,781],[1285,825]]},

  {id:'mc1-aux-rl',  state:'mc1', points:[[1448,289],[1448,741]]},
  {id:'rl-return',   state:'mc1', points:[[1448,781],[1448,825]]},
  {id:'mc2-aux-gl',  state:'mc2', points:[[1529,289],[1529,741]]},
  {id:'gl-return',   state:'mc2', points:[[1529,781],[1529,825]]},
];

// ==================== 도면 12 ====================
// X1은 PB1 | X1(자기자신) | T2(완료) 3중 병렬로 유지되고, MC1은 X1&&LS1로 붙음.
// T1 타이머는 "X1 AND NOT MC1"(MC1이 아직 안 붙은 대기상태)일 때 돌아감.
// X2측은 비대칭: MC2는 X2가 서면 바로 붙고(LS2 불필요), LS2는 오직 T2 타이머만 인에이블.
// WL = (X1&&!MC1) OR (X2&&LS2) 를 그대로 저장한 M00003/M00004의 OR.
function diagram12FlowStates(){
  const x1=overlayTerminalOn(dlrResolve(12,'X1')), x2=overlayTerminalOn(dlrResolve(12,'X2'));
  const t1=overlayTerminalOn(dlrResolve(12,'T1')), t2=overlayTerminalOn(dlrResolve(12,'T2'));
  const mc1=overlayTerminalOn(dlrResolve(12,'MC1')), mc2=overlayTerminalOn(dlrResolve(12,'MC2'));
  const wl=overlayTerminalOn(dlrResolve(12,'WL'));
  const t2done = !!(plc.timers['T0002'] && plc.timers['T0002'].done);
  const t1done = !!(plc.timers['T0001'] && plc.timers['T0001'].done);
  const controlPower=true, eocrNormal=!ui.eocr, eocrTrip=!!ui.eocr;
  const common = !ui.eocr && !ui.pb0;
  const pb1c = common && !!ui.pb1;
  const x1selfc = common && x1;
  const t2selfc = common && t2done;      // X1의 3번째 병렬 입력: T2 완료 접점
  const ls1c = x1 && !!ui.ls1;
  const mc1ncFeedT1 = x1 && !mc1;         // M00003: X1 섰지만 MC1 아직 안붙음(대기)
  const pb2c = common && !!ui.pb2;
  const x2selfc = common && x2;
  const t1selfc = common && t1done;      // X2의 3번째 병렬 입력: T1 완료 접점
  const ls2c = x2 && !!ui.ls2;
  const x2ls2FeedT2 = x2 && !!ui.ls2;     // M00004: X2 && LS2 (T2 인에이블, MC2와는 무관)
  return { controlPower, eocrNormal, eocrTrip, common, pb1c, x1selfc, t2selfc, ls1c, mc1ncFeedT1,
           pb2c, x2selfc, t1selfc, ls2c, x2ls2FeedT2, x1, x2, t1, t2, mc1, mc2, wl };
}

const DIAGRAM12_REAL_FLOW = [
  {id:'feed-pre',    state:'controlPower', points:[[489,292],[634,292]]},
  {id:'feed-eocr-pb0', state:'eocrNormal', points:[[634,292],[715,292]]},
  {id:'feed-common', state:'common', points:[[715,292],[1529,292]]},
  {id:'return-bus',  state:'controlPower', points:[[489,822],[1529,822]]},

  {id:'eocr-feed',   state:'controlPower', points:[[593,288],[593,741]]},
  {id:'eocr-return', state:'controlPower', points:[[593,781],[593,825]]},
  {id:'yl-feed',     state:'eocrTrip', points:[[674,618],[674,741]]},
  {id:'yl-return',   state:'eocrTrip', points:[[674,781],[674,825]]},

  // X1 계열: PB1 | X1(자기유지) | T2(완료) 3중 병렬 -> X1코일 / LS1->MC1 / MC1(b)->T1
  {id:'pb1-contact', state:'pb1c',   points:[[796,289],[796,333]]},
  {id:'x1-self-contact', state:'x1selfc', points:[[878,289],[878,333]]},
  {id:'t2-self-contact', state:'t2selfc', points:[[959,289],[959,333]]},
  {id:'x1-merge-bridge', state:'x1', points:[[796,373],[959,373]]},
  {id:'x1-common',   state:'x1', points:[[796,373],[796,618]]},
  {id:'x1-feed',     state:'x1', points:[[796,618],[796,741]]},
  {id:'x1-return',   state:'x1', points:[[796,781],[796,825]]},
  {id:'x1-branch',   state:'x1', points:[[796,618],[959,618]]},
  {id:'ls1-contact', state:'ls1c', points:[[878,615],[878,659]]},
  {id:'mc1-feed',    state:'mc1', points:[[878,700],[878,741]]},
  {id:'mc1-return',  state:'mc1', points:[[878,781],[878,825]]},
  {id:'mc1nc-contact', state:'mc1ncFeedT1', points:[[959,618],[959,659]]},
  {id:'t1-feed',     state:'t1',  points:[[959,700],[959,741]]},
  {id:'t1-return',   state:'t1',  points:[[959,781],[959,825]]},

  // X2 계열: PB2 | X2(자기유지) | T1(완료) 3중 병렬 -> X2코일 -> MC2(직결, LS2 불필요)
  //          -> LS2는 T2 타이머만 인에이블
  {id:'pb2-contact', state:'pb2c',   points:[[1041,289],[1041,333]]},
  {id:'x2-self-contact', state:'x2selfc', points:[[1122,289],[1122,333]]},
  {id:'t1-self-contact', state:'t1selfc', points:[[1203,289],[1203,333]]},
  {id:'x2-merge-bridge', state:'x2', points:[[1041,373],[1203,373]]},
  {id:'x2-common',   state:'x2', points:[[1041,373],[1041,618]]},
  {id:'x2-feed',     state:'x2', points:[[1041,618],[1041,741]]},
  {id:'x2-return',   state:'x2', points:[[1041,781],[1041,825]]},
  {id:'x2-to-mc2',   state:'x2', points:[[1041,618],[1122,618]]},
  {id:'mc2-feed',    state:'mc2', points:[[1122,618],[1122,741]]},
  {id:'mc2-return',  state:'mc2', points:[[1122,781],[1122,825]]},
  {id:'x2-to-ls2',   state:'x2', points:[[1041,618],[1203,618]]},
  {id:'ls2-contact', state:'x2ls2FeedT2', points:[[1203,615],[1203,659]]},
  {id:'t2-feed',     state:'t2',  points:[[1203,700],[1203,741]]},
  {id:'t2-return',   state:'t2',  points:[[1203,781],[1203,825]]},

  // WL: M00003(X1&&!MC1) OR M00004(X2&&LS2) — 화면상 "T1/T2"로 표기된 병렬접점
  {id:'wl-t1-contact', state:'mc1ncFeedT1', points:[[1285,289],[1285,333]]},
  {id:'wl-t2-contact', state:'x2ls2FeedT2', points:[[1366,289],[1366,333]]},
  {id:'wl-merge-bridge', state:'wl', points:[[1285,373],[1366,373]]},
  {id:'wl-feed',        state:'wl', points:[[1285,373],[1285,741]]},
  {id:'wl-return',      state:'wl', points:[[1285,781],[1285,825]]},

  {id:'mc1-aux-rl',  state:'mc1', points:[[1448,289],[1448,741]]},
  {id:'rl-return',   state:'mc1', points:[[1448,781],[1448,825]]},
  {id:'mc2-aux-gl',  state:'mc2', points:[[1529,289],[1529,741]]},
  {id:'gl-return',   state:'mc2', points:[[1529,781],[1529,825]]},
];



// ==================== 도면 13 ====================
// X1 = common&&(PB1||X1자신||LS1)&&!T2완료. MC1은 X1&&LS2(교차).
// X2 = common&&(PB2||X2자신||T1완료). MC2는 X2 직결(무조건). T2인에이블=X2&&X1(둘다 필요).
function diagram13FlowStates(){
  const x1=overlayTerminalOn(dlrResolve(13,'X1')), x2=overlayTerminalOn(dlrResolve(13,'X2'));
  const t1=overlayTerminalOn(dlrResolve(13,'T1')), t2=overlayTerminalOn(dlrResolve(13,'T2'));
  const mc1=overlayTerminalOn(dlrResolve(13,'MC1')), mc2=overlayTerminalOn(dlrResolve(13,'MC2'));
  const wl=overlayTerminalOn(dlrResolve(13,'WL'));
  const controlPower=true, eocrNormal=!ui.eocr, eocrTrip=!!ui.eocr;
  const common = !ui.eocr && !ui.pb0;
  const pb1c = common && !!ui.pb1;
  const x1selfc = common && x1;
  const ls1c = common && !!ui.ls1;
  const ls2c = x1 && !!ui.ls2;         // MC1은 LS2로 게이트(교차)
  const mc1ncFeedT1 = x1 && !mc1;      // 대기표시용 M00003
  const pb2c = common && !!ui.pb2;
  const x2selfc = common && x2;
  const t1selfc = common && t1;
  const x1FeedT2 = x2 && x1;           // T2 인에이블 = X2&&X1 (M00004)
  return { controlPower, eocrNormal, eocrTrip, common, pb1c, x1selfc, ls1c, ls2c, mc1ncFeedT1,
           pb2c, x2selfc, t1selfc, x1FeedT2, x1, x2, t1, t2, mc1, mc2, wl };
}

const DIAGRAM13_REAL_FLOW = [
  {id:'feed-pre',    state:'controlPower', points:[[489,292],[634,292]]},
  {id:'feed-eocr-pb0', state:'eocrNormal', points:[[634,292],[715,292]]},
  {id:'feed-common', state:'common', points:[[715,292],[1529,292]]},
  {id:'return-bus',  state:'controlPower', points:[[489,822],[1529,822]]},

  {id:'eocr-feed',   state:'controlPower', points:[[593,288],[593,741]]},
  {id:'eocr-return', state:'controlPower', points:[[593,781],[593,825]]},
  {id:'yl-feed',     state:'eocrTrip', points:[[674,618],[674,741]]},
  {id:'yl-return',   state:'eocrTrip', points:[[674,781],[674,825]]},

  {id:'pb1-contact', state:'pb1c',   points:[[796,289],[796,333]]},
  {id:'x1-self-contact', state:'x1selfc', points:[[878,289],[878,333]]},
  {id:'ls1-contact', state:'ls1c', points:[[959,289],[959,333]]},
  {id:'x1-merge-bridge', state:'x1', points:[[796,373],[959,373]]},
  {id:'x1-common',   state:'x1', points:[[796,373],[796,741]]},
  {id:'x1-return',   state:'x1', points:[[796,781],[796,825]]},
  {id:'x1-branch',   state:'x1', points:[[796,536],[959,536]]},
  {id:'ls2-contact', state:'ls2c', points:[[878,615],[878,659]]},
  {id:'mc1-feed',    state:'mc1', points:[[878,700],[878,741]]},
  {id:'mc1-return',  state:'mc1', points:[[878,781],[878,825]]},
  {id:'mc1nc-contact', state:'mc1ncFeedT1', points:[[959,618],[959,659]]},
  {id:'t1-feed',     state:'t1',  points:[[959,700],[959,741]]},
  {id:'t1-return',   state:'t1',  points:[[959,781],[959,825]]},

  {id:'pb2-contact', state:'pb2c',   points:[[1041,289],[1041,333]]},
  {id:'x2-self-contact', state:'x2selfc', points:[[1122,289],[1122,333]]},
  {id:'t1-self-contact', state:'t1selfc', points:[[1203,289],[1203,333]]},
  {id:'x2-merge-bridge', state:'x2', points:[[1041,373],[1203,373]]},
  {id:'x2-common',   state:'x2', points:[[1041,373],[1041,741]]},
  {id:'x2-return',   state:'x2', points:[[1041,781],[1041,825]]},
  {id:'x2-to-mc2',   state:'x2', points:[[1041,618],[1122,618]]},
  {id:'mc2-feed',    state:'mc2', points:[[1122,700],[1122,741]]},
  {id:'mc2-return',  state:'mc2', points:[[1122,781],[1122,825]]},
  {id:'x2-to-t2',    state:'x1FeedT2', points:[[1041,618],[1203,618]]},
  {id:'t2-feed',     state:'t2',  points:[[1203,700],[1203,741]]},
  {id:'t2-return',   state:'t2',  points:[[1203,781],[1203,825]]},

  {id:'wl-t1-contact', state:'mc1ncFeedT1', points:[[1285,289],[1285,333]]},
  {id:'wl-t2-contact', state:'x1FeedT2', points:[[1366,289],[1366,333]]},
  {id:'wl-merge-bridge', state:'wl', points:[[1285,373],[1366,373]]},
  {id:'wl-feed',        state:'wl', points:[[1285,373],[1285,741]]},
  {id:'wl-return',      state:'wl', points:[[1285,781],[1285,825]]},

  {id:'mc1-aux-rl',  state:'mc1', points:[[1448,289],[1448,741]]},
  {id:'rl-return',   state:'mc1', points:[[1448,781],[1448,825]]},
  {id:'mc2-aux-gl',  state:'mc2', points:[[1529,289],[1529,741]]},
  {id:'gl-return',   state:'mc2', points:[[1529,781],[1529,825]]},
];



// ==================== 도면 14 ====================
// X1=common&&LS1, X2=common&&LS2 (단순 직결 게이트, 자기유지 아님).
// MC1=common&&(PB1||자기유지)&&X1&&X2&&!T1완료 (LS1,LS2 둘다 필요).
// MC2=common&&(PB2||자기유지)&&(X1||X2)&&!T2완료 (LS1,LS2 둘중 하나).
// WL=common&&!MC1&&!MC2 (둘다 정지중 표시).
function diagram14FlowStates(){
  const x1=overlayTerminalOn(dlrResolve(14,'X1')), x2=overlayTerminalOn(dlrResolve(14,'X2'));
  const t1=overlayTerminalOn(dlrResolve(14,'T1')), t2=overlayTerminalOn(dlrResolve(14,'T2'));
  const mc1=overlayTerminalOn(dlrResolve(14,'MC1')), mc2=overlayTerminalOn(dlrResolve(14,'MC2'));
  const wl=overlayTerminalOn(dlrResolve(14,'WL'));
  const m3 = !!plc.get('M00003'), m4 = !!plc.get('M00004');
  const controlPower=true, eocrNormal=!ui.eocr, eocrTrip=!!ui.eocr;
  const common = !ui.eocr && !ui.pb0;
  const ls1c = common && !!ui.ls1;
  const ls2c = common && !!ui.ls2;
  const manualBranch1 = common && (!!ui.pb1 || m3);
  const x1x2gate1 = manualBranch1 && x1 && x2;
  const manualBranch2 = common && (!!ui.pb2 || m4);
  const x1orx2gate2 = manualBranch2 && (x1 || x2);
  const mc1ncFeedWl = common && !mc1;
  return { controlPower, eocrNormal, eocrTrip, common, ls1c, ls2c, manualBranch1, x1x2gate1,
           manualBranch2, x1orx2gate2, mc1ncFeedWl, x1, x2, t1, t2, mc1, mc2, wl };
}

const DIAGRAM14_REAL_FLOW = [
  {id:'feed-pre',    state:'controlPower', points:[[489,292],[634,292]]},
  {id:'feed-eocr-pb0', state:'eocrNormal', points:[[634,292],[715,292]]},
  {id:'feed-common', state:'common', points:[[715,292],[1448,292]]},
  {id:'return-bus',  state:'controlPower', points:[[489,822],[1448,822]]},

  {id:'eocr-feed',   state:'controlPower', points:[[593,288],[593,741]]},
  {id:'eocr-return', state:'controlPower', points:[[593,781],[593,825]]},
  {id:'yl-feed',     state:'eocrTrip', points:[[674,373],[674,741]]},
  {id:'yl-return',   state:'eocrTrip', points:[[674,781],[674,825]]},

  {id:'ls1-contact', state:'ls1c', points:[[796,289],[796,333]]},
  {id:'x1-feed',     state:'ls1c', points:[[796,373],[796,741]]},
  {id:'x1-return',   state:'x1',   points:[[796,781],[796,825]]},
  {id:'ls2-contact', state:'ls2c', points:[[878,289],[878,333]]},
  {id:'x2-feed',     state:'ls2c', points:[[878,373],[878,741]]},
  {id:'x2-return',   state:'x2',   points:[[878,781],[878,825]]},

  {id:'pb1-contact', state:'manualBranch1', points:[[959,289],[959,333]]},
  {id:'t1-self-contact', state:'manualBranch1', points:[[1041,289],[1041,333]]},
  {id:'mc1-merge-bridge', state:'manualBranch1', points:[[959,373],[1041,373]]},
  {id:'mc1-common',  state:'manualBranch1', points:[[959,373],[959,496]]},
  {id:'x1-contact-mc1', state:'manualBranch1', points:[[959,496],[959,537]]},
  {id:'x2-contact-mc1', state:'x1x2gate1', points:[[959,577],[959,618]]},
  {id:'mc1-feed',    state:'mc1', points:[[959,659],[959,741]]},
  {id:'mc1-return',  state:'mc1', points:[[959,781],[959,825]]},
  {id:'mc1-to-t1-bridge', state:'mc1', points:[[959,618],[1041,618]]},
  {id:'t1-feed',     state:'t1', points:[[1041,700],[1041,741]]},
  {id:'t1-return',   state:'t1', points:[[1041,781],[1041,825]]},

  {id:'pb2-contact', state:'manualBranch2', points:[[1203,289],[1203,333]]},
  {id:'t2-self-contact', state:'manualBranch2', points:[[1285,289],[1285,333]]},
  {id:'mc2-merge-bridge', state:'manualBranch2', points:[[1203,373],[1285,373]]},
  {id:'mc2-common',  state:'manualBranch2', points:[[1203,373],[1203,496]]},
  {id:'x1-contact-mc2', state:'manualBranch2', points:[[1203,496],[1203,618]]},
  {id:'x2-contact-mc2', state:'manualBranch2', points:[[1285,496],[1285,537]]},
  {id:'mc2-feed',    state:'mc2', points:[[1203,659],[1203,741]]},
  {id:'mc2-return',  state:'mc2', points:[[1203,781],[1203,825]]},
  {id:'mc2-to-t2-bridge', state:'mc2', points:[[1203,618],[1285,618]]},
  {id:'t2-feed',     state:'t2', points:[[1285,700],[1285,741]]},
  {id:'t2-return',   state:'t2', points:[[1285,781],[1285,825]]},

  {id:'rl-feed',     state:'mc1', points:[[1122,289],[1122,741]]},
  {id:'rl-return',   state:'mc1', points:[[1122,781],[1122,825]]},
  {id:'gl-feed',     state:'mc2', points:[[1366,289],[1366,741]]},
  {id:'gl-return',   state:'mc2', points:[[1366,781],[1366,825]]},

  {id:'wl-mc1nc',    state:'common', points:[[1448,373],[1448,414]]},
  {id:'wl-mc2nc',    state:'mc1ncFeedWl', points:[[1448,455],[1448,741]]},
  {id:'wl-return',   state:'wl', points:[[1448,781],[1448,825]]},
];



// ==================== 도면 15 ====================
// X1=common&&LS1, X2=common&&LS2 (도면14와 동일한 단순 게이트).
// MC1=common&&((PB1&&(X1 OR X2))||자기유지)&&!T1완료 — X1/X2 병렬.
// MC2=common&&((PB2&&X1&&X2)||자기유지)&&!T2완료 — X1/X2 직렬(도면14와 반대).
// WL=common&&!MC1&&!MC2.
function diagram15FlowStates(){
  const x1=overlayTerminalOn(dlrResolve(15,'X1')), x2=overlayTerminalOn(dlrResolve(15,'X2'));
  const t1=overlayTerminalOn(dlrResolve(15,'T1')), t2=overlayTerminalOn(dlrResolve(15,'T2'));
  const mc1=overlayTerminalOn(dlrResolve(15,'MC1')), mc2=overlayTerminalOn(dlrResolve(15,'MC2'));
  const wl=overlayTerminalOn(dlrResolve(15,'WL'));
  const m3 = !!plc.get('M00003'), m4 = !!plc.get('M00004');
  const controlPower=true, eocrNormal=!ui.eocr, eocrTrip=!!ui.eocr;
  const common = !ui.eocr && !ui.pb0;
  const ls1c = common && !!ui.ls1;
  const ls2c = common && !!ui.ls2;
  const pb1c = common && !!ui.pb1;
  const pb1x1orx2 = pb1c && (x1 || x2);       // MC1측: PB1 뒤 X1 OR X2(병렬)
  const mc1selfOr = pb1x1orx2 || m3;
  const pb2c = common && !!ui.pb2;
  const pb2x1andx2 = pb2c && x1 && x2;        // MC2측: PB2 뒤 X1 AND X2(직렬)
  const mc2selfOr = pb2x1andx2 || m4;
  const mc1ncFeedWl = common && !mc1;
  return { controlPower, eocrNormal, eocrTrip, common, ls1c, ls2c, pb1c, pb1x1orx2, mc1selfOr,
           pb2c, pb2x1andx2, mc2selfOr, mc1ncFeedWl, x1, x2, t1, t2, mc1, mc2, wl };
}

const DIAGRAM15_REAL_FLOW = [
  {id:'feed-pre',    state:'controlPower', points:[[489,292],[634,292]]},
  {id:'feed-eocr-pb0', state:'eocrNormal', points:[[634,292],[715,292]]},
  {id:'feed-common', state:'common', points:[[715,292],[1529,292]]},
  {id:'return-bus',  state:'controlPower', points:[[489,822],[1529,822]]},

  {id:'eocr-feed',   state:'controlPower', points:[[593,288],[593,741]]},
  {id:'eocr-return', state:'controlPower', points:[[593,781],[593,825]]},
  {id:'yl-feed',     state:'eocrTrip', points:[[674,373],[674,741]]},
  {id:'yl-return',   state:'eocrTrip', points:[[674,781],[674,825]]},

  {id:'ls1-contact', state:'ls1c', points:[[796,289],[796,333]]},
  {id:'x1-feed',     state:'ls1c', points:[[796,373],[796,741]]},
  {id:'x1-return',   state:'x1',   points:[[796,781],[796,825]]},
  {id:'ls2-contact', state:'ls2c', points:[[878,289],[878,333]]},
  {id:'x2-feed',     state:'ls2c', points:[[878,373],[878,741]]},
  {id:'x2-return',   state:'x2',   points:[[878,781],[878,825]]},

  // MC1 계열: PB1 -> X1/X2 병렬 -> 병합 -> T1자기유지OR -> MC1코일/T1코일
  {id:'pb1-contact', state:'pb1c', points:[[959,289],[959,333]]},
  {id:'x1-contact-mc1', state:'pb1c', points:[[959,373],[959,414]]},
  {id:'x2-contact-mc1', state:'pb1c', points:[[1041,373],[1041,414]]},
  {id:'mc1-parallel-merge', state:'pb1x1orx2', points:[[959,455],[1041,455]]},
  {id:'mc1-common',  state:'mc1selfOr', points:[[959,496],[959,618]]},
  {id:'mc1-feed',    state:'mc1', points:[[959,659],[959,741]]},
  {id:'mc1-return',  state:'mc1', points:[[959,781],[959,825]]},
  {id:'mc1-to-t1-bridge', state:'mc1selfOr', points:[[959,618],[1041,618]]},
  {id:'t1-feed',     state:'t1', points:[[1041,700],[1041,741]]},
  {id:'t1-return',   state:'t1', points:[[1041,781],[1041,825]]},

  // MC2 계열: PB2 -> X1 -> X2 직렬 -> T2자기유지OR -> MC2코일/T2코일
  {id:'pb2-contact', state:'pb2c', points:[[1285,289],[1285,333]]},
  {id:'x1-contact-mc2', state:'pb2c', points:[[1285,373],[1285,414]]},
  {id:'x2-contact-mc2', state:'pb2x1andx2', points:[[1285,455],[1285,496]]},
  {id:'mc2-common',  state:'mc2selfOr', points:[[1285,536],[1285,618]]},
  {id:'mc2-feed',    state:'mc2', points:[[1285,659],[1285,741]]},
  {id:'mc2-return',  state:'mc2', points:[[1285,781],[1285,825]]},
  {id:'mc2-to-t2-bridge', state:'mc2selfOr', points:[[1285,618],[1366,618]]},
  {id:'t2-feed',     state:'t2', points:[[1366,700],[1366,741]]},
  {id:'t2-return',   state:'t2', points:[[1366,781],[1366,825]]},

  {id:'rl-feed',     state:'mc1', points:[[1203,289],[1203,741]]},
  {id:'rl-return',   state:'mc1', points:[[1203,781],[1203,825]]},
  {id:'gl-feed',     state:'mc2', points:[[1448,289],[1448,741]]},
  {id:'gl-return',   state:'mc2', points:[[1448,781],[1448,825]]},

  {id:'wl-mc1nc',    state:'common', points:[[1529,373],[1529,414]]},
  {id:'wl-mc2nc',    state:'mc1ncFeedWl', points:[[1529,455],[1529,741]]},
  {id:'wl-return',   state:'wl', points:[[1529,781],[1529,825]]},
];



// ==================== 도면 4 ====================
// 도면 1~3과 같은 SS 자동/수동 구조. X = (A&&FLS) OR (M&&PB0안눌림&&(PB1||자기유지)).
// FR은 "긴FR"(T0003, 14초 주기) 타이머로 대체되었고, MC1/MC2는 그 경과시간 구간으로 결정.
function diagram4FlowStates(){
  const x=overlayTerminalOn(dlrResolve(4,'X'));
  const fr=overlayTerminalOn(dlrResolve(4,'FR'));
  const mc1=overlayTerminalOn(dlrResolve(4,'MC1')), mc2=overlayTerminalOn(dlrResolve(4,'MC2'));
  const t=overlayTerminalOn(dlrResolve(4,'T'));
  const fls=!!ui.fls;
  const controlPower=true, eocrNormal=!ui.eocr, eocrTrip=!!ui.eocr;
  const ssAuto = !ui.eocr && !!ui.ss;
  const ssManual = !ui.eocr && !ui.ss;
  const autoBranch = ssAuto && !!ui.fls;
  const manualPastPB0 = ssManual && !ui.pb0;
  const manualBranch = manualPastPB0 && (!!ui.pb1 || x);
  const merged = autoBranch || manualBranch;
  return { controlPower, eocrNormal, eocrTrip, ssAuto, ssManual, autoBranch,
           manualPastPB0, manualBranch, merged, x, fr, mc1, mc2, t, fls };
}

const DIAGRAM4_REAL_FLOW = [
  {id:'feed-pre',    state:'controlPower', points:[[511,292],[634,292]]},
  {id:'feed-normal', state:'eocrNormal',   points:[[674,292],[1570,292]]},
  {id:'return-bus',  state:'controlPower', points:[[511,822],[1570,822]]},

  {id:'eocr-feed',   state:'eocrTrip', points:[[593,288],[593,741]]},
  {id:'eocr-return', state:'eocrTrip', points:[[593,781],[593,825]]},
  {id:'yl-branch',   state:'eocrTrip', points:[[589,536],[674,536]]},
  {id:'yl-feed',     state:'eocrTrip', points:[[674,618],[674,741]]},
  {id:'yl-return',   state:'eocrTrip', points:[[674,781],[674,825]]},
  {id:'bz-branch',   state:'eocrTrip', points:[[671,659],[756,659]]},
  {id:'bz-feed',     state:'eocrTrip', points:[[756,659],[756,825]]},

  {id:'auto-a',      state:'ssAuto',     points:[[1000,288],[1000,333]]},
  {id:'auto-fls',    state:'autoBranch', points:[[1000,373],[1000,618]]},
  {id:'merge-bridge', state:'merged',    points:[[997,618],[1089,618]]},
  {id:'fr-feed',     state:'fr',  points:[[1000,618],[1000,741]]},
  {id:'fr-return',   state:'fr',  points:[[1000,781],[1000,825]]},

  {id:'manual-m',    state:'ssManual',      points:[[1081,288],[1081,333]]},
  {id:'manual-pb0',  state:'ssManual',      points:[[1081,373],[1081,414]]},
  {id:'manual-pb0-out', state:'manualPastPB0', points:[[1081,455],[1081,537]]},
  {id:'manual-pb1hold', state:'manualBranch',  points:[[1081,577],[1081,618]]},
  {id:'x-feed',      state:'x', points:[[1081,618],[1081,741]]},
  {id:'x-return',    state:'x', points:[[1081,781],[1081,825]]},

  {id:'x-contact',   state:'x', points:[[1244,289],[1244,333]]},
  {id:'mc1-feed',    state:'mc1', points:[[1244,373],[1244,741]]},
  {id:'mc1-return',  state:'mc1', points:[[1244,781],[1244,825]]},
  {id:'x-to-mc2-bridge', state:'x', points:[[1244,496],[1326,496]]},
  {id:'mc2-feed',    state:'mc2', points:[[1326,537],[1326,741]]},
  {id:'mc2-return',  state:'mc2', points:[[1326,781],[1326,825]]},
  {id:'mc2-to-t-bridge', state:'t', points:[[1326,618],[1407,618]]},
  {id:'t-feed',      state:'t', points:[[1407,618],[1407,741]]},
  {id:'t-return',    state:'t', points:[[1407,781],[1407,825]]},

  {id:'rl-feed',    state:'mc1', points:[[1489,289],[1489,741]]},
  {id:'rl-return',  state:'mc1', points:[[1489,781],[1489,825]]},
  {id:'gl-feed',    state:'mc2', points:[[1570,293],[1570,741]]},
  {id:'gl-return',  state:'mc2', points:[[1570,781],[1570,825]]},
];



// ==================== 도면 5 ====================
// 도면 1~4와 같은 SS 자동/수동 구조지만 상단 공통선이 y=251(다른 도면보다 41px 위).
// X=(A&&FLS)OR(M&&!PB0&&(PB1||자기유지)). T는 X와 동일하게 바로 여자.
// FR은 T·T0000 모두 완료 전까지만 돎, MC1은 FR구간1, MC2는 FR구간2 OR T완료.
function diagram5FlowStates(){
  const x=overlayTerminalOn(dlrResolve(5,'X'));
  const t=overlayTerminalOn(dlrResolve(5,'T'));
  const fr=overlayTerminalOn(dlrResolve(5,'FR'));
  const mc1=overlayTerminalOn(dlrResolve(5,'MC1')), mc2=overlayTerminalOn(dlrResolve(5,'MC2'));
  const fls=!!ui.fls;
  const controlPower=true, eocrNormal=!ui.eocr, eocrTrip=!!ui.eocr;
  const ssAuto = !ui.eocr && !!ui.ss;
  const ssManual = !ui.eocr && !ui.ss;
  const autoBranch = ssAuto && !!ui.fls;
  const manualPastPB0 = ssManual && !ui.pb0;
  const manualBranch = manualPastPB0 && (!!ui.pb1 || x);
  const merged = autoBranch || manualBranch;
  return { controlPower, eocrNormal, eocrTrip, ssAuto, ssManual, autoBranch,
           manualPastPB0, manualBranch, merged, x, t, fr, mc1, mc2, fls };
}

const DIAGRAM5_REAL_FLOW = [
  {id:'feed-pre',    state:'controlPower', points:[[489,251],[593,251]]},
  {id:'feed-normal', state:'eocrNormal',   points:[[593,251],[1570,251]]},
  {id:'return-bus',  state:'controlPower', points:[[489,822],[1570,822]]},

  {id:'eocr-feed',   state:'eocrTrip', points:[[593,247],[593,741]]},
  {id:'eocr-return', state:'eocrTrip', points:[[593,781],[593,825]]},
  {id:'yl-feed',     state:'eocrTrip', points:[[674,577],[674,741]]},
  {id:'yl-return',   state:'eocrTrip', points:[[674,781],[674,825]]},
  {id:'bz-feed',     state:'eocrTrip', points:[[756,577],[756,741]]},
  {id:'bz-return',   state:'eocrTrip', points:[[756,781],[756,825]]},

  // 자동(A) 경로: A -> FLS 접점(직렬) -> 병합버스
  {id:'auto-a',      state:'ssAuto',     points:[[837,248],[837,292]]},
  {id:'auto-fls',    state:'autoBranch', points:[[837,332],[837,577]]},

  // 수동(M) 경로: M -> PB0 -> PB1/자기유지 -> 병합버스
  {id:'manual-m',    state:'ssManual',      points:[[1081,248],[1081,292]]},
  {id:'manual-pb0',  state:'ssManual',      points:[[1081,332],[1081,374]]},
  {id:'manual-pb0-out', state:'manualPastPB0', points:[[1081,414],[1081,496]]},
  {id:'manual-pb1hold', state:'manualBranch',  points:[[1081,536],[1081,577]]},

  // 병합 버스(자동 OR 수동) -> X/T/FR/MC1/MC2 코일로 각각 분기
  {id:'merge-bus',   state:'merged', points:[[837,577],[1407,577]]},
  {id:'fls-lamp',    state:'fls', points:[[837,577],[837,741]]},
  {id:'x-feed',      state:'x',  points:[[1000,577],[1000,741]]},
  {id:'x-return',    state:'x',  points:[[1000,781],[1000,825]]},
  {id:'t-feed',      state:'t',  points:[[1081,577],[1081,741]]},
  {id:'t-return',    state:'t',  points:[[1081,781],[1081,825]]},
  {id:'fr-feed',     state:'fr', points:[[1163,577],[1163,741]]},
  {id:'fr-return',   state:'fr', points:[[1163,781],[1163,825]]},
  {id:'mc1-feed',    state:'mc1', points:[[1244,577],[1244,741]]},
  {id:'mc1-return',  state:'mc1', points:[[1244,781],[1244,825]]},
  {id:'mc2-feed',    state:'mc2', points:[[1326,577],[1326,741]]},
  {id:'mc2-return',  state:'mc2', points:[[1326,781],[1326,825]]},
  {id:'rl-feed',     state:'mc1', points:[[1489,248],[1489,741]]},
  {id:'rl-return',   state:'mc1', points:[[1489,781],[1489,825]]},
  {id:'gl-feed',     state:'mc2', points:[[1570,251],[1570,741]]},
  {id:'gl-return',   state:'mc2', points:[[1570,781],[1570,825]]},
];



// ==================== 도면 9 ====================
// BZ=EOCR&&FR구간1, YL=EOCR&&FR구간2(트립 점멸, 순서만 다름).
// merged = !EOCR&&(X이전값||(A&&FLS)) -> MC1 직결(!). X 자신은 수동값으로 덮어써짐(M&&!PB0&&(PB1||X이전)).
// T=X(수동값)와 동일. MC2 = !EOCR&&T완료.
function diagram9FlowStates(){
  const x=overlayTerminalOn(dlrResolve(9,'X'));
  const fr=overlayTerminalOn(dlrResolve(9,'FR'));
  const yl=overlayTerminalOn(dlrResolve(9,'YL')), bz=overlayTerminalOn(dlrResolve(9,'BZ'));
  const mc1=overlayTerminalOn(dlrResolve(9,'MC1')), mc2=overlayTerminalOn(dlrResolve(9,'MC2'));
  const t=overlayTerminalOn(dlrResolve(9,'T'));
  const fls=!!ui.fls;
  const controlPower=true, eocrNormal=!ui.eocr, eocrTrip=!!ui.eocr;
  const ssAuto = !ui.eocr && !!ui.ss;
  const ssManual = !ui.eocr && !ui.ss;
  const autoBranch = ssAuto && !!ui.fls;
  // merged: X(자기 자신, 수동값)의 현재값 OR 자동분기 -> MC1 직결
  const merged = !ui.eocr && (x || autoBranch);
  const manualPastPB0 = ssManual && !ui.pb0;
  const manualBranch = manualPastPB0 && (!!ui.pb1 || x);  // X 자신을 이 값으로 덮어씀
  return { controlPower, eocrNormal, eocrTrip, ssAuto, ssManual, autoBranch, merged,
           manualPastPB0, manualBranch, x, fr, yl, bz, mc1, mc2, t, fls };
}

const DIAGRAM9_REAL_FLOW = [
  {id:'feed-pre',    state:'controlPower', points:[[511,292],[634,292]]},
  {id:'feed-normal', state:'eocrNormal',   points:[[674,292],[1570,292]]},
  {id:'return-bus',  state:'controlPower', points:[[511,822],[1570,822]]},

  {id:'eocr-feed',   state:'eocrTrip', points:[[593,288],[593,741]]},
  {id:'eocr-return', state:'eocrTrip', points:[[593,781],[593,825]]},
  {id:'fr-branch',   state:'eocrTrip', points:[[589,536],[674,536]]},
  {id:'fr-feed',     state:'eocrTrip', points:[[674,618],[674,741]]},
  {id:'fr-return',   state:'eocrTrip', points:[[674,781],[674,825]]},
  {id:'yl-branch',   state:'eocrTrip', points:[[671,659],[756,659]]},
  {id:'yl-feed',     state:'eocrTrip', points:[[756,659],[756,825]]},

  // X 자기참조(직전 수동값) + A/FLS 자동분기 -> merged -> MC1 직결
  {id:'x-self-contact', state:'x', points:[[1000,289],[1000,333]]},
  {id:'auto-a',      state:'ssAuto',     points:[[1082,373],[1082,414]]},
  {id:'auto-fls',    state:'autoBranch', points:[[1082,455],[1082,537]]},
  {id:'x-fls-merge-bridge', state:'merged', points:[[1000,537],[1082,537]]},
  {id:'x-common',    state:'x', points:[[1000,373],[1000,537]]},
  {id:'mc1-feed',    state:'merged', points:[[1000,577],[1000,741]]},
  {id:'mc1-return',  state:'mc1', points:[[1000,781],[1000,825]]},
  {id:'fls-lamp',    state:'fls', points:[[1082,577],[1082,741]]},

  // 수동(M) 경로: M -> PB0 -> PB1/자기유지 -> X코일(덮어씀) / T코일
  {id:'manual-m',    state:'ssManual',      points:[[1244,289],[1244,333]]},
  {id:'manual-pb0',  state:'ssManual',      points:[[1244,373],[1244,414]]},
  {id:'manual-pb0-out', state:'manualPastPB0', points:[[1244,455],[1244,537]]},
  {id:'manual-pb1hold', state:'manualBranch',  points:[[1244,577],[1244,741]]},
  {id:'x-feed',      state:'x', points:[[1244,781],[1244,825]]},
  {id:'manual-to-t-bridge', state:'x', points:[[1244,496],[1326,496]]},
  {id:'t-feed',      state:'t', points:[[1326,577],[1326,618]]},
  {id:'t-coil',      state:'t', points:[[1326,700],[1326,741]]},
  {id:'t-return',    state:'t', points:[[1326,781],[1326,825]]},

  {id:'mc2-feed',    state:'mc2', points:[[1407,288],[1407,741]]},
  {id:'mc2-return',  state:'mc2', points:[[1407,781],[1407,825]]},
  {id:'rl-feed',     state:'mc1', points:[[1489,289],[1489,741]]},
  {id:'rl-return',   state:'mc1', points:[[1489,781],[1489,825]]},
  {id:'gl-feed',     state:'mc2', points:[[1570,293],[1570,741]]},
  {id:'gl-return',   state:'mc2', points:[[1570,781],[1570,825]]},
];



// ==================== 도면 16 ====================
// X1=common&&(PB1||X1자신||T1완료), MC1=X1(동일). LS1/LS2 각각 T1/T2 인에이블 플래그(M3/M4).
// X2 = (common&&(PB2||X2자신||M4)) && M3(T1인에이블 플래그 필요!). MC2=X2branch&&!T2완료. WL=X2branch&&T2완료.
function diagram16FlowStates(){
  const x1=overlayTerminalOn(dlrResolve(16,'X1')), x2=overlayTerminalOn(dlrResolve(16,'X2'));
  const t1=overlayTerminalOn(dlrResolve(16,'T1')), t2=overlayTerminalOn(dlrResolve(16,'T2'));
  const mc1=overlayTerminalOn(dlrResolve(16,'MC1')), mc2=overlayTerminalOn(dlrResolve(16,'MC2'));
  const wl=overlayTerminalOn(dlrResolve(16,'WL'));
  const m3=!!plc.get('M00003');
  const controlPower=true, eocrNormal=!ui.eocr, eocrTrip=!!ui.eocr;
  const common = !ui.eocr && !ui.pb0;
  const ls1c = common && !!ui.ls1;
  const ls2c = common && !!ui.ls2;
  const pb1c = common && (!!ui.pb1 || x1);
  const pb2c = common && (!!ui.pb2 || x2);
  const x2gated = pb2c && m3;  // X2는 T1 인에이블 플래그(LS1결과)도 필요
  return { controlPower, eocrNormal, eocrTrip, common, ls1c, ls2c, pb1c, pb2c, x2gated,
           x1, x2, t1, t2, mc1, mc2, wl };
}

const DIAGRAM16_REAL_FLOW = [
  {id:'feed-pre',    state:'controlPower', points:[[489,292],[634,292]]},
  {id:'feed-eocr-pb0', state:'eocrNormal', points:[[634,292],[715,292]]},
  {id:'feed-common', state:'common', points:[[715,292],[1529,292]]},
  {id:'return-bus',  state:'controlPower', points:[[489,822],[1529,822]]},
  {id:'eocr-feed',   state:'controlPower', points:[[593,288],[593,741]]},
  {id:'eocr-return', state:'controlPower', points:[[593,781],[593,825]]},
  {id:'yl-feed',     state:'eocrTrip', points:[[674,373],[674,741]]},
  {id:'yl-return',   state:'eocrTrip', points:[[674,781],[674,825]]},

  {id:'ls1-contact', state:'ls1c', points:[[796,289],[796,333]]},
  {id:'t1-feed',     state:'ls1c', points:[[796,373],[796,741]]},
  {id:'t1-return',   state:'t1',   points:[[796,781],[796,825]]},
  {id:'ls2-contact', state:'ls2c', points:[[878,289],[878,333]]},
  {id:'t2-feed',     state:'ls2c', points:[[878,373],[878,741]]},
  {id:'t2-return',   state:'t2',   points:[[878,781],[878,825]]},

  {id:'pb1-contact', state:'pb1c', points:[[959,289],[959,741]]},
  {id:'mc1-return',  state:'mc1', points:[[959,781],[959,825]]},
  {id:'x1-feed',     state:'pb1c', points:[[1041,289],[1041,741]]},
  {id:'x1-return',   state:'x1',   points:[[1041,781],[1041,825]]},

  {id:'pb2-contact', state:'x2gated', points:[[1285,289],[1285,741]]},
  {id:'mc2-return',  state:'mc2', points:[[1285,781],[1285,825]]},
  {id:'x2-feed',     state:'x2gated', points:[[1448,289],[1448,741]]},
  {id:'x2-return',   state:'x2',   points:[[1448,781],[1448,825]]},

  {id:'rl-feed',     state:'mc1', points:[[1203,289],[1203,741]]},
  {id:'rl-return',   state:'mc1', points:[[1203,781],[1203,825]]},
  {id:'wl-feed',     state:'wl',  points:[[1366,289],[1366,741]]},
  {id:'wl-return',   state:'wl',  points:[[1366,781],[1366,825]]},
  {id:'gl-feed',     state:'mc2', points:[[1529,289],[1529,741]]},
  {id:'gl-return',   state:'mc2', points:[[1529,781],[1529,825]]},
];



// ==================== 도면 17 ====================
// X1=common&&LS1, X2=common&&LS2(단순 게이트). MC1=수동1&&XOR(X1,X2) — 둘 중 정확히 하나만!
// MC2=수동2&&T1완료&&!T2완료. WL=수동2&&T1완료&&T2완료.
function diagram17FlowStates(){
  const x1=overlayTerminalOn(dlrResolve(17,'X1')), x2=overlayTerminalOn(dlrResolve(17,'X2'));
  const t1=overlayTerminalOn(dlrResolve(17,'T1')), t2=overlayTerminalOn(dlrResolve(17,'T2'));
  const mc1=overlayTerminalOn(dlrResolve(17,'MC1')), mc2=overlayTerminalOn(dlrResolve(17,'MC2'));
  const wl=overlayTerminalOn(dlrResolve(17,'WL'));
  const m3=!!plc.get('M00003');
  const controlPower=true, eocrNormal=!ui.eocr, eocrTrip=!!ui.eocr;
  const common = !ui.eocr && !ui.pb0;
  const ls1c = common && !!ui.ls1;
  const ls2c = common && !!ui.ls2;
  const manualBranch1 = common && (!!ui.pb1 || m3);
  const xorGate = (x1 && !x2) || (!x1 && x2);
  const mc1gate = manualBranch1 && xorGate;
  const manualBranch2 = common && !!ui.pb2;
  return { controlPower, eocrNormal, eocrTrip, common, ls1c, ls2c, manualBranch1, xorGate, mc1gate,
           manualBranch2, x1, x2, t1, t2, mc1, mc2, wl };
}

const DIAGRAM17_REAL_FLOW = [
  {id:'feed-pre',    state:'controlPower', points:[[489,292],[634,292]]},
  {id:'feed-eocr-pb0', state:'eocrNormal', points:[[634,292],[715,292]]},
  {id:'feed-common', state:'common', points:[[715,292],[1448,292]]},
  {id:'return-bus',  state:'controlPower', points:[[489,822],[1448,822]]},
  {id:'eocr-feed',   state:'controlPower', points:[[593,288],[593,741]]},
  {id:'eocr-return', state:'controlPower', points:[[593,781],[593,825]]},
  {id:'yl-feed',     state:'eocrTrip', points:[[674,373],[674,741]]},
  {id:'yl-return',   state:'eocrTrip', points:[[674,781],[674,825]]},

  {id:'ls1-contact', state:'ls1c', points:[[796,289],[796,741]]},
  {id:'x1-return',   state:'x1',   points:[[796,781],[796,825]]},
  {id:'ls2-contact', state:'ls2c', points:[[878,289],[878,741]]},
  {id:'x2-return',   state:'x2',   points:[[878,781],[878,825]]},

  {id:'mc1-feed',    state:'mc1gate', points:[[959,289],[959,741]]},
  {id:'mc1-return',  state:'mc1', points:[[959,781],[959,825]]},
  {id:'t1-feed',     state:'t1',  points:[[1041,289],[1041,741]]},
  {id:'t1-return',   state:'t1',  points:[[1041,781],[1041,825]]},

  {id:'mc2-feed',    state:'mc2', points:[[1203,289],[1203,741]]},
  {id:'mc2-return',  state:'mc2', points:[[1203,781],[1203,825]]},
  {id:'t2-feed',     state:'t2',  points:[[1366,289],[1366,741]]},
  {id:'t2-return',   state:'t2',  points:[[1366,781],[1366,825]]},

  {id:'rl-feed',     state:'mc1', points:[[1122,289],[1122,741]]},
  {id:'rl-return',   state:'mc1', points:[[1122,781],[1122,825]]},
  {id:'wl-feed',     state:'wl',  points:[[1285,289],[1285,741]]},
  {id:'wl-return',   state:'wl',  points:[[1285,781],[1285,825]]},
  {id:'gl-feed',     state:'mc2', points:[[1448,289],[1448,741]]},
  {id:'gl-return',   state:'mc2', points:[[1448,781],[1448,825]]},
];



// ==================== 도면 18 ====================
// X1=common&&LS1, X2=common&&LS2(단순 게이트).
// MC1=common&&((PB1&&X1&&!X2)||자기유지) — X1만 필요, X2는 안 됨.
// MC2=common&&((PB2&&!X1&&X2)||자기유지) — X2만 필요(반대). WL=common&&(T1완료||T2완료).
function diagram18FlowStates(){
  const x1=overlayTerminalOn(dlrResolve(18,'X1')), x2=overlayTerminalOn(dlrResolve(18,'X2'));
  const t1=overlayTerminalOn(dlrResolve(18,'T1')), t2=overlayTerminalOn(dlrResolve(18,'T2'));
  const mc1=overlayTerminalOn(dlrResolve(18,'MC1')), mc2=overlayTerminalOn(dlrResolve(18,'MC2'));
  const wl=overlayTerminalOn(dlrResolve(18,'WL'));
  const m3=!!plc.get('M00003'), m4=!!plc.get('M00004');
  const controlPower=true, eocrNormal=!ui.eocr, eocrTrip=!!ui.eocr;
  const common = !ui.eocr && !ui.pb0;
  const ls1c = common && !!ui.ls1;
  const ls2c = common && !!ui.ls2;
  const pb1x1notx2 = common && !!ui.pb1 && x1 && !x2;
  const mc1gate = pb1x1notx2 || (common && m3);
  const pb2x2notx1 = common && !!ui.pb2 && x2 && !x1;
  const mc2gate = pb2x2notx1 || (common && m4);
  return { controlPower, eocrNormal, eocrTrip, common, ls1c, ls2c, pb1x1notx2, mc1gate,
           pb2x2notx1, mc2gate, x1, x2, t1, t2, mc1, mc2, wl };
}

const DIAGRAM18_REAL_FLOW = [
  {id:'feed-pre',    state:'controlPower', points:[[489,292],[634,292]]},
  {id:'feed-eocr-pb0', state:'eocrNormal', points:[[634,292],[715,292]]},
  {id:'feed-common', state:'common', points:[[715,292],[1448,292]]},
  {id:'return-bus',  state:'controlPower', points:[[489,822],[1448,822]]},
  {id:'eocr-feed',   state:'controlPower', points:[[593,288],[593,741]]},
  {id:'eocr-return', state:'controlPower', points:[[593,781],[593,825]]},
  {id:'yl-feed',     state:'eocrTrip', points:[[674,373],[674,741]]},
  {id:'yl-return',   state:'eocrTrip', points:[[674,781],[674,825]]},

  {id:'ls1-contact', state:'ls1c', points:[[796,289],[796,741]]},
  {id:'x1-return',   state:'x1',   points:[[796,781],[796,825]]},
  {id:'ls2-contact', state:'ls2c', points:[[878,289],[878,741]]},
  {id:'x2-return',   state:'x2',   points:[[878,781],[878,825]]},

  {id:'mc1-feed',    state:'mc1gate', points:[[959,289],[959,741]]},
  {id:'mc1-return',  state:'mc1', points:[[959,781],[959,825]]},
  {id:'t1-feed',     state:'t1',  points:[[1041,289],[1041,741]]},
  {id:'t1-return',   state:'t1',  points:[[1041,781],[1041,825]]},

  {id:'mc2-feed',    state:'mc2gate', points:[[1203,289],[1203,741]]},
  {id:'mc2-return',  state:'mc2', points:[[1203,781],[1203,825]]},
  {id:'t2-feed',     state:'t2',  points:[[1285,289],[1285,741]]},
  {id:'t2-return',   state:'t2',  points:[[1285,781],[1285,825]]},

  {id:'rl-feed',     state:'mc1', points:[[1122,289],[1122,741]]},
  {id:'rl-return',   state:'mc1', points:[[1122,781],[1122,825]]},
  {id:'gl-feed',     state:'mc2', points:[[1366,289],[1366,741]]},
  {id:'gl-return',   state:'mc2', points:[[1366,781],[1366,825]]},
  {id:'wl-feed',     state:'wl',  points:[[1448,289],[1448,741]]},
  {id:'wl-return',   state:'wl',  points:[[1448,781],[1448,825]]},
];



// ==================== 도면 8 ====================
// X(자동전용)=!EOCR&&SS&&FLS. FR=X&&!T0000완료. YL=X&&FR구간1(트립과 무관!).
// finalX(수동경로OR X)가 실제 T/hold/MC1/MC2를 구동 — X 표시등은 자동일 때만 켜짐(도면6과 동일 패턴).
// MC1과 MC2는 완전히 동일한 식(finalX&&!T1완료)이라 항상 같이 켜짐/꺼짐.
function diagram8FlowStates(){
  const x=overlayTerminalOn(dlrResolve(8,'X'));
  const fr=overlayTerminalOn(dlrResolve(8,'FR'));
  const yl=overlayTerminalOn(dlrResolve(8,'YL'));
  const t=overlayTerminalOn(dlrResolve(8,'T'));
  const mc1=overlayTerminalOn(dlrResolve(8,'MC1')), mc2=overlayTerminalOn(dlrResolve(8,'MC2'));
  const fls=!!ui.fls;
  const controlPower=true, eocrNormal=!ui.eocr, eocrTrip=!!ui.eocr;
  const ssAuto = !ui.eocr && !!ui.ss;
  const ssManual = !ui.eocr && !ui.ss;
  const autoBranch = ssAuto && !!ui.fls;  // X는 이 값 그대로
  const manualPastPB0 = ssManual && !ui.pb0;
  const manualBranch = manualPastPB0 && (!!ui.pb1 || x);
  const finalX = !ui.eocr && (manualBranch || x);
  return { controlPower, eocrNormal, eocrTrip, ssAuto, ssManual, autoBranch,
           manualPastPB0, manualBranch, finalX, x, fr, yl, t, mc1, mc2, fls };
}

const DIAGRAM8_REAL_FLOW = [
  {id:'feed-pre',    state:'controlPower', points:[[511,292],[634,292]]},
  {id:'feed-normal', state:'eocrNormal',   points:[[674,292],[1570,292]]},
  {id:'return-bus',  state:'controlPower', points:[[511,822],[1570,822]]},

  {id:'eocr-feed',   state:'eocrTrip', points:[[593,288],[593,746]]},
  {id:'eocr-return', state:'eocrTrip', points:[[593,781],[593,825]]},
  {id:'bz-feed',     state:'eocrTrip', points:[[674,289],[674,746]]},
  {id:'bz-return',   state:'eocrTrip', points:[[674,781],[674,825]]},
  {id:'fls-feed',    state:'fls', points:[[755,289],[755,746]]},
  {id:'fls-return',  state:'fls', points:[[755,781],[755,825]]},

  // 자동(A) 경로: A -> FLS -> X코일 직결(자동전용)
  {id:'auto-a',      state:'ssAuto',     points:[[918,289],[918,334]]},
  {id:'auto-fls',    state:'autoBranch', points:[[918,375],[918,499]]},
  {id:'auto-to-x-bridge', state:'autoBranch', points:[[837,499],[918,499]]},
  {id:'x-feed',      state:'x', points:[[837,499],[837,746]]},
  {id:'x-return',    state:'x', points:[[837,781],[837,825]]},

  // 수동(M) 경로: M -> PB0 -> PB1/자기유지 -> finalX -> X접점 -> T코일
  {id:'manual-m',    state:'ssManual',      points:[[1163,289],[1163,334]]},
  {id:'manual-pb0',  state:'ssManual',      points:[[1163,375],[1163,417]]},
  {id:'manual-pb0-out', state:'manualPastPB0', points:[[1163,457],[1163,540]]},
  {id:'manual-pb1hold', state:'manualBranch',  points:[[1163,581],[1163,619]]},
  {id:'x-contact-2', state:'finalX', points:[[1163,619],[1163,663]]},
  {id:'t-feed',      state:'t', points:[[1163,705],[1163,746]]},
  {id:'t-return',    state:'t', points:[[1163,781],[1163,825]]},

  // FR 코일 및 FR 보조접점 -> YL
  {id:'merge-to-fr', state:'finalX', points:[[918,581],[1163,581]]},
  {id:'fr-feed',     state:'fr', points:[[1000,619],[1000,746]]},
  {id:'fr-return',   state:'fr', points:[[1000,781],[1000,825]]},
  {id:'fr-to-yl-bridge', state:'yl', points:[[1000,622],[1081,622]]},
  {id:'yl-feed',     state:'yl', points:[[1081,663],[1081,746]]},
  {id:'yl-return',   state:'yl', points:[[1081,781],[1081,825]]},

  // T접점 -> MC1/MC2 (동일한 값)
  {id:'t-to-mc-bridge', state:'finalX', points:[[1163,619],[1407,619]]},
  {id:'mc1-feed',    state:'mc1', points:[[1325,663],[1325,746]]},
  {id:'mc1-return',  state:'mc1', points:[[1325,781],[1325,825]]},
  {id:'mc2-feed',    state:'mc2', points:[[1407,663],[1407,746]]},
  {id:'mc2-return',  state:'mc2', points:[[1407,781],[1407,825]]},

  {id:'rl-feed',    state:'mc1', points:[[1488,289],[1488,746]]},
  {id:'rl-return',  state:'mc1', points:[[1488,781],[1488,825]]},
  {id:'gl-feed',    state:'mc2', points:[[1570,293],[1570,746]]},
  {id:'gl-return',  state:'mc2', points:[[1570,781],[1570,825]]},
];



// ==================== 도면 7 ====================
// 도면 1~6과 같은 SS 자동/수동 구조. X=merged. FR은 "긴FR"(T0003,14초)로 대체.
// T(0001) 인에이블 = X && 긴FR구간1(0~70). MC1=that&&!T완료, MC2=that&&T완료.
function diagram7FlowStates(){
  const x=overlayTerminalOn(dlrResolve(7,'X'));
  const fr=overlayTerminalOn(dlrResolve(7,'FR'));
  const t=overlayTerminalOn(dlrResolve(7,'T'));
  const mc1=overlayTerminalOn(dlrResolve(7,'MC1')), mc2=overlayTerminalOn(dlrResolve(7,'MC2'));
  const fls=!!ui.fls;
  const controlPower=true, eocrNormal=!ui.eocr, eocrTrip=!!ui.eocr;
  const ssAuto = !ui.eocr && !!ui.ss;
  const ssManual = !ui.eocr && !ui.ss;
  const autoBranch = ssAuto && !!ui.fls;
  const manualPastPB0 = ssManual && !ui.pb0;
  const manualBranch = manualPastPB0 && (!!ui.pb1 || x);
  const merged = autoBranch || manualBranch;
  return { controlPower, eocrNormal, eocrTrip, ssAuto, ssManual, autoBranch,
           manualPastPB0, manualBranch, merged, x, fr, t, mc1, mc2, fls };
}

const DIAGRAM7_REAL_FLOW = [
  {id:'feed-pre',    state:'controlPower', points:[[511,292],[634,292]]},
  {id:'feed-normal', state:'eocrNormal',   points:[[674,292],[1570,292]]},
  {id:'return-bus',  state:'controlPower', points:[[511,822],[1570,822]]},

  {id:'eocr-feed',   state:'eocrTrip', points:[[593,288],[593,746]]},
  {id:'eocr-return', state:'eocrTrip', points:[[593,781],[593,825]]},
  {id:'yl-branch',   state:'eocrTrip', points:[[589,536],[674,536]]},
  {id:'yl-feed',     state:'eocrTrip', points:[[674,618],[674,746]]},
  {id:'yl-return',   state:'eocrTrip', points:[[674,781],[674,825]]},
  {id:'bz-branch',   state:'eocrTrip', points:[[671,659],[756,659]]},
  {id:'bz-feed',     state:'eocrTrip', points:[[756,659],[756,825]]},

  {id:'auto-a',      state:'ssAuto',     points:[[1000,289],[1000,334]]},
  {id:'auto-fls',    state:'autoBranch', points:[[1000,375],[1000,581]]},
  {id:'merge-bridge', state:'merged',    points:[[997,581],[1247,581]]},
  {id:'fr-feed',     state:'fr',  points:[[1000,581],[1000,746]]},
  {id:'fr-return',   state:'fr',  points:[[1000,781],[1000,825]]},

  {id:'manual-m',    state:'ssManual',      points:[[1081,289],[1081,334]]},
  {id:'manual-pb0',  state:'ssManual',      points:[[1081,375],[1081,417]]},
  {id:'manual-pb0-out', state:'manualPastPB0', points:[[1081,457],[1081,540]]},
  {id:'manual-pb1hold', state:'manualBranch',  points:[[1081,581],[1081,619]]},
  {id:'x-feed',      state:'x', points:[[1081,619],[1081,746]]},
  {id:'x-return',    state:'x', points:[[1081,781],[1081,825]]},

  {id:'x-contact',   state:'x', points:[[1244,289],[1244,334]]},
  {id:'t-feed',      state:'t', points:[[1244,375],[1244,746]]},
  {id:'t-return',    state:'t', points:[[1244,781],[1244,825]]},
  {id:'t-to-mc1-bridge', state:'t', points:[[1244,619],[1326,619]]},
  {id:'mc1-feed',    state:'mc1', points:[[1326,663],[1326,746]]},
  {id:'mc1-return',  state:'mc1', points:[[1326,781],[1326,825]]},
  {id:'t-to-mc2-bridge', state:'t', points:[[1244,619],[1407,619]]},
  {id:'mc2-feed',    state:'mc2', points:[[1407,663],[1407,746]]},
  {id:'mc2-return',  state:'mc2', points:[[1407,781],[1407,825]]},

  {id:'rl-feed',    state:'mc1', points:[[1489,292],[1489,746]]},
  {id:'rl-return',  state:'mc1', points:[[1489,781],[1489,825]]},
  {id:'gl-feed',    state:'mc2', points:[[1570,292],[1570,746]]},
  {id:'gl-return',  state:'mc2', points:[[1570,781],[1570,825]]},
];



// ==================== 도면 6 ====================
// 특이 구조: X(M00000)는 오직 자동(A&&FLS)에서만 세팅되고 수동으로는 절대 안 바뀜.
// 대신 "finalX"(수동경로 OR 현재 X) 라는 중간값이 따로 계산되어 T·hold·FR/MC1/MC2를 구동함.
// 즉 X 표시등은 자동일 때만 켜지지만, 실제 동작(FR/MC1/MC2)은 수동으로도 됨.
function diagram6FlowStates(){
  const x=overlayTerminalOn(dlrResolve(6,'X'));  // 자동 전용 값(M00000, 절대 수동으로 안 바뀜)
  const t=overlayTerminalOn(dlrResolve(6,'T'));
  const fr=overlayTerminalOn(dlrResolve(6,'FR'));
  const mc1=overlayTerminalOn(dlrResolve(6,'MC1')), mc2=overlayTerminalOn(dlrResolve(6,'MC2'));
  const fls=!!ui.fls;
  const hold = !!plc.get('M00002');
  const controlPower=true, eocrNormal=!ui.eocr, eocrTrip=!!ui.eocr;
  const ssAuto = !ui.eocr && !!ui.ss;
  const ssManual = !ui.eocr && !ui.ss;
  const autoBranch = ssAuto && !!ui.fls;   // X는 이 값 그대로
  const manualPastPB0 = ssManual && !ui.pb0;
  const manualBranch = manualPastPB0 && (!!ui.pb1 || hold);
  // finalX: 수동 경로 또는 현재 X(자동) 중 하나라도 있으면 통전 — T/hold/FR/MC1/MC2는 이걸 사용
  const finalX = !ui.eocr && (manualBranch || x);
  return { controlPower, eocrNormal, eocrTrip, ssAuto, ssManual, autoBranch,
           manualPastPB0, manualBranch, finalX, x, t, fr, mc1, mc2, fls };
}

const DIAGRAM6_REAL_FLOW = [
  {id:'feed-pre',    state:'controlPower', points:[[511,292],[634,292]]},
  {id:'feed-normal', state:'eocrNormal',   points:[[674,292],[1570,292]]},
  {id:'return-bus',  state:'controlPower', points:[[511,822],[1570,822]]},

  {id:'eocr-feed',   state:'eocrTrip', points:[[593,288],[593,741]]},
  {id:'eocr-return', state:'eocrTrip', points:[[593,781],[593,825]]},
  {id:'yl-branch',   state:'eocrTrip', points:[[589,536],[674,536]]},
  {id:'yl-feed',     state:'eocrTrip', points:[[674,618],[674,741]]},
  {id:'yl-return',   state:'eocrTrip', points:[[674,781],[674,825]]},
  {id:'bz-branch',   state:'eocrTrip', points:[[671,659],[756,659]]},
  {id:'bz-feed',     state:'eocrTrip', points:[[756,659],[756,825]]},

  // 자동(A) 경로: A -> FLS -> X코일 직결 (수동과 병합되지 않음, X는 순수 자동값)
  {id:'auto-a',      state:'ssAuto',     points:[[837,289],[837,333]]},
  {id:'auto-fls',    state:'autoBranch', points:[[837,373],[837,496]]},
  {id:'auto-to-x-bridge', state:'autoBranch', points:[[834,496],[1000,496]]},
  {id:'x-feed',      state:'x', points:[[1000,496],[1000,741]]},
  {id:'x-return',    state:'x', points:[[1000,781],[1000,825]]},

  // 수동(M) 경로: M -> PB0 -> PB1/자기유지 -> finalX(=수동 OR 현재X) -> T코일
  {id:'manual-m',    state:'ssManual',      points:[[1081,289],[1081,333]]},
  {id:'manual-pb0',  state:'ssManual',      points:[[1081,373],[1081,414]]},
  {id:'manual-pb0-out', state:'manualPastPB0', points:[[1081,455],[1081,537]]},
  {id:'manual-pb1hold', state:'manualBranch',  points:[[1081,577],[1081,659]]},
  {id:'t-feed',      state:'t', points:[[1081,699],[1081,741]]},
  {id:'t-return',    state:'t', points:[[1081,781],[1081,825]]},

  // X(자동값) 자기참조 접점 -> FR코일 (finalX 기준으로 표시해 아래 FR/MC1/MC2와 모순 없게)
  {id:'x-contact',   state:'finalX', points:[[1244,292],[1244,333]]},
  {id:'fr-feed',     state:'fr', points:[[1244,373],[1244,741]]},
  {id:'fr-return',   state:'fr', points:[[1244,781],[1244,825]]},
  {id:'fr-to-mc1-bridge', state:'finalX', points:[[1244,496],[1326,496]]},
  {id:'mc1-feed',    state:'mc1', points:[[1326,577],[1326,741]]},
  {id:'mc1-return',  state:'mc1', points:[[1326,781],[1326,825]]},

  {id:'rl-feed',     state:'mc1', points:[[1407,289],[1407,741]]},
  {id:'rl-return',   state:'mc1', points:[[1407,781],[1407,825]]},
  {id:'gl-feed',     state:'mc2', points:[[1489,293],[1489,741]]},
  {id:'gl-return',   state:'mc2', points:[[1489,781],[1489,825]]},
  {id:'mc1-to-mc2-bridge', state:'finalX', points:[[1244,496],[1570,496]]},
  {id:'mc2-feed',    state:'mc2', points:[[1570,577],[1570,741]]},
  {id:'mc2-return',  state:'mc2', points:[[1570,781],[1570,825]]},
];


// 원본 JPG에서 검은 직선 배선을 검출해 저장한 좌표입니다.
// 2~18번은 추정 템플릿 대신 이 좌표만 따라가므로 빨간선이 원본 배선 밖으로 벗어나지 않습니다.
const DETECTED_WIRE_GEOMETRY = {"2":{"v":[[511,298,354],[511,404,821],[592,288,741],[674,618,741],[674,781,825],[756,659,740],[756,784,825],[837,496,741],[1000,288,333],[1000,373,537],[1000,597,741],[1000,781,825],[1081,455,537],[1081,582,621],[1081,701,741],[1082,289,621],[1082,699,824],[1244,455,741],[1244,781,825],[1325,615,659],[1326,699,741],[1406,699,739],[1407,781,825],[1488,289,333],[1488,373,741],[1488,781,825],[1570,293,741]],"h":[[292,511,634],[292,674,1570],[496,853,1003],[496,1078,1162],[536,589,674],[618,996,1056],[618,1241,1407],[659,671,754],[700,996,1081],[746,850,939],[822,511,1570]]},"3":{"v":[[511,303,359],[511,404,821],[592,288,741],[592,288,819],[674,536,571],[674,618,741],[674,781,819],[756,659,825],[837,619,659],[837,699,741],[918,289,333],[918,373,659],[918,373,741],[919,782,825],[1000,288,333],[1000,373,455],[1000,495,741],[1081,414,741],[1244,289,333],[1244,462,518],[1244,577,741],[1244,782,825],[1325,495,537],[1326,497,825],[1407,288,333],[1407,373,741],[1488,293,333],[1488,373,741],[1488,783,820]],"h":[[292,674,1489],[414,996,1080],[496,1241,1326],[537,589,674],[537,915,1002],[618,837,922],[659,671,755],[822,511,1489]]},"4":{"v":[[511,293,336],[511,404,821],[592,288,741],[592,288,819],[674,536,577],[674,618,741],[674,783,825],[756,673,825],[837,496,741],[837,781,825],[1000,373,478],[1000,577,741],[1000,781,825],[1080,615,679],[1080,288,825],[1244,373,507],[1244,577,741],[1244,781,825],[1325,577,659],[1326,497,825],[1407,618,740],[1407,781,825],[1488,288,333],[1488,373,741],[1570,293,741]],"h":[[292,511,634],[292,674,1570],[496,877,1003],[496,1078,1163],[496,1241,1325],[618,996,1163],[659,671,756],[746,871,939],[822,511,1570]]},"5":{"v":[[511,294,350],[511,404,821],[592,270,741],[674,537,578],[674,618,741],[674,783,819],[756,659,741],[756,784,820],[837,332,741],[1000,455,496],[1000,536,741],[1000,782,825],[1081,414,496],[1081,536,581],[1082,702,739],[1162,536,618],[1162,659,741],[1162,455,820],[1244,574,618],[1244,659,741],[1244,783,820],[1326,574,618],[1326,659,740],[1488,332,741],[1570,332,741]],"h":[[455,834,999],[536,589,674],[578,996,1407],[659,671,754],[700,996,1081],[700,1341,1406],[822,511,1570]]},"6":{"v":[[511,292,344],[511,404,821],[592,288,741],[674,539,578],[674,618,740],[674,781,825],[756,659,740],[756,782,825],[837,373,741],[1000,496,537],[1000,577,740],[1000,781,825],[1080,373,415],[1080,615,659],[1080,288,740],[1082,781,825],[1244,293,333],[1244,373,659],[1244,782,819],[1325,577,741],[1326,577,825],[1407,701,740],[1488,492,527],[1488,577,617],[1488,699,740],[1488,781,825],[1570,497,741],[1570,782,821]],"h":[[292,674,1244],[495,834,999],[496,1078,1163],[496,1241,1569],[536,589,674],[618,1084,1158],[618,1488,1573],[659,671,756],[700,1322,1407],[700,1489,1573],[746,850,939],[822,511,1570]]},"7":{"v":[[512,293,827],[592,289,747],[674,540,582],[674,622,746],[674,789,832],[756,664,746],[756,790,826],[836,499,747],[837,787,832],[999,375,540],[999,710,746],[1000,289,832],[1081,289,326],[1081,457,540],[1082,581,699],[1243,289,326],[1243,375,541],[1244,375,832],[1325,619,663],[1325,788,832],[1406,622,664],[1406,705,746],[1406,622,832],[1488,289,334],[1488,375,747],[1570,294,747],[1570,787,827]],"h":[[292,511,617],[292,674,1570],[498,837,1003],[498,837,1003],[498,1078,1161],[540,589,673],[622,996,1163],[623,1240,1407],[664,671,754],[752,850,939],[828,511,1570]]},"8":{"v":[[511,292,327],[511,406,827],[592,289,747],[674,622,664],[674,705,746],[756,498,747],[756,789,826],[836,764,834],[999,619,747],[1000,619,832],[1081,622,664],[1081,705,746],[1162,289,334],[1162,375,417],[1162,457,540],[1162,581,664],[1162,375,832],[1325,289,334],[1325,375,623],[1326,706,746],[1406,500,541],[1406,581,746],[1406,581,832],[1488,289,334],[1488,375,747],[1488,787,832],[1569,375,746],[1570,294,827]],"h":[[292,511,1570],[498,756,921],[499,1159,1244],[499,1322,1407],[622,915,1080],[622,589,674],[622,915,1081],[622,1159,1324],[705,1325,1410],[753,769,858],[828,511,1570]]},"9":{"v":[[511,311,367],[511,404,821],[592,288,741],[592,288,820],[674,496,537],[674,577,741],[674,781,825],[755,615,660],[755,699,740],[756,699,825],[837,618,657],[837,699,741],[1000,289,333],[1000,373,537],[1000,595,707],[1000,782,819],[1081,496,741],[1081,782,819],[1244,288,333],[1244,373,415],[1244,462,503],[1244,577,729],[1244,781,825],[1325,495,537],[1325,577,617],[1325,699,741],[1326,700,825],[1408,288,741],[1488,289,333],[1488,373,741],[1570,293,741],[1570,784,819]],"h":[[292,674,1570],[495,589,673],[496,996,1080],[496,1241,1324],[618,752,815],[618,918,1003],[618,1241,1326],[746,1121,1183],[822,511,1570]]},"10":{"v":[[511,292,339],[511,404,821],[592,288,741],[592,288,819],[674,699,740],[674,781,825],[796,288,333],[796,373,741],[796,373,820],[877,288,333],[877,373,414],[877,615,659],[878,289,414],[878,615,824],[959,618,659],[959,699,741],[1040,288,741],[1041,782,820],[1122,373,414],[1122,615,659],[1122,699,740],[1122,781,825],[1203,699,740],[1204,619,825],[1284,289,333],[1284,373,415],[1284,288,741],[1447,373,741],[1448,288,825],[1529,373,741]],"h":[[292,755,1529],[414,793,878],[414,793,878],[414,1037,1120],[496,1281,1366],[618,1037,1204],[822,511,1529]]},"11":{"v":[[511,302,358],[511,404,821],[592,288,741],[674,699,739],[674,781,825],[796,289,333],[796,373,741],[796,297,819],[877,288,333],[877,373,414],[877,615,659],[878,373,414],[878,615,740],[878,782,819],[959,619,659],[959,699,741],[1040,288,333],[1040,373,741],[1041,782,820],[1122,288,333],[1122,373,414],[1122,615,659],[1122,699,740],[1122,782,819],[1203,618,659],[1204,699,741],[1284,373,415],[1284,455,741],[1284,288,825],[1447,373,741],[1448,288,825],[1530,293,741]],"h":[[292,755,1529],[414,1037,1121],[496,1281,1365],[618,793,959],[822,511,1529]]},"12":{"v":[[512,293,821],[592,288,741],[592,288,820],[674,619,659],[674,782,825],[796,289,332],[796,373,741],[796,295,825],[877,288,333],[877,615,659],[878,289,417],[878,615,824],[959,288,333],[959,619,659],[959,781,825],[1040,288,332],[1040,373,741],[1040,373,825],[1122,288,333],[1122,374,418],[1122,781,825],[1203,289,332],[1203,373,415],[1203,618,659],[1204,373,414],[1204,618,824],[1284,296,333],[1285,296,741],[1448,373,741],[1448,782,824],[1529,293,331],[1529,373,741]],"h":[[292,755,1529],[414,793,959],[414,1037,1101],[414,793,959],[414,1037,1203],[414,1281,1365],[618,589,674],[618,793,959],[700,1037,1122],[822,511,1529]]},"13":{"v":[[511,292,374],[511,404,821],[592,288,741],[674,619,659],[674,700,740],[674,782,819],[796,289,333],[796,373,478],[796,536,741],[796,373,825],[877,373,418],[877,699,740],[878,289,417],[878,615,824],[959,374,414],[959,619,659],[959,781,825],[1040,295,333],[1040,373,741],[1041,781,825],[1122,288,333],[1122,374,417],[1122,701,740],[1204,289,414],[1204,618,824],[1284,289,333],[1284,373,741],[1285,782,825],[1448,296,741],[1529,373,741]],"h":[[292,755,1529],[414,1037,1204],[414,793,959],[414,1037,1203],[414,1281,1364],[618,589,674],[618,793,959],[700,1037,1122],[822,511,1529]]},"14":{"v":[[511,299,355],[511,404,821],[592,288,741],[674,618,659],[674,699,740],[796,288,333],[796,373,741],[796,373,825],[877,288,333],[877,373,741],[878,373,825],[959,288,333],[959,495,537],[959,577,618],[959,658,741],[959,781,825],[1040,288,333],[1040,373,414],[1040,289,414],[1040,699,740],[1122,289,333],[1122,373,741],[1203,373,455],[1203,533,618],[1204,288,741],[1204,785,825],[1284,373,455],[1284,699,740],[1284,289,537],[1284,699,824],[1366,288,333],[1366,373,741],[1366,781,825],[1447,373,415],[1448,293,741],[1448,782,820]],"h":[[292,755,1448],[414,1200,1288],[536,1200,1284],[618,589,673],[700,956,1039],[822,511,1448]]},"15":{"v":[[511,292,332],[511,404,821],[592,288,741],[592,288,819],[674,618,659],[674,699,740],[674,782,825],[796,373,741],[796,373,819],[878,295,741],[878,782,819],[959,288,333],[959,394,450],[959,495,618],[959,658,741],[959,782,819],[1040,699,741],[1040,414,540],[1040,699,824],[1203,373,741],[1204,288,820],[1284,289,333],[1284,373,415],[1284,455,497],[1284,536,606],[1284,658,741],[1285,288,825],[1366,288,333],[1366,373,578],[1448,288,741],[1529,293,333],[1529,373,415],[1529,455,741]],"h":[[292,755,1529],[414,956,1039],[536,956,1122],[578,1281,1365],[618,589,673],[699,956,1039],[700,1281,1366],[822,511,1529]]},"16":{"v":[[511,301,357],[511,404,821],[592,288,741],[674,699,741],[674,782,825],[796,373,741],[796,373,825],[878,296,741],[959,288,333],[959,373,741],[1040,373,417],[1041,295,417],[1041,699,824],[1204,288,741],[1204,781,825],[1284,373,455],[1284,288,659],[1286,699,740],[1286,782,825],[1366,288,333],[1366,374,418],[1366,615,659],[1366,699,739],[1366,782,825],[1447,373,415],[1447,662,707],[1448,289,414],[1448,618,824],[1529,373,741]],"h":[[292,755,1529],[414,956,1122],[414,1281,1447],[618,589,674],[618,1281,1447],[700,956,1041],[822,511,1529]]},"17":{"v":[[512,292,821],[592,288,741],[674,618,659],[674,699,741],[674,783,825],[796,288,333],[796,373,741],[797,296,825],[877,288,333],[878,373,741],[959,373,455],[959,495,537],[959,577,740],[960,782,825],[1040,288,333],[1040,373,455],[1040,495,537],[1040,577,618],[1040,700,740],[1041,373,618],[1041,699,824],[1122,373,741],[1203,288,333],[1203,373,455],[1203,608,654],[1204,373,741],[1204,782,825],[1284,289,333],[1284,373,415],[1284,615,660],[1284,699,740],[1284,373,414],[1284,615,824],[1366,619,741],[1448,373,741]],"h":[[292,532,596],[292,755,1448],[414,956,1044],[415,1200,1283],[618,1200,1366],[700,956,1041],[822,511,1448]]},"18":{"v":[[511,292,339],[511,404,821],[592,288,741],[592,288,819],[674,699,741],[674,782,820],[796,373,741],[796,373,819],[878,288,741],[878,782,819],[959,373,415],[959,455,496],[959,536,741],[960,782,819],[1040,373,578],[1040,699,741],[1040,289,577],[1040,699,824],[1122,288,333],[1122,373,741],[1202,289,333],[1203,455,496],[1203,536,741],[1204,289,825],[1284,373,578],[1284,700,740],[1284,289,577],[1284,699,824],[1366,373,741],[1448,295,741]],"h":[[292,755,1529],[414,1444,1529],[578,956,1041],[578,1200,1284],[618,589,674],[700,956,1041],[700,1200,1284],[822,511,1448]]}};
function buildGeneric19AuxFlow(dnum, cfg){
  const segs = [];
  const add = (id,state,points)=>segs.push({id,state,points});
  const topY = cfg.railY;
  const bottomY = 820;
  const leftX = cfg.leftX;
  const tripY = 490;
  const tripBusY = 610;
  const runBusY = 610;

  add('g-feed-pre','controlPower',[[507,topY],[leftX,topY]]);
  add('g-top-bus','eocrn',[[leftX,topY],[cfg.rightX,topY]]);
  add('g-bottom-bus','controlPower',[[leftX,bottomY],[cfg.rightX,bottomY]]);

  if(cfg.x.EOCR != null){
    add('g-eocr-ind','eocrn',[[leftX,topY],[leftX,bottomY]]);
  }

  ['FR','YL','BZ'].forEach(label=>{
    const x = cfg.x[label];
    if(x==null) return;
    const key = label.toLowerCase();
    add(`g-${key}` , key, [[leftX,topY],[leftX,tripY],[x,tripY],[x,bottomY-100]]);
    add(`g-${key}-ret`, key, [[x,bottomY-40],[x,bottomY]]);
  });

  if(cfg.x.FLS != null){
    add('g-fls','fls',[[Math.min(cfg.x.FLS, leftX+330),tripY],[cfg.x.FLS,tripY],[cfg.x.FLS,bottomY-100]]);
    add('g-fls-ret','fls',[[cfg.x.FLS,bottomY-40],[cfg.x.FLS,bottomY]]);
  }

  const runCandidates = ['X','T','FR','MC1','MC2'].map(k=>cfg.x[k]).filter(v=>v!=null).sort((a,b)=>a-b);
  const runStart = runCandidates.length ? runCandidates[0] : leftX+400;
  const runEnd = runCandidates.length ? runCandidates[runCandidates.length-1] : cfg.rightX-80;
  add('g-run-bus','runbus',[[runStart,runBusY],[runEnd,runBusY]]);

  ['X','T','MC1','MC2','RL','GL'].forEach(label=>{
    const x = cfg.x[label];
    if(x==null) return;
    const key = label.toLowerCase();
    if(label==='X'){
      add('g-x', key, [[x,topY],[x,bottomY-100]]);
      add('g-x-ret', key, [[x,bottomY-40],[x,bottomY]]);
      return;
    }
    add(`g-${key}`, key, [[x,runBusY],[x,bottomY-100]]);
    add(`g-${key}-ret`, key, [[x,bottomY-40],[x,bottomY]]);
  });

  return segs;
}

function generic19FlowStates(dnum, cfg){
  const st = {
    controlPower: true,
    eocrn: !ui.eocr,
    runbus: false,
    fr: false, yl: false, bz: false, fls: !!ui.fls,
    x: false, t: false, mc1: false, mc2: false, rl: false, gl: false,
  };
  const labels = DIAGRAM_ROW_LABELS[String(dnum)] || Object.keys(cfg.x);
  labels.forEach(label=>{
    const key = label.toLowerCase();
    const on = overlayTerminalOn(dlrResolve(dnum, label));
    st[key] = on;
  });
  st.rl = st.mc1;
  st.gl = st.mc2;
  st.runbus = !!(st.x || st.t || st.mc1 || st.mc2 || st.fr);
  return st;
}


function nearestOverlayLabel(cfg, x){
  let best=null, dist=1e9;
  Object.entries(cfg.x).forEach(([label,lx])=>{ const d=Math.abs(lx-x); if(d<dist){dist=d;best=label;} });
  return dist<=4 ? best : null;
}
function buildDetectedWireFlow(dnum,cfg){
  const g=DETECTED_WIRE_GEOMETRY[String(dnum)];
  if(!g) return [];
  const segs=[];
  g.v.forEach((v,i)=>{
    const label=nearestOverlayLabel(cfg,v[0]);
    if(label) segs.push({id:`d-v-${i}`,state:`label:${label}`,points:[[v[0],v[1]],[v[0],v[2]]]});
    else if(Math.abs(v[0]-511)<=4) segs.push({id:`d-v-${i}`,state:'returnActive',points:[[v[0],v[1]],[v[0],v[2]]]});
  });
  g.h.forEach((h,i)=>{
    const y=h[0], x1=h[1], x2=h[2];
    let state='ends:';
    // 중간 수평선은 '선 아래에 있는 출력 하나라도 ON' 방식으로 켜지지 않게 한다.
    // 원본 도면의 양 끝 분기/세로선에 가장 가까운 기기 상태를 각각 찾아,
    // 두 쪽이 실제로 살아 있을 때만 수평 구간을 통전 표시한다.
    const entries=Object.entries(cfg.x);
    const near=(x)=>{
      let best=null,dist=1e9;
      entries.forEach(([l,lx])=>{ const d=Math.abs(lx-x); if(d<dist){dist=d;best=l;} });
      return dist<=105?best:null;
    };
    const a=near(x1), b=near(x2);
    // 상단 전원모선/하단 공통선은 회로 전체 전원 상태로 취급
    if(y<320) state='eocrn';
    else if(y>800) state='returnActive';
    else state += [a,b].filter(Boolean).join(',');
    segs.push({id:`d-h-${i}`,state,points:[[x1,y],[x2,y]]});
  });
  return segs;
}
// 원본 도면상 선이 겹쳐 보이지만 전기적으로 이어진 통전 경로가 아닌 구간.
// 이미지 선 검출만으로는 접점/교차/비접속을 구분할 수 없으므로 도면별 예외를 명시한다.
const OVERLAY_NEVER_ENERGIZE = {};

function detectedLoadAny(dnum,cfg){
  const labels = DIAGRAM_ROW_LABELS[String(dnum)] || Object.keys(cfg.x);
  return labels.some(label=>overlayTerminalOn(dlrResolve(dnum,label)));
}
function detectedFlowState(dnum,cfg,state){
  if(state==='controlPower') return true;
  if(state==='returnActive') return detectedLoadAny(dnum,cfg);
  if(state==='eocrn') return !ui.eocr;
  if(state.startsWith('label:')){
    const label=state.slice(6); return overlayTerminalOn(dlrResolve(dnum,label));
  }
  if(state.startsWith('labels:')){
    const labels=state.slice(7).split(',').filter(Boolean);
    return labels.some(label=>overlayTerminalOn(dlrResolve(dnum,label)));
  }
  if(state.startsWith('ends:')){
    const labels=state.slice(5).split(',').filter(Boolean);
    if(labels.length<2) return false;
    return labels.every(label=>overlayTerminalOn(dlrResolve(dnum,label)));
  }
  return false;
}

function buildOverlayFor(dnum, cfg){
  const svg = document.getElementById('diagramOverlay');
  svg.innerHTML = '';
  overlayWireEls = {}; overlayCoilEls = {}; overlayFrEls = {}; overlayCustomEls = {}; overlayLeftPowerEls = {}; overlayGroundEls = {};

  const makeLine = (x1,y1,x2,y2,cls)=>{
    const el = document.createElementNS(OVERLAY_SVGNS,'line');
    el.setAttribute('x1',x1); el.setAttribute('y1',y1);
    el.setAttribute('x2',x2); el.setAttribute('y2',y2);
    el.setAttribute('class', cls);
    svg.appendChild(el);
    return el;
  };
  // 보조회로 전류 애니메이션(점선 흐름)이 항상 위(전원측)->아래(부하측) 방향으로
  // 보이도록, 경로의 첫 점이 마지막 점보다 아래(y가 더 큼)에 있으면 순서를 뒤집는다.
  // 실제 검은선 좌표 자체는 바꾸지 않고 그리는 순서만 정규화하므로 정렬에는 영향 없음.
  const orientTopToBottom = (points)=>{
    if(points.length<2) return points;
    const first=points[0], last=points[points.length-1];
    return first[1] > last[1] ? points.slice().reverse() : points;
  };
  const makePath = (points,cls)=>{
    const pts = orientTopToBottom(points);
    const el = document.createElementNS(OVERLAY_SVGNS,'path');
    el.setAttribute('d', pts.map((p,i)=>`${i===0?'M':'L'} ${p[0]} ${p[1]}`).join(' '));
    el.setAttribute('class', cls);
    svg.appendChild(el);
    return el;
  };
  const makeCircle = (cx,cy,r,cls)=>{
    const el = document.createElementNS(OVERLAY_SVGNS,'circle');
    el.setAttribute('cx',cx); el.setAttribute('cy',cy); el.setAttribute('r',r);
    el.setAttribute('class', cls);
    svg.appendChild(el);
    return el;
  };

  // 좌측 주회로는 1~18 공통 기반으로 먼저 깔아 둠
  LEFT_POWER_REAL_FLOW.forEach(seg=>{
    overlayLeftPowerEls[seg.id] = { el:makePath(seg.points,'wire'), state:seg.state };
  });
  LEFT_POWER_GROUND_FLOW.forEach(seg=>{
    overlayGroundEls[seg.id] = makePath(seg.points,'ground-wire on');
  });

  // 도면 1: 원본 검은 배선을 따라가는 실제 경로 오버레이
  if(String(dnum)==='1'){
    DIAGRAM1_REAL_FLOW.forEach(seg=>{
      overlayCustomEls[seg.id] = { el:makePath(seg.points,'wire'), state:seg.state };
    });

    // 원본 하단 기기 위치는 기존 실측 좌표를 그대로 사용
    // 실제 원본 도면의 원 반지름은 약 19px (기존 30px는 실제보다 훨씬 커서
    // 검은 원 밖으로 빨간 테두리가 튀어나와 보이는 원인이었음)
    Object.entries(cfg.x).forEach(([label,x])=>{
      overlayCoilEls[label] = makeCircle(x, cfg.coilY, 19, 'coil-ring');
    });

    overlayBuiltFor = dnum;
    return;
  }

  // 도면 2: 접점 단위로 재구성한 실제 배선 경로
  if(String(dnum)==='2'){
    DIAGRAM2_REAL_FLOW.forEach(seg=>{
      overlayCustomEls[seg.id] = { el:makePath(seg.points,'wire'), state:seg.state };
    });
    Object.entries(cfg.x).forEach(([label,x])=>{
      overlayCoilEls[label] = makeCircle(x, 755, 19, 'coil-ring');
    });
    overlayBuiltFor = dnum;
    return;
  }

  // 도면 3: 접점 단위로 재구성한 실제 배선 경로
  if(String(dnum)==='3'){
    DIAGRAM3_REAL_FLOW.forEach(seg=>{
      overlayCustomEls[seg.id] = { el:makePath(seg.points,'wire'), state:seg.state };
    });
    Object.entries(cfg.x).forEach(([label,x])=>{
      overlayCoilEls[label] = makeCircle(x, 755, 19, 'coil-ring');
    });
    overlayBuiltFor = dnum;
    return;
  }

  // 도면 10: 접점 단위로 재구성한 실제 배선 경로
  if(String(dnum)==='10'){
    DIAGRAM10_REAL_FLOW.forEach(seg=>{
      overlayCustomEls[seg.id] = { el:makePath(seg.points,'wire'), state:seg.state };
    });
    Object.entries(cfg.x).forEach(([label,x])=>{
      overlayCoilEls[label] = makeCircle(x, 755, 19, 'coil-ring');
    });
    overlayBuiltFor = dnum;
    return;
  }

  // 도면 11: 접점 단위로 재구성한 실제 배선 경로
  if(String(dnum)==='11'){
    DIAGRAM11_REAL_FLOW.forEach(seg=>{
      overlayCustomEls[seg.id] = { el:makePath(seg.points,'wire'), state:seg.state };
    });
    Object.entries(cfg.x).forEach(([label,x])=>{
      overlayCoilEls[label] = makeCircle(x, 755, 19, 'coil-ring');
    });
    overlayBuiltFor = dnum;
    return;
  }

  // 도면 12: 접점 단위로 재구성한 실제 배선 경로
  if(String(dnum)==='12'){
    DIAGRAM12_REAL_FLOW.forEach(seg=>{
      overlayCustomEls[seg.id] = { el:makePath(seg.points,'wire'), state:seg.state };
    });
    Object.entries(cfg.x).forEach(([label,x])=>{
      overlayCoilEls[label] = makeCircle(x, 755, 19, 'coil-ring');
    });
    overlayBuiltFor = dnum;
    return;
  }

  // 도면 4: 접점 단위로 재구성한 실제 배선 경로
  if(String(dnum)==='4'){
    DIAGRAM4_REAL_FLOW.forEach(seg=>{
      overlayCustomEls[seg.id] = { el:makePath(seg.points,'wire'), state:seg.state };
    });
    Object.entries(cfg.x).forEach(([label,x])=>{
      overlayCoilEls[label] = makeCircle(x, 755, 19, 'coil-ring');
    });
    overlayBuiltFor = dnum;
    return;
  }

  // 도면 5: 접점 단위로 재구성한 실제 배선 경로
  if(String(dnum)==='5'){
    DIAGRAM5_REAL_FLOW.forEach(seg=>{
      overlayCustomEls[seg.id] = { el:makePath(seg.points,'wire'), state:seg.state };
    });
    Object.entries(cfg.x).forEach(([label,x])=>{
      overlayCoilEls[label] = makeCircle(x, 755, 19, 'coil-ring');
    });
    overlayBuiltFor = dnum;
    return;
  }

  // 도면 6: 접점 단위로 재구성한 실제 배선 경로
  if(String(dnum)==='6'){
    DIAGRAM6_REAL_FLOW.forEach(seg=>{
      overlayCustomEls[seg.id] = { el:makePath(seg.points,'wire'), state:seg.state };
    });
    Object.entries(cfg.x).forEach(([label,x])=>{
      overlayCoilEls[label] = makeCircle(x, 755, 19, 'coil-ring');
    });
    overlayBuiltFor = dnum;
    return;
  }

  // 도면 13: 접점 단위로 재구성한 실제 배선 경로
  if(String(dnum)==='13'){
    DIAGRAM13_REAL_FLOW.forEach(seg=>{
      overlayCustomEls[seg.id] = { el:makePath(seg.points,'wire'), state:seg.state };
    });
    Object.entries(cfg.x).forEach(([label,x])=>{
      overlayCoilEls[label] = makeCircle(x, 755, 19, 'coil-ring');
    });
    overlayBuiltFor = dnum;
    return;
  }

  // 도면 14: 접점 단위로 재구성한 실제 배선 경로
  if(String(dnum)==='14'){
    DIAGRAM14_REAL_FLOW.forEach(seg=>{
      overlayCustomEls[seg.id] = { el:makePath(seg.points,'wire'), state:seg.state };
    });
    Object.entries(cfg.x).forEach(([label,x])=>{
      overlayCoilEls[label] = makeCircle(x, 755, 19, 'coil-ring');
    });
    overlayBuiltFor = dnum;
    return;
  }

  // 도면 15: 접점 단위로 재구성한 실제 배선 경로
  if(String(dnum)==='15'){
    DIAGRAM15_REAL_FLOW.forEach(seg=>{
      overlayCustomEls[seg.id] = { el:makePath(seg.points,'wire'), state:seg.state };
    });
    Object.entries(cfg.x).forEach(([label,x])=>{
      overlayCoilEls[label] = makeCircle(x, 755, 19, 'coil-ring');
    });
    overlayBuiltFor = dnum;
    return;
  }

  // 도면 7: 접점 단위로 재구성한 실제 배선 경로
  if(String(dnum)==='7'){
    DIAGRAM7_REAL_FLOW.forEach(seg=>{
      overlayCustomEls[seg.id] = { el:makePath(seg.points,'wire'), state:seg.state };
    });
    Object.entries(cfg.x).forEach(([label,x])=>{
      overlayCoilEls[label] = makeCircle(x, 755, 19, 'coil-ring');
    });
    overlayBuiltFor = dnum;
    return;
  }

  // 도면 8: 접점 단위로 재구성한 실제 배선 경로
  if(String(dnum)==='8'){
    DIAGRAM8_REAL_FLOW.forEach(seg=>{
      overlayCustomEls[seg.id] = { el:makePath(seg.points,'wire'), state:seg.state };
    });
    Object.entries(cfg.x).forEach(([label,x])=>{
      overlayCoilEls[label] = makeCircle(x, 755, 19, 'coil-ring');
    });
    overlayBuiltFor = dnum;
    return;
  }

  // 도면 9: 접점 단위로 재구성한 실제 배선 경로
  if(String(dnum)==='9'){
    DIAGRAM9_REAL_FLOW.forEach(seg=>{
      overlayCustomEls[seg.id] = { el:makePath(seg.points,'wire'), state:seg.state };
    });
    Object.entries(cfg.x).forEach(([label,x])=>{
      overlayCoilEls[label] = makeCircle(x, 755, 19, 'coil-ring');
    });
    overlayBuiltFor = dnum;
    return;
  }

  // 도면 16/17/18: 접점 단위로 재구성한 실제 배선 경로
  if(String(dnum)==='16'){
    DIAGRAM16_REAL_FLOW.forEach(seg=>{
      overlayCustomEls[seg.id] = { el:makePath(seg.points,'wire'), state:seg.state };
    });
    Object.entries(cfg.x).forEach(([label,x])=>{
      overlayCoilEls[label] = makeCircle(x, 755, 19, 'coil-ring');
    });
    overlayBuiltFor = dnum;
    return;
  }
  if(String(dnum)==='17'){
    DIAGRAM17_REAL_FLOW.forEach(seg=>{
      overlayCustomEls[seg.id] = { el:makePath(seg.points,'wire'), state:seg.state };
    });
    Object.entries(cfg.x).forEach(([label,x])=>{
      overlayCoilEls[label] = makeCircle(x, 755, 19, 'coil-ring');
    });
    overlayBuiltFor = dnum;
    return;
  }
  if(String(dnum)==='18'){
    DIAGRAM18_REAL_FLOW.forEach(seg=>{
      overlayCustomEls[seg.id] = { el:makePath(seg.points,'wire'), state:seg.state };
    });
    Object.entries(cfg.x).forEach(([label,x])=>{
      overlayCoilEls[label] = makeCircle(x, 755, 19, 'coil-ring');
    });
    overlayBuiltFor = dnum;
    return;
  }

  // 도면 2~18: 원본 JPG에서 검출한 실제 검은 배선 좌표를 그대로 사용
  buildDetectedWireFlow(dnum, cfg).forEach(seg=>{
    overlayCustomEls[seg.id] = { el:makePath(seg.points,'wire'), state:seg.state };
  });
  const detected = DETECTED_WIRE_GEOMETRY[String(dnum)];
  const bottomBusY = detected?.h?.map(h=>h[0]).filter(y=>y>800).sort((a,b)=>b-a)[0] || 822;
  // 실측 결과 원 중심은 하단 공통선보다 평균 67px 위쪽 (기존 62px는 5px 오차)
  const detectedCoilY = bottomBusY - 67;
  const labels = DIAGRAM_ROW_LABELS[String(dnum)] || Object.keys(cfg.x);
  labels.forEach(label=>{
    const x = cfg.x[label]; if(x==null) return;
    overlayCoilEls[label] = makeCircle(x, detectedCoilY, 19, 'coil-ring');
  });
  overlayBuiltFor = dnum;
}

function updateDiagramOverlay(){
  const svg = document.getElementById('diagramOverlay');
  const dnum = currentDiagramNumber();
  const cfg = OVERLAY_CONFIGS[String(dnum)];
  svg.classList.toggle('show', !!cfg);
  if(!cfg) return;
  if(overlayBuiltFor !== dnum) buildOverlayFor(dnum, cfg);

  // 좌측 주회로(1~18 공통) 통전 상태 반영
  const lp = leftPowerStates();
  Object.values(overlayLeftPowerEls).forEach(item=>{
    item.el.classList.toggle('on', !!lp[item.state]);
  });

  // 도면 1은 실제 배선 경로별로 통전 상태를 계산
  if(String(dnum)==='1'){
    const st = diagram1FlowStates();
    Object.values(overlayCustomEls).forEach(item=>{
      item.el.classList.toggle('on', !!st[item.state]);
    });

    const ringState = {
      EOCR: !ui.eocr,
      FR: st.fr,
      YL: st.yl,
      BZ: st.bz,
      FLS: st.fls,
      X: st.x,
      T: st.t,
      MC1: st.mc1,
      MC2: st.mc2,
      RL: st.mc1,
      GL: st.mc2,
    };
    Object.entries(overlayCoilEls).forEach(([label,el])=>{
      el.classList.toggle('on', !!ringState[label]);
    });
    return;
  }

  // 도면 2: 접점 단위로 계산한 실제 통전 상태 반영
  if(String(dnum)==='2'){
    const st = diagram2FlowStates();
    Object.values(overlayCustomEls).forEach(item=>{
      item.el.classList.toggle('on', !!st[item.state]);
    });
    const ringState2 = {
      EOCR: st.eocrTrip, YL: st.eocrTrip, BZ: st.eocrTrip, FLS: st.fls,
      X: st.x, T: st.t, FR: st.fr, MC1: st.mc1, MC2: st.mc2, RL: st.mc1, GL: st.mc2,
    };
    Object.entries(overlayCoilEls).forEach(([label,el])=>{
      el.classList.toggle('on', !!ringState2[label]);
    });
    return;
  }

  // 도면 3: 접점 단위로 계산한 실제 통전 상태 반영
  if(String(dnum)==='3'){
    const st = diagram3FlowStates();
    Object.values(overlayCustomEls).forEach(item=>{
      item.el.classList.toggle('on', !!st[item.state]);
    });
    const ringState3 = {
      EOCR: st.eocrTrip, YL: st.eocrTrip, BZ: st.eocrTrip,
      MC1: st.mc1, MC2: st.mc2, FR: st.fr, FLS: st.fls,
      T: st.manualBranch, X: st.x, RL: st.mc1, GL: st.mc2,
    };
    Object.entries(overlayCoilEls).forEach(([label,el])=>{
      el.classList.toggle('on', !!ringState3[label]);
    });
    return;
  }

  // 도면 10: 접점 단위로 계산한 실제 통전 상태 반영
  if(String(dnum)==='10'){
    const st = diagram10FlowStates();
    Object.values(overlayCustomEls).forEach(item=>{
      item.el.classList.toggle('on', !!st[item.state]);
    });
    const ringState10 = {
      EOCR: true, YL: st.eocrTrip, X1: st.x1, T1: st.t1, MC1: st.mc1,
      X2: st.x2, T2: st.t2, MC2: st.mc2, WL: st.wl, RL: st.mc1, GL: st.mc2,
    };
    Object.entries(overlayCoilEls).forEach(([label,el])=>{
      el.classList.toggle('on', !!ringState10[label]);
    });
    return;
  }

  // 도면 11: 접점 단위로 계산한 실제 통전 상태 반영
  if(String(dnum)==='11'){
    const st = diagram11FlowStates();
    Object.values(overlayCustomEls).forEach(item=>{
      item.el.classList.toggle('on', !!st[item.state]);
    });
    const ringState11 = {
      EOCR: true, YL: st.eocrTrip, X1: st.x1, MC1: st.mc1, T1: st.t1,
      X2: st.x2, MC2: st.mc2, T2: st.t2, WL: st.wl, RL: st.mc1, GL: st.mc2,
    };
    Object.entries(overlayCoilEls).forEach(([label,el])=>{
      el.classList.toggle('on', !!ringState11[label]);
    });
    return;
  }

  // 도면 12: 접점 단위로 계산한 실제 통전 상태 반영
  if(String(dnum)==='12'){
    const st = diagram12FlowStates();
    Object.values(overlayCustomEls).forEach(item=>{
      item.el.classList.toggle('on', !!st[item.state]);
    });
    const ringState12 = {
      EOCR: true, YL: st.eocrTrip, X1: st.x1, MC1: st.mc1, T1: st.t1,
      X2: st.x2, MC2: st.mc2, T2: st.t2, WL: st.wl, RL: st.mc1, GL: st.mc2,
    };
    Object.entries(overlayCoilEls).forEach(([label,el])=>{
      el.classList.toggle('on', !!ringState12[label]);
    });
    return;
  }

  // 도면 4: 접점 단위로 계산한 실제 통전 상태 반영
  if(String(dnum)==='4'){
    const st = diagram4FlowStates();
    Object.values(overlayCustomEls).forEach(item=>{
      item.el.classList.toggle('on', !!st[item.state]);
    });
    const ringState4 = {
      EOCR: st.eocrTrip, YL: st.eocrTrip, BZ: st.eocrTrip, FLS: st.fls,
      FR: st.fr, X: st.x, MC1: st.mc1, MC2: st.mc2, T: st.t, RL: st.mc1, GL: st.mc2,
    };
    Object.entries(overlayCoilEls).forEach(([label,el])=>{
      el.classList.toggle('on', !!ringState4[label]);
    });
    return;
  }

  // 도면 5: 접점 단위로 계산한 실제 통전 상태 반영
  if(String(dnum)==='5'){
    const st = diagram5FlowStates();
    Object.values(overlayCustomEls).forEach(item=>{
      item.el.classList.toggle('on', !!st[item.state]);
    });
    const ringState5 = {
      EOCR: st.eocrTrip, YL: st.eocrTrip, BZ: st.eocrTrip, FLS: st.fls,
      X: st.x, T: st.t, FR: st.fr, MC1: st.mc1, MC2: st.mc2, RL: st.mc1, GL: st.mc2,
    };
    Object.entries(overlayCoilEls).forEach(([label,el])=>{
      el.classList.toggle('on', !!ringState5[label]);
    });
    return;
  }

  // 도면 6: 접점 단위로 계산한 실제 통전 상태 반영
  if(String(dnum)==='6'){
    const st = diagram6FlowStates();
    Object.values(overlayCustomEls).forEach(item=>{
      item.el.classList.toggle('on', !!st[item.state]);
    });
    const ringState6 = {
      EOCR: st.eocrTrip, YL: st.eocrTrip, BZ: st.eocrTrip, FLS: st.fls,
      X: st.x, T: st.t, FR: st.fr, MC1: st.mc1, RL: st.mc1, GL: st.mc2, MC2: st.mc2,
    };
    Object.entries(overlayCoilEls).forEach(([label,el])=>{
      el.classList.toggle('on', !!ringState6[label]);
    });
    return;
  }

  // 도면 13: 접점 단위로 계산한 실제 통전 상태 반영
  if(String(dnum)==='13'){
    const st = diagram13FlowStates();
    Object.values(overlayCustomEls).forEach(item=>{
      item.el.classList.toggle('on', !!st[item.state]);
    });
    const ringState13 = {
      EOCR: true, YL: st.eocrTrip, X1: st.x1, MC1: st.mc1, T1: st.t1,
      X2: st.x2, MC2: st.mc2, T2: st.t2, WL: st.wl, RL: st.mc1, GL: st.mc2,
    };
    Object.entries(overlayCoilEls).forEach(([label,el])=>{
      el.classList.toggle('on', !!ringState13[label]);
    });
    return;
  }

  // 도면 14: 접점 단위로 계산한 실제 통전 상태 반영
  if(String(dnum)==='14'){
    const st = diagram14FlowStates();
    Object.values(overlayCustomEls).forEach(item=>{
      item.el.classList.toggle('on', !!st[item.state]);
    });
    const ringState14 = {
      EOCR: true, YL: st.eocrTrip, X1: st.x1, X2: st.x2, MC1: st.mc1, T1: st.t1,
      RL: st.mc1, MC2: st.mc2, T2: st.t2, GL: st.mc2, WL: st.wl,
    };
    Object.entries(overlayCoilEls).forEach(([label,el])=>{
      el.classList.toggle('on', !!ringState14[label]);
    });
    return;
  }

  // 도면 15: 접점 단위로 계산한 실제 통전 상태 반영
  if(String(dnum)==='15'){
    const st = diagram15FlowStates();
    Object.values(overlayCustomEls).forEach(item=>{
      item.el.classList.toggle('on', !!st[item.state]);
    });
    const ringState15 = {
      EOCR: true, YL: st.eocrTrip, X1: st.x1, X2: st.x2, MC1: st.mc1, T1: st.t1,
      RL: st.mc1, MC2: st.mc2, T2: st.t2, GL: st.mc2, WL: st.wl,
    };
    Object.entries(overlayCoilEls).forEach(([label,el])=>{
      el.classList.toggle('on', !!ringState15[label]);
    });
    return;
  }

  // 도면 7: 접점 단위로 계산한 실제 통전 상태 반영
  if(String(dnum)==='7'){
    const st = diagram7FlowStates();
    Object.values(overlayCustomEls).forEach(item=>{
      item.el.classList.toggle('on', !!st[item.state]);
    });
    const ringState7 = {
      EOCR: st.eocrTrip, YL: st.eocrTrip, BZ: st.eocrTrip, FR: st.fr,
      X: st.x, T: st.t, MC1: st.mc1, MC2: st.mc2, RL: st.mc1, GL: st.mc2,
    };
    Object.entries(overlayCoilEls).forEach(([label,el])=>{
      el.classList.toggle('on', !!ringState7[label]);
    });
    return;
  }

  // 도면 8: 접점 단위로 계산한 실제 통전 상태 반영
  if(String(dnum)==='8'){
    const st = diagram8FlowStates();
    Object.values(overlayCustomEls).forEach(item=>{
      item.el.classList.toggle('on', !!st[item.state]);
    });
    const ringState8 = {
      EOCR: st.eocrTrip, BZ: st.eocrTrip, FLS: st.fls, X: st.x, FR: st.fr,
      YL: st.yl, T: st.t, MC1: st.mc1, MC2: st.mc2, RL: st.mc1, GL: st.mc2,
    };
    Object.entries(overlayCoilEls).forEach(([label,el])=>{
      el.classList.toggle('on', !!ringState8[label]);
    });
    return;
  }

  // 도면 9: 접점 단위로 계산한 실제 통전 상태 반영
  if(String(dnum)==='9'){
    const st = diagram9FlowStates();
    Object.values(overlayCustomEls).forEach(item=>{
      item.el.classList.toggle('on', !!st[item.state]);
    });
    const ringState9 = {
      EOCR: st.eocrTrip, FR: st.eocrTrip, YL: st.eocrTrip, BZ: st.eocrTrip,
      MC1: st.mc1, FLS: st.fls, X: st.x, T: st.t, MC2: st.mc2, RL: st.mc1, GL: st.mc2,
    };
    Object.entries(overlayCoilEls).forEach(([label,el])=>{
      el.classList.toggle('on', !!ringState9[label]);
    });
    return;
  }

  // 도면 16/17/18: 접점 단위로 계산한 실제 통전 상태 반영
  if(String(dnum)==='16'){
    const st = diagram16FlowStates();
    Object.values(overlayCustomEls).forEach(item=>{
      item.el.classList.toggle('on', !!st[item.state]);
    });
    const ringState16 = {
      EOCR: true, YL: st.eocrTrip, T1: st.t1, T2: st.t2, MC1: st.mc1, X1: st.x1,
      RL: st.mc1, MC2: st.mc2, WL: st.wl, X2: st.x2, GL: st.mc2,
    };
    Object.entries(overlayCoilEls).forEach(([label,el])=>{
      el.classList.toggle('on', !!ringState16[label]);
    });
    return;
  }
  if(String(dnum)==='17'){
    const st = diagram17FlowStates();
    Object.values(overlayCustomEls).forEach(item=>{
      item.el.classList.toggle('on', !!st[item.state]);
    });
    const ringState17 = {
      EOCR: true, YL: st.eocrTrip, X1: st.x1, X2: st.x2, MC1: st.mc1, T1: st.t1,
      RL: st.mc1, MC2: st.mc2, WL: st.wl, T2: st.t2, GL: st.mc2,
    };
    Object.entries(overlayCoilEls).forEach(([label,el])=>{
      el.classList.toggle('on', !!ringState17[label]);
    });
    return;
  }
  if(String(dnum)==='18'){
    const st = diagram18FlowStates();
    Object.values(overlayCustomEls).forEach(item=>{
      item.el.classList.toggle('on', !!st[item.state]);
    });
    const ringState18 = {
      EOCR: true, YL: st.eocrTrip, X1: st.x1, X2: st.x2, MC1: st.mc1, T1: st.t1,
      RL: st.mc1, MC2: st.mc2, T2: st.t2, GL: st.mc2, WL: st.wl,
    };
    Object.entries(overlayCoilEls).forEach(([label,el])=>{
      el.classList.toggle('on', !!ringState18[label]);
    });
    return;
  }





  // 도면 2~18: 검출된 실제 배선 조각별 상태 반영
  Object.entries(overlayCustomEls).forEach(([id,item])=>{
    // 도면상 비접속/분리 회로는 출력이 켜져 있어도 통전선으로 표시하지 않는다.
    const blocked = OVERLAY_NEVER_ENERGIZE[String(dnum)]?.has(id);
    item.el.classList.toggle('on', !blocked && detectedFlowState(dnum,cfg,item.state));
  });
  const labels = DIAGRAM_ROW_LABELS[String(dnum)] || Object.keys(cfg.x);
  labels.forEach(label=>{
    const on = overlayTerminalOn(dlrResolve(dnum,label));
    overlayCoilEls[label]?.classList.toggle('on', !!on);
  });

}

function execute(program, master){
  const stack = [];
  for(const ins of program){
    const op = ins[0];
    if(op==='LOAD') stack.push(plc.get(ins[1]));
    else if(op==='LOAD_NOT') stack.push(!plc.get(ins[1]));
    else if(op==='LOADP') stack.push(plc.get(ins[1]) && !plc.prev[ins[1]]);
    else if(op==='AND') stack[stack.length-1] = stack[stack.length-1] && plc.get(ins[1]);
    else if(op==='AND_NOT') stack[stack.length-1] = stack[stack.length-1] && !plc.get(ins[1]);
    else if(op==='OR') stack[stack.length-1] = stack[stack.length-1] || plc.get(ins[1]);
    else if(op==='OR_NOT') stack[stack.length-1] = stack[stack.length-1] || !plc.get(ins[1]);
    else if(op==='AND_LOAD'){ const b=stack.pop(), a=stack.pop(); stack.push(a&&b); }
    else if(op==='OR_LOAD'){ const b=stack.pop(), a=stack.pop(); stack.push(a||b); }
    else if(op==='MPUSH'){ master.push(stack[stack.length-1]); }
    else if(op==='MLOAD'){ stack.push(master[master.length-1]); }
    else if(op==='MPOP'){ stack.push(master.pop()); }
    else if(op==='CMP'){
      const base=ins[1], cmp=ins[2];
      const dev = DEVICE_ALIAS[ins[4]] || ins[4];
      let k = ins[3];
      let lo = ins[5]||0;
      if(dev==='T0000'){
        // FR 전체주기가 원본 40(4.0s) 기준으로 0/20/40 형태의 절반값 상수로 짜여 있었으므로,
        // 사용자가 바꾼 새 주기에 맞춰 그 비율(현재주기/40) 그대로 스케일링 (항상 정확히 반/반)
        const scale = TIMER_OVERRIDE.T0000/40;
        k = Math.round(k*scale); lo = Math.round(lo*scale);
      } else if(dev==='T0003'){
        // 긴FR도 FR과 동일한 방식: 원본 140(14.0s) 기준 0/70/140 절반값 상수를 새 주기 비율로 스케일링
        const scale = TIMER_OVERRIDE.T0003/140;
        k = Math.round(k*scale); lo = Math.round(lo*scale);
      }
      const t = plc.timers[dev];
      const val = t ? t.acc : 0;
      // 원본 XG5000 비교식은 "AND>[K] [DEV] [LO]" 형태로 [LO, K] 구간을 나타내는 범위 비교였음
      // (예: FR 0~20구간 vs 20~40구간으로 BZ/YL이 서로 겹치지 않고 번갈아 켜짐)
      const res = cmp==='>' ? (val>lo && val<=k) : (val>=lo && val<k);
      if(base==='AND') stack[stack.length-1] = stack[stack.length-1] && res;
      else if(base==='OR') stack[stack.length-1] = stack[stack.length-1] || res;
      else if(base==='LOAD') stack.push(res);
    }
    else if(op==='OUT'){ plc.set(ins[1], stack[stack.length-1]); }
    else if(op==='TON'){
      const name = DEVICE_ALIAS[ins[1]] || ins[1];
      const en=stack[stack.length-1];
      let preset=ins[2];
      if(TIMER_OVERRIDE.hasOwnProperty(name)) preset = TIMER_OVERRIDE[name];
      let t = plc.timers[name];
      if(!t){ t={preset:preset,acc:0,done:false,en:false}; plc.timers[name]=t; }
      t.preset = preset;
      t.en = en;
      if(en){ if(t.acc<preset) t.acc++; t.done = t.acc>=preset; }
      else { t.acc=0; t.done=false; }
      plc.set(name, t.done);
    }
  }
}

function runDiagram(dnum, inputBits){
  for(const k in inputBits) plc.set(k, inputBits[k]);
  const prog = NEW_DIAGRAMS[dnum];
  if(prog){
    execute(prog, []);
  } else {
    // 정의되지 않은 도면 번호: 모든 출력 소자
    ['P00020','P00021','P00022','P00023','P00026','M00000','M00001','M00002','M00003','M00004'].forEach(a=>plc.set(a,false));
  }
  plc.prev = Object.assign({}, plc.bits);
}

// ============================================================
// I/O 정의 (실제 디바이스 주소 매핑)
// ============================================================
const switches = [
  {id:'eocr',label:'EOCR', desc:'과부하',     off:'정상', on:'트립', addr:'P00007', row:1},
  {id:'ss',  label:'SS',   desc:'수동/자동', off:'M', on:'A', addr:'P00003', row:1},
  {id:'fls', label:'FLS',  desc:'플로트',     off:'OFF', on:'ON', addr:'P00004', row:1},
  {id:'ls1', label:'LS1',  desc:'리밋1',      off:'OFF', on:'ON', addr:'P00005', row:2},
  {id:'ls2', label:'LS2',  desc:'리밋2',      off:'OFF', on:'ON', addr:'P00006', row:2},
];
const buttons = [
  {id:'pb0', label:'PB0', desc:'정지', cls:'pb0', addr:'P00000'},
  {id:'pb1', label:'PB1', desc:'기동1', cls:'pb1', addr:'P00001'},
  {id:'pb2', label:'PB2', desc:'기동2', cls:'pb2', addr:'P00002'},
];
const diagramBits = [
  {id:'d16', label:'16', addr:'P0000E', weight:16},
  {id:'d8',  label:'8',   addr:'P0000D', weight:8},
  {id:'d4',  label:'4',   addr:'P0000C', weight:4},
  {id:'d2',  label:'2',   addr:'P0000B', weight:2},
  {id:'d1',  label:'1',   addr:'P0000A', weight:1},
];
const lamps = [
  {id:'rl',  label:'RL', desc:'적색등(MC1 연동)', color:'red'},
  {id:'gl',  label:'GL', desc:'녹색등(MC2 연동)', color:'green'},
  {id:'yl',  label:'YL', desc:'황색등', color:'yellow'},
  {id:'wl',  label:'WL', desc:'백색등', color:'white'},
  {id:'mc1', label:'MC1', desc:'전자접촉기1', color:'red'},
  {id:'mc2', label:'MC2', desc:'전자접촉기2', color:'blue'},
];

// UI 상태 (스위치/버튼/칩의 현재 위치) — 실제 PLC 입력 비트로 매핑됨
const ui = { ss:false, fls:false, ls1:false, ls2:false, eocr:false,
             pb0:false, pb1:false, pb2:false,
             d16:false, d8:false, d4:false, d2:false, d1:true };

let soundOn = true;
let audioCtx = null;
function ensureAudio(){
  if(!audioCtx){ try{ audioCtx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} }
}
let buzzerNodes = null;
function startBuzzer(){
  if(!soundOn) return;
  ensureAudio();
  if(!audioCtx || buzzerNodes) return;
  try{
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const filt = audioCtx.createBiquadFilter();
    const g = audioCtx.createGain();
    const lfo = audioCtx.createOscillator();
    const lfoGain = audioCtx.createGain();
    o.type = 'sawtooth'; o.frequency.value = 740;
    filt.type = 'lowpass'; filt.frequency.value = 1400; filt.Q.value = 0.7;
    lfo.type = 'square'; lfo.frequency.value = 110; // 부저 특유의 "지지직"거리는 버즈감
    lfoGain.gain.value = 0.035;
    lfo.connect(lfoGain); lfoGain.connect(g.gain);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t+0.02);
    o.connect(filt); filt.connect(g); g.connect(audioCtx.destination);
    o.start(t); lfo.start(t);
    buzzerNodes = {o, g, lfo};
  }catch(e){}
}
function stopBuzzer(){
  if(!buzzerNodes) return;
  try{
    const {o, g, lfo} = buzzerNodes;
    const t = audioCtx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t+0.04);
    o.stop(t+0.06); lfo.stop(t+0.06);
  }catch(e){}
  buzzerNodes = null;
}
// 짧은 필터링 노이즈 클릭 (기계식 접점/버튼/스위치 소리의 재료)
function playNoiseClick({freq=3000, q=1.2, type='bandpass', duration=0.02, gain=0.3, attack=0.0008}={}){
  ensureAudio();
  if(!audioCtx) return;
  try{
    const t = audioCtx.currentTime;
    const bufferSize = Math.max(1, Math.floor(audioCtx.sampleRate*duration));
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for(let i=0;i<bufferSize;i++){ data[i] = Math.random()*2-1; }
    const src = audioCtx.createBufferSource(); src.buffer = buffer;
    const filt = audioCtx.createBiquadFilter();
    filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t+attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t+duration);
    src.connect(filt); filt.connect(g); g.connect(audioCtx.destination);
    src.start(t);
  }catch(e){}
}
// 낮은 "퉁" 하는 기계적 질량감 (버튼/접촉기용)
function playThump({freq=120, toFreq=55, duration=0.09, gain=0.25}={}){
  ensureAudio();
  if(!audioCtx) return;
  try{
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(toFreq, t+duration);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t+duration);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t); o.stop(t+duration+0.02);
  }catch(e){}
}
// 로터리 셀렉터 스위치의 "딸깍" 디텐트 소리 (짧은 이중 클릭)
function playSwitchClick(){
  if(!soundOn) return;
  playNoiseClick({freq:4800, q:3, type:'bandpass', duration:0.01, gain:0.3, attack:0.0006});
  setTimeout(()=>{ if(soundOn) playNoiseClick({freq:3600, q:3, type:'bandpass', duration:0.012, gain:0.22, attack:0.0006}); }, 18);
}
// 전자접촉기(MC1/MC2)가 붙거나 떨어질 때 나는 "철컥" 소리 (금속성 클릭 + 저음 질량감)
function playContactorClack(){
  if(!soundOn) return;
  playNoiseClick({freq:2400, q:1.4, type:'bandpass', duration:0.014, gain:0.4, attack:0.0004});
  playThump({freq:140, toFreq:50, duration:0.1, gain:0.3});
}
// 푸시버튼(PB0/1/2)을 누르거나 뗄 때 나는 눌림 소리 (부드러운 저음 통 + 살짝의 클릭)
function playButtonClick(pressedOn){
  if(!soundOn) return;
  playNoiseClick({freq: pressedOn?900:1300, q:0.8, type:'lowpass', duration:0.03, gain:0.28, attack:0.001});
  playThump({freq: pressedOn?95:135, toFreq: pressedOn?45:75, duration:0.055, gain:0.16});
}
// 도면 선택 칩을 누를 때 나는 가벼운 "틱" 소리
function playChipClick(){
  if(!soundOn) return;
  playNoiseClick({freq:2600, q:2, type:'highpass', duration:0.014, gain:0.18, attack:0.0006});
}

// ============================================================
// Build UI
// ============================================================
const switchBlock = document.getElementById('switchBlock');
const switchRowTop = document.getElementById('switchRowTop');
const switchRowMiddle = document.getElementById('switchRowMiddle');
const SWITCH_ROW_EL = {1:switchRowTop, 2:switchRowMiddle};
switches.forEach(sw=>{
  const unit = document.createElement('div');
  unit.className='switch-unit';
  unit.dataset.on='false';
  unit.dataset.id=sw.id;
  unit.innerHTML = `
    <div class="switch-knob-wrap">
      <div class="switch-tick tick-off"></div>
      <div class="switch-tick tick-on"></div>
      <div class="switch-lever"></div>
    </div>
    <div class="switch-label">${sw.label}</div>
    <div class="switch-state">${sw.desc} · <span class="st-txt">${sw.off}</span></div>
  `;
  unit.addEventListener('click', ()=>{ ui[sw.id] = !ui[sw.id]; playSwitchClick(); logAction(sw.id, ui[sw.id]); });
  (SWITCH_ROW_EL[sw.row] || switchRowTop).appendChild(unit);
});

// LS1·LS2 옆에 T0~T3 타이머 경과/설정 시간 미니 표시판
const TIMER_MINI_LIST = [
  {id:'T0000', label:'FR'},
  {id:'T0001', label:'T1'},
  {id:'T0002', label:'T2'},
  {id:'T0003', label:'긴FR'},
];
const PRESET_FALLBACK = { T0000:40, T0001:50, T0002:50, T0003:140 };
const timerMiniPanel = document.createElement('div');
timerMiniPanel.className = 'timer-mini-panel';
timerMiniPanel.id = 'timerMiniPanel';
timerMiniPanel.innerHTML = `
  <div class="timer-mini-title">TIME</div>
  ${TIMER_MINI_LIST.map(tm=>`<div class="timer-mini-row" data-id="${tm.id}"><span class="tm-label">${tm.label}</span><span class="tm-val">0.0/0.0</span></div>`).join('')}
`;
switchRowMiddle.appendChild(timerMiniPanel);

const lampBlock = document.getElementById('lampBlock');
lamps.forEach(l=>{
  const unit = document.createElement('div');
  unit.className='lamp-unit';
  unit.innerHTML = `
    <div class="lamp ${l.color}" data-id="${l.id}"></div>
    <div class="lamp-name">${l.label}</div>
    <div class="lamp-desc">${l.desc}</div>
  `;
  lampBlock.appendChild(unit);
});
const bzUnit = document.createElement('div');
bzUnit.className='lamp-unit';
bzUnit.innerHTML = `
  <div class="buzzer" id="bzLamp">🔔</div>
  <div class="lamp-name">BZ</div>
  <div class="lamp-desc">부저</div>
`;
lampBlock.appendChild(bzUnit);

const btnBlock = document.getElementById('btnBlock');
buttons.forEach(b=>{
  const unit = document.createElement('div');
  unit.className='btn-unit';
  unit.innerHTML = `
    <button class="pbtn ${b.cls}" data-id="${b.id}">${b.label}</button>
    <div class="btn-desc">${b.desc}</div>
  `;
  const btn = unit.querySelector('button');
  const toggle = (e)=>{
    e.preventDefault();
    ui[b.id] = !ui[b.id];
    btn.classList.toggle('pressed', ui[b.id]);
    playButtonClick(ui[b.id]);
    logAction(b.id, ui[b.id]);
  };
  btn.addEventListener('pointerdown', toggle);
  btnBlock.appendChild(unit);
});

const chipRow = document.getElementById('chipRow');
diagramBits.forEach(bit=>{
  const unit = document.createElement('div');
  unit.className='chip-unit';
  unit.innerHTML = `
    <div class="chip" data-id="${bit.id}">${bit.weight}</div>
    <div class="chip-name">${bit.label}</div>
    <div class="chip-addr">${bit.addr}</div>
  `;
  unit.querySelector('.chip').addEventListener('click', ()=>{
    ui[bit.id] = !ui[bit.id];
    playChipClick();
    renderDiagramNumber();
    logAction(bit.id, ui[bit.id]);
  });
  chipRow.appendChild(unit);
});
function renderDiagramNumber(){
  let sum = 0;
  diagramBits.forEach(bit=>{
    const el = chipRow.querySelector(`[data-id="${bit.id}"]`);
    const on = ui[bit.id];
    el.classList.toggle('on', on);
    if(on) sum += bit.weight;
  });
  const readout = document.getElementById('diagramReadout');
  readout.textContent = sum;
  readout.classList.toggle('invalid', sum < 1 || sum > 18);

  // 원본 도면 이미지 표시
  const img = document.getElementById('diagramImage');
  const emptyMsg = document.getElementById('diagramImageEmpty');
  const titleEl = document.getElementById('diagramImageTitle');
  const src = DIAGRAM_IMAGES[String(sum)];
  if(src){
    img.src = src;
    img.classList.add('show');
    emptyMsg.classList.add('hide');
    titleEl.textContent = `원본 도면 ${sum}번`;
  } else {
    img.classList.remove('show');
    img.removeAttribute('src');
    emptyMsg.classList.remove('hide');
    titleEl.textContent = '도면 미리보기';
  }

  buildDiagramLiveRow(sum);
  renderExplanation(sum);
}
renderDiagramNumber();

// 도면 이미지 확대보기(라이트박스)
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');
document.getElementById('diagramImage').addEventListener('click', ()=>{
  const src = document.getElementById('diagramImage').src;
  if(!src) return;
  lightboxImg.src = src;
  lightbox.classList.add('open');
});
lightbox.addEventListener('click', ()=>{ lightbox.classList.remove('open'); lightboxImg.src=''; });

// ---- 내부 릴레이(X0~X4) / 타이머(T0~T3) 표시등 ----
const RELAYS = [
  {id:'M00000', label:'X0'}, {id:'M00001', label:'X1'}, {id:'M00002', label:'X2'},
  {id:'M00003', label:'X3'}, {id:'M00004', label:'X4'},
];
const TIMERS_DISP = [
  {id:'T0000', label:'T0(FR)'}, {id:'T0001', label:'T1'},
  {id:'T0002', label:'T2'}, {id:'T0003', label:'T3(긴FR)'},
];
const relayRow = document.getElementById('relayRow');
RELAYS.forEach(r=>{
  const unit = document.createElement('div');
  unit.className = 'relay-unit';
  unit.innerHTML = `<div class="relay-led" data-id="${r.id}"></div><div class="relay-name">${r.label}</div>`;
  relayRow.appendChild(unit);
});
const timerRow = document.getElementById('timerRow');
TIMERS_DISP.forEach(t=>{
  const unit = document.createElement('div');
  unit.className = 'relay-unit';
  unit.innerHTML = `<div class="relay-led timer-led" data-id="${t.id}"></div><div class="relay-name">${t.label}</div>`;
  timerRow.appendChild(unit);
});
function renderInternal(){
  RELAYS.forEach(r=>{
    const el = relayRow.querySelector(`[data-id="${r.id}"]`);
    el.classList.toggle('on', plc.get(r.id));
  });
  TIMERS_DISP.forEach(t=>{
    const el = timerRow.querySelector(`[data-id="${t.id}"]`);
    const timer = plc.timers[t.id];
    el.classList.toggle('on', !!(timer && timer.en));
  });
}

document.getElementById('soundBtn').addEventListener('click', (e)=>{
  soundOn = !soundOn;
  e.target.textContent = soundOn ? '🔊 소리 켜짐' : '🔇 소리 꺼짐';
  if(!soundOn) stopBuzzer();
  saveConfig();
});
document.getElementById('frSetInput').addEventListener('input', (e)=>{
  const sec = parseFloat(e.target.value);
  if(!isNaN(sec) && sec>0){ TIMER_OVERRIDE.T0000 = Math.round(sec*10); saveConfig(); }
});
document.getElementById('longFrSetInput').addEventListener('input', (e)=>{
  const sec = parseFloat(e.target.value);
  if(!isNaN(sec) && sec>0){ TIMER_OVERRIDE.T0003 = Math.round(sec*10); saveConfig(); }
});
document.getElementById('t1SetInput').addEventListener('input', (e)=>{
  const sec = parseFloat(e.target.value);
  if(!isNaN(sec) && sec>0){ TIMER_OVERRIDE.T0001 = Math.round(sec*10); saveConfig(); }
});
document.getElementById('t2SetInput').addEventListener('input', (e)=>{
  const sec = parseFloat(e.target.value);
  if(!isNaN(sec) && sec>0){ TIMER_OVERRIDE.T0002 = Math.round(sec*10); saveConfig(); }
});
document.getElementById('resetBtn').addEventListener('click', ()=>{
  Object.keys(ui).forEach(k=> ui[k]=false);
  ui.d1 = true; // 도면 1번을 패널 기본 화면으로 유지
  plc.bits={}; plc.prev={}; plc.timers={};
  document.querySelectorAll('.pbtn').forEach(b=>b.classList.remove('pressed'));
  stopBuzzer(); prevBz=false;
  renderDiagramNumber();
  clearActionLog();
  quizPending = null;
  document.getElementById('quizAnswerOn').style.display = 'none';
  document.getElementById('quizAnswerOff').style.display = 'none';
  document.getElementById('quizQuestion').textContent = '"🎲 새 문제" 버튼을 눌러 시작하세요. (먼저 도면 번호를 선택해주세요)';
  document.getElementById('quizResult').textContent = '';
  // ※ FR/T1/T2 설정값과 소리 설정은 전원 재투입 개념이므로 리셋해도 유지됩니다.
});

// ============================================================
// Simulation loop — 100ms = PLC 타이머 1스캔 단위(0.1s)
// ============================================================
let prevBz=false;
let prevMc1=false, prevMc2=false;
function currentDiagramNumber(){
  let n = 0;
  if(ui.d1) n+=1; if(ui.d2) n+=2; if(ui.d4) n+=4; if(ui.d8) n+=8; if(ui.d16) n+=16;
  return n;
}
function tick(){
  const inputBits = {
    P00000: ui.pb0, P00001: ui.pb1, P00002: ui.pb2,
    P00003: ui.ss,  P00004: ui.fls, P00005: ui.ls1,
    P00006: ui.ls2, P00007: ui.eocr,
    P0000A: ui.d1,  P0000B: ui.d2,  P0000C: ui.d4,
    P0000D: ui.d8,  P0000E: ui.d16,
  };
  const dnum = currentDiagramNumber();
  runDiagram(dnum, inputBits);
  render();
}

function render(){
  renderInternal();
  updatePowerCircuit();
  updateRunStatusBadge();
  updateDiagramLiveRow();
  updateDiagramOverlay();
  switches.forEach(sw=>{
    const unit = switchBlock.querySelector(`[data-id="${sw.id}"]`);
    const on = ui[sw.id];
    unit.dataset.on = on ? 'true':'false';
    unit.querySelector('.st-txt').textContent = on ? sw.on : sw.off;
  });

  TIMER_MINI_LIST.forEach(tm=>{
    const row = timerMiniPanel.querySelector(`[data-id="${tm.id}"]`);
    const timer = plc.timers[tm.id];
    const preset = timer ? timer.preset : (TIMER_OVERRIDE.hasOwnProperty(tm.id) ? TIMER_OVERRIDE[tm.id] : PRESET_FALLBACK[tm.id]);
    const acc = timer ? timer.acc : 0;
    row.querySelector('.tm-val').textContent = `${(acc/10).toFixed(1)}/${(preset/10).toFixed(1)}`;
    row.classList.toggle('active', !!(timer && timer.en));
  });

  const mc1 = plc.get('P00022'), mc2 = plc.get('P00023');
  if(mc1 !== prevMc1) playContactorClack();
  if(mc2 !== prevMc2) playContactorClack();
  prevMc1 = mc1; prevMc2 = mc2;
  const lampVal = {
    rl: mc1, gl: mc2,
    yl: plc.get('P00020'),
    wl: plc.get('P00026'),
    mc1: mc1, mc2: mc2,
  };
  lamps.forEach(l=>{
    const el = lampBlock.querySelector(`.lamp[data-id="${l.id}"]`);
    el.classList.toggle('on', !!lampVal[l.id]);
  });
  const bz = plc.get('P00021');
  const bzEl = document.getElementById('bzLamp');
  bzEl.classList.toggle('on', bz);
  if(bz && !prevBz) startBuzzer();
  if(!bz && prevBz) stopBuzzer();
  prevBz = bz;

  const t = (name)=> plc.timers[name] ? (plc.timers[name].acc/10).toFixed(1)+'s / '+(plc.timers[name].preset/10).toFixed(1)+'s' : '0.0s';
  const grid = document.getElementById('statusGrid');
  grid.innerHTML = `
    <div><span>모드</span><span>${ui.ss ? '자동(A)':'수동(M)'}</span></div>
    <div><span>EOCR</span><span>${ui.eocr ? '트립':'정상'}</span></div>
    <div><span>X (M00000)</span><span>${plc.get('M00000')}</span></div>
    <div><span>X1 (M00001)</span><span>${plc.get('M00001')}</span></div>
    <div><span>X2 (M00002)</span><span>${plc.get('M00002')}</span></div>
    <div><span>X3/X4</span><span>${plc.get('M00003')} / ${plc.get('M00004')}</span></div>
    <div><span>T0000(FR)</span><span>${t('T0000')}</span></div>
    <div><span>T0001(T)</span><span>${t('T0001')}</span></div>
    <div><span>T0002(T_2)</span><span>${t('T0002')}</span></div>
    <div><span>T0003(긴FR)</span><span>${t('T0003')}</span></div>
  `;
}

// ============================================================
// 동작 로그 / 리플레이
// ============================================================
let actionLog = [];
let logStartTime = performance.now();
let isReplaying = false;
const LOG_LABELS = {};
switches.forEach(sw=> LOG_LABELS[sw.id]=sw.label);
buttons.forEach(b=> LOG_LABELS[b.id]=b.label);
diagramBits.forEach(bit=> LOG_LABELS[bit.id]=`도면칩 ${bit.weight}`);

function logAction(id, value){
  if(isReplaying) return;
  actionLog.push({t: performance.now()-logStartTime, id, value});
  renderActionLog();
}
function renderActionLog(){
  const box = document.getElementById('actionLogList');
  if(!box) return;
  if(actionLog.length===0){ box.innerHTML = '<span style="color:var(--muted);">기록된 동작이 없습니다.</span>'; return; }
  box.innerHTML = actionLog.map(a=>{
    const label = LOG_LABELS[a.id] || a.id;
    return `<div>[${(a.t/1000).toFixed(1)}s] ${label} → ${a.value?'ON':'OFF'}</div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}
function clearActionLog(){
  actionLog = [];
  logStartTime = performance.now();
  renderActionLog();
}
function applyLoggedChange(id, value){
  ui[id] = value;
  if(switches.some(s=>s.id===id)){
    playSwitchClick();
  } else if(buttons.some(b=>b.id===id)){
    const btnEl = document.querySelector(`.pbtn[data-id="${id}"]`);
    if(btnEl) btnEl.classList.toggle('pressed', value);
    playButtonClick(value);
  } else if(diagramBits.some(d=>d.id===id)){
    playChipClick();
    renderDiagramNumber();
  }
}
function replayLog(){
  if(actionLog.length===0 || isReplaying) return;
  isReplaying = true;
  const btn = document.getElementById('replayBtn');
  btn.textContent = '⏸ 재생 중...';
  document.querySelector('.board').classList.add('replaying');
  actionLog.forEach(entry=>{
    setTimeout(()=>{ applyLoggedChange(entry.id, entry.value); }, entry.t / simSpeed);
  });
  const totalTime = (actionLog[actionLog.length-1].t / simSpeed) + 300;
  setTimeout(()=>{
    isReplaying = false;
    btn.textContent = '▶ 재생';
    document.querySelector('.board').classList.remove('replaying');
  }, totalTime);
}
document.getElementById('replayBtn').addEventListener('click', replayLog);
document.getElementById('clearLogBtn').addEventListener('click', clearActionLog);
renderActionLog();

// ============================================================
// 도면별 동작 해설 (AI가 IL 코드를 분석한 설명, 도면 선택 시 자동 표시)
// ============================================================
function renderExplanation(dnum){
  const tagEl = document.getElementById("explainTag");
  const summaryEl = document.getElementById("explainSummary");
  const toggleEl = document.getElementById("explainDetailToggle");
  const listEl = document.getElementById("explainList");
  const emptyEl = document.getElementById("explainEmpty");
  const exp = DIAGRAM_EXPLANATIONS[String(dnum)];
  if(exp){
    tagEl.style.display = "inline-block";
    tagEl.textContent = exp.tag;
    summaryEl.style.display = "block";
    summaryEl.textContent = exp.items[0] || "";
    const rest = exp.items.slice(1);
    if(rest.length){
      toggleEl.style.display = "block";
      listEl.innerHTML = rest.map(it=>`<li>${it}</li>`).join("");
    } else {
      toggleEl.style.display = "none";
      listEl.innerHTML = "";
    }
    emptyEl.style.display = "none";
  } else {
    tagEl.style.display = "none";
    summaryEl.style.display = "none";
    toggleEl.style.display = "none";
    listEl.innerHTML = "";
    emptyEl.style.display = "block";
  }
}


// ============================================================
// 🎲 예측 퀴즈 모드 — 수동으로 정답을 정해두지 않고, 실제 IL 실행 결과로 채점
// ============================================================
const QUIZ_INPUTS = [
  {id:'pb0', label:'PB0'}, {id:'pb1', label:'PB1'}, {id:'pb2', label:'PB2'},
  {id:'ss', label:'SS'}, {id:'fls', label:'FLS'}, {id:'ls1', label:'LS1'}, {id:'ls2', label:'LS2'},
];
const QUIZ_OUTPUTS = [
  {addr:'P00022', label:'MC1'}, {addr:'P00023', label:'MC2'},
  {addr:'P00020', label:'YL'}, {addr:'P00026', label:'WL'}, {addr:'P00021', label:'BZ'},
];
let quizScore = {correct:0, total:0};
let quizPending = null;

function pickQuizScenario(){
  const dnum = currentDiagramNumber();
  if(!dnum || dnum<1 || dnum>18){
    document.getElementById('quizQuestion').textContent = '먼저 도면 번호(1~18)를 선택해주세요.';
    return null;
  }
  const input = QUIZ_INPUTS[Math.floor(Math.random()*QUIZ_INPUTS.length)];
  const output = QUIZ_OUTPUTS[Math.floor(Math.random()*QUIZ_OUTPUTS.length)];
  return {input, output, dnum};
}
function startQuizQuestion(){
  const scenario = pickQuizScenario();
  if(!scenario) return;
  const isButton = buttons.some(b=>b.id===scenario.input.id);
  const currentVal = ui[scenario.input.id];
  const action = isButton ? (currentVal ? '떼면' : '누르면') : (currentVal ? 'OFF로 바꾸면' : 'ON으로 바꾸면');
  document.getElementById('quizQuestion').innerHTML =
    `<b>도면 ${scenario.dnum}번</b> · 지금 <b>${scenario.input.label}</b>을(를) <b>${action}</b>, 3초 뒤 <b>${scenario.output.label}</b>은 어떻게 될까요?`;
  document.getElementById('quizAnswerOn').style.display = 'inline-block';
  document.getElementById('quizAnswerOff').style.display = 'inline-block';
  document.getElementById('quizResult').textContent = '';
  quizPending = { inputId: scenario.input.id, isButton, outputAddr: scenario.output.addr, outputLabel: scenario.output.label };
}
function answerQuiz(predictOn){
  if(!quizPending) return;
  document.getElementById('quizAnswerOn').style.display = 'none';
  document.getElementById('quizAnswerOff').style.display = 'none';
  const { inputId, isButton, outputAddr, outputLabel } = quizPending;
  quizPending = null;
  ui[inputId] = !ui[inputId];
  if(isButton){
    const btnEl = document.querySelector(`.pbtn[data-id="${inputId}"]`);
    if(btnEl) btnEl.classList.toggle('pressed', ui[inputId]);
    playButtonClick(ui[inputId]);
  } else {
    playSwitchClick();
  }
  document.getElementById('quizResult').textContent = '⏳ 3초 후 결과 확인 중...';
  setTimeout(()=>{
    const actual = !!plc.get(outputAddr);
    const correct = actual === predictOn;
    quizScore.total++;
    if(correct) quizScore.correct++;
    document.getElementById('quizResult').innerHTML = correct
      ? `✅ 정답! ${outputLabel}은 실제로 <b>${actual?'ON':'OFF'}</b>이 됐어요.`
      : `❌ 오답. ${outputLabel}은 실제로 <b>${actual?'ON':'OFF'}</b>이 됐어요.`;
    document.getElementById('quizScore').textContent = `정답 ${quizScore.correct} / ${quizScore.total}`;
  }, 3000 / simSpeed);
}
document.getElementById('quizNewBtn').addEventListener('click', startQuizQuestion);
document.getElementById('quizAnswerOn').addEventListener('click', ()=>answerQuiz(true));
document.getElementById('quizAnswerOff').addEventListener('click', ()=>answerQuiz(false));

// ============================================================
// 실시간 동력회로 SVG — EOCR 트립 / MC1·MC2 여자 상태를 그대로 반영
// ============================================================
function pcSetContact(bladeId, outId, bodyId, fanId, on){
  const blade = document.getElementById(bladeId);
  const out = document.getElementById(outId);
  const body = document.getElementById(bodyId);
  const fan = document.getElementById(fanId);
  blade.classList.toggle('pc-closed', on);
  blade.setAttribute('y2', on ? 164 : 139);
  out.classList.toggle('pc-energized', on);
  body.classList.toggle('pc-energized', on);
  fan.classList.toggle('pc-spinning', on);
}
// 상단 "정상 동작" 배지 — EOCR 트립 시 빨간색 "EOCR 트립"으로 전환
function updateRunStatusBadge(){
  const badge = document.getElementById('runStatusBadge');
  if(!badge) return;
  const tripped = !!ui.eocr;
  badge.classList.toggle('trip', tripped);
  badge.innerHTML = tripped
    ? '<span class="run-status-dot"></span>EOCR 트립'
    : '<span class="run-status-dot"></span>정상 동작';
}
function updatePowerCircuit(){  const eocrTrip = !!ui.eocr;
  const mc1 = plc.get('P00022');
  const mc2 = plc.get('P00023');
  document.getElementById('pcEocrBox').classList.toggle('pc-tripped', eocrTrip);
  const lbl = document.getElementById('pcEocrLbl');
  lbl.classList.toggle('pc-tripped', eocrTrip);
  lbl.textContent = eocrTrip ? 'TRIP' : 'EOCR';
  const busOn = !eocrTrip;
  ['pcWireEocrOut','pcSplitBus','pcMc1Feed','pcMc2Feed'].forEach(id=>{
    document.getElementById(id).classList.toggle('pc-energized', busOn);
  });
  pcSetContact('pcMc1Blade','pcMc1Out','pcM1Body','pcM1Fan', mc1);
  pcSetContact('pcMc2Blade','pcMc2Out','pcM2Body','pcM2Fan', mc2);
}
document.getElementById('togglePowerPhotoBtn').addEventListener('click', (e)=>{
  const wrap = document.getElementById('powerPhotoWrap');
  const show = wrap.style.display === 'none';
  wrap.style.display = show ? 'block' : 'none';
  e.target.textContent = show ? '📷 사진 숨기기' : '📷 실제 배선 사진 보기';
});


// ============================================================
// 설정값 저장/복원 — 전원 재투입(새로고침) 시에도 유지, 전체 리셋에는 영향 없음
// ============================================================
const CFG_KEY = 'panel_cfg_v1';
function saveConfig(){
  try{
    localStorage.setItem(CFG_KEY, JSON.stringify({
      fr: TIMER_OVERRIDE.T0000, longFr: TIMER_OVERRIDE.T0003, t1: TIMER_OVERRIDE.T0001, t2: TIMER_OVERRIDE.T0002,
      sound: soundOn, speed: simSpeed
    }));
  }catch(e){}
}
function loadConfig(){
  try{
    const raw = localStorage.getItem(CFG_KEY);
    if(!raw) return;
    const cfg = JSON.parse(raw);
    if(typeof cfg.fr === 'number'){ TIMER_OVERRIDE.T0000 = cfg.fr; document.getElementById('frSetInput').value = (cfg.fr/10).toFixed(1); }
    if(typeof cfg.longFr === 'number'){ TIMER_OVERRIDE.T0003 = cfg.longFr; document.getElementById('longFrSetInput').value = (cfg.longFr/10).toFixed(1); }
    if(typeof cfg.t1 === 'number'){ TIMER_OVERRIDE.T0001 = cfg.t1; document.getElementById('t1SetInput').value = (cfg.t1/10).toFixed(1); }
    if(typeof cfg.t2 === 'number'){ TIMER_OVERRIDE.T0002 = cfg.t2; document.getElementById('t2SetInput').value = (cfg.t2/10).toFixed(1); }
    if(typeof cfg.sound === 'boolean'){
      soundOn = cfg.sound;
      document.getElementById('soundBtn').textContent = soundOn ? '🔊 소리 켜짐' : '🔇 소리 꺼짐';
    }
    if(typeof cfg.speed === 'number'){ simSpeed = cfg.speed; }
  }catch(e){}
}

// ============================================================
// 재생 속도 조절 (0.25x~4x) — 스캔당 시뮬레이션 시간(0.1s)은 동일, 실제 진행 속도만 변경
// ============================================================
let simSpeed = 1;
let tickInterval = null;
function startTickLoop(){
  if(tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(tick, 100/simSpeed);
}
document.querySelectorAll('.speed-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    simSpeed = parseFloat(btn.dataset.speed);
    document.querySelectorAll('.speed-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    startTickLoop();
    saveConfig();
  });
});

loadConfig();
document.querySelectorAll('.speed-btn').forEach(b=>{
  b.classList.toggle('active', parseFloat(b.dataset.speed) === simSpeed);
});
startTickLoop();
render();

// ---------- 아코디언 부드러운 펼침/접힘 + 접힌 상태 요약 표시 ----------
(function(){
  document.querySelectorAll('details.status').forEach(function(d){
    var summary = d.querySelector('summary');
    var wrap = document.createElement('div');
    wrap.className = 'details-content';
    var node = summary.nextSibling;
    while(node){
      var next = node.nextSibling;
      wrap.appendChild(node);
      node = next;
    }
    d.appendChild(wrap);
  });
})();

function updateAccordionSummaries(){
  var logSpan = document.getElementById('logStateSpan');
  if(logSpan) logSpan.textContent = actionLog.length ? ` — ${actionLog.length}건 기록됨` : ' — 기록 없음';

  var aiSpan = document.getElementById('aiStateSpan');
  if(aiSpan){
    var dnum = currentDiagramNumber();
    aiSpan.textContent = (dnum>=1 && dnum<=18) ? ` — 도면 ${dnum}번` : ' — 도면 미선택';
  }

  var quizSpan = document.getElementById('quizStateSpan');
  if(quizSpan) quizSpan.textContent = ` — 정답 ${quizScore.correct} / ${quizScore.total}`;

  var debugSpan = document.getElementById('debugStateSpan');
  if(debugSpan){
    debugSpan.textContent = ` — ${ui.ss ? '자동(A)':'수동(M)'} · EOCR ${ui.eocr ? '트립':'정상'}`;
  }

  var powerSpan = document.getElementById('powerStateSpan');
  if(powerSpan){
    var f1 = document.getElementById('pcM1Fan');
    var f2 = document.getElementById('pcM2Fan');
    var running = (f1 && f1.classList.contains('pc-spinning')) || (f2 && f2.classList.contains('pc-spinning'));
    powerSpan.textContent = running ? ' — 모터 구동 중' : ' — 정지';
  }
}
var _origRender = render;
render = function(){
  _origRender();
  updateAccordionSummaries();
};
updateAccordionSummaries();
