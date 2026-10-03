// 버튼을 누르지 않아도 자동으로 채워지는지 (실제 네트워크)
const fs=require('fs'),path=require('path'),{JSDOM}=require('jsdom');
const ROOT=process.argv[2];
const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const dom=new JSDOM(html,{url:'https://x.com/a/',pretendToBeVisual:true,runScripts:'outside-only'});
const {window}=dom, doc=window.document;
window.fetch=(...a)=>fetch(...a); window.AbortController=AbortController;
window.confirm=()=>true; window.speechSynthesis={cancel(){},speak(){},getVoices:()=>[]};
window.SpeechSynthesisUtterance=function(t){this.text=t};
Object.defineProperty(window.navigator,'onLine',{value:true,configurable:true});

// 한글이 하나도 없는 단어 3개를 미리 저장해 둔다
const mk=(id,word,defs)=>({id,word,addedAt:Date.now(),myMeaning:'',note:'',folder:'기본',
  stats:{fastStreak:0,seen:0,correct:0,fast:0,lastSeen:0,lastMs:0,mastered:false},
  meanings:[{pos:'adjective',posKo:'형용사',defs:defs.map(d=>({def:d,example:'',synonyms:[]}))}]});
window.localStorage.setItem('engvoc.v1', JSON.stringify({
  version:1,
  words:{
    resentful: mk('resentful','resentful',['Inclined to resent, who tends to harbor resentment, when wronged.']),
    cryogenic: mk('cryogenic','cryogenic',['Of, relating to, or performed at low temperatures.']),
    subtle:    mk('subtle','subtle',['Hard to grasp; not obvious or easily understood.'])
  },
  order:['resentful','cryogenic','subtle'], queue:['resentful','cryogenic','subtle'],
  folders:['기본'], recent:[], cache:{}, cacheOrder:[], trans:{}, transOrder:[],
  settings:{}, stats:{totalAnswers:0,fastAnswers:0}
}));

const errors=[];
window.addEventListener('error',e=>errors.push(e.message));
for(const f of ['js/store.js','js/api.js','js/review.js','js/app.js'])
  window.eval(fs.readFileSync(path.join(ROOT,f),'utf8'));

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const $=s=>doc.querySelector(s);
async function waitFor(fn,ms){const e=Date.now()+(ms||60000);while(Date.now()<e){if(fn())return true;await sleep(500)}return false}

let pass=0,fail=0;
const ok=(n,c,e)=>{if(c){pass++;console.log('  PASS  '+n)}else{fail++;console.log('  FAIL  '+n+(e!==undefined?'  -> '+JSON.stringify(e).slice(0,200):''))}};

(async()=>{
  await new Promise(r=>doc.readyState==='complete'?r():window.addEventListener('load',r));
  const Store=window.Store;

  console.log('\n[1] 시작 직후 상태');
  ok('자동 채우기 기본 켜짐', Store.settings().autoFill === true);
  const before = Store.favorites().filter(w=>w.defKo&&Object.keys(w.defKo).length).length;
  ok('처음에는 한글 없음', before === 0, before);

  console.log('\n[2] 버튼을 누르지 않고 기다리기 (최대 70초)');
  const t0=Date.now();
  const filled = await waitFor(()=>
    Store.favorites().filter(w=>w.defKo&&Object.keys(w.defKo).length).length >= 2, 70000);
  ok('자동으로 채워짐', filled, Store.favorites().map(w=>({w:w.word,ko:Object.keys(w.defKo||{}).length})));
  console.log('      걸린 시간: '+((Date.now()-t0)/1000).toFixed(0)+'초');

  Store.favorites().forEach(w=>{
    const d=w.defKo||{}; const k=Object.keys(d)[0];
    console.log('      '+w.word.padEnd(11)+(k?d[k].slice(0,45):'(아직)'));
  });

  console.log('\n[3] 진행 상태 표시');
  ok('설정 화면에 진행 문구', ($('#fillKoStatus').textContent||'').length > 0,
     $('#fillKoStatus').textContent);
  console.log('      문구: '+$('#fillKoStatus').textContent);

  console.log('\n[4] 오류 점검');
  ok('런타임 오류 없음', errors.length===0, errors);

  console.log('\n-------------------------');
  console.log(pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})();
