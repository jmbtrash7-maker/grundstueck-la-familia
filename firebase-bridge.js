// Grundstück La Familia – Firebase-Verbindung. Änderungen an der bestehenden App-Logik vermeiden.
// Firebase-Konfiguration ist öffentlich; die wirkliche Zugriffskontrolle erfolgt in firestore.rules.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, doc, collection, getDoc, getDocs, runTransaction, onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const configuration=window.LA_FIREBASE_CONFIG;
if(!configuration?.apiKey||!configuration?.projectId||!configuration?.authDomain||!configuration?.appId){
  window.LA_FIREBASE_RESOLVE(null);
} else {
  const app=initializeApp(configuration);
  const auth=getAuth(app), database=getFirestore(app);
  const familyId=configuration.familyId||'la-familia';
  const families=['Mama','Papa','Larissa','Caroline','Hannah','Julian'];
  const groups=['countries','regions','properties','sources','notes','tasks','activity','familyMembers','memberRatings','comparisons'];
  const globals=['profiles','weights','settings','activeProfile','ddTemplate'];
  const seed=JSON.parse(document.getElementById('initial-state').textContent);
  const familyDoc=(...path)=>doc(database,'families',familyId,...path);
  const familyCollection=(name)=>collection(database,'families',familyId,name);
  const serialize=x=>JSON.stringify(x===undefined?null:x);
  const copy=x=>JSON.parse(JSON.stringify(x));
  let unsubRecords=null,unsubGlobals=null,watchTimer=null;

  function currentUser(){
    return new Promise((resolve,reject)=>{
      const unsub=onAuthStateChanged(auth,user=>{unsub();resolve(user);},reject);
    });
  }
  async function memberFor(user){
    if(!user)throw new Error('Bitte mit deinem Familienkonto anmelden.');
    const snap=await getDoc(familyDoc('members',user.uid));
    if(!snap.exists())throw new Error('Dieses Konto ist noch keinem Familienmitglied zugeordnet. Bitte erst die Mitglieds-ID in Firebase eintragen.');
    const m=snap.data();
    if(!families.includes(m.name)||typeof m.memberId!=='string'||!m.memberId)throw new Error('Familienprofil ist unvollständig.');
    const exists=(seed.familyMembers||[]).some(x=>x.id===m.memberId && x.name===m.name);
    if(!exists)throw new Error('Die Profil-ID stimmt nicht. Bitte die Zuordnung in Firebase prüfen.');
    return {memberId:m.memberId,memberName:m.name};
  }
  function docId(group,id){if(!/^[A-Za-z0-9_.-]{1,128}$/.test(String(id)))throw Error('Ungültige Datensatz-ID.');return group+'__'+String(id);}
  function initialValue(group,id){
    if(groups.includes(group))return (seed[group]||[]).find(x=>x&&String(x.id)===String(id))||null;
    return seed[group]??null;
  }
  async function loadState(){
    const [records,metadata]=await Promise.all([getDocs(familyCollection('records')),getDocs(familyCollection('meta'))]);
    const obj=copy(seed);
    for(const snap of records.docs){
      const row=snap.data();if(!groups.includes(row.group)||typeof row.id!=='string')continue;
      obj[row.group]??=[];
      const at=obj[row.group].findIndex(x=>String(x.id)===row.id);
      if(row.deleted){if(at!==-1)obj[row.group].splice(at,1);}
      else if(row.value&&row.value.id===row.id){if(at!==-1)obj[row.group][at]=copy(row.value);else obj[row.group].push(copy(row.value));}
    }
    for(const snap of metadata.docs){const row=snap.data();if(globals.includes(row.group))obj[row.group]=copy(row.value);}
    return obj;
  }
  function watch(){
    if(unsubRecords||unsubGlobals)return;
    // Aktualisierung ohne Seitenreload, nur bei echten Änderungen nach dem ersten Snapshot.
    let firstR=true,firstM=true;
    const ping=()=>{if(watchTimer)clearTimeout(watchTimer);watchTimer=setTimeout(()=>window.dispatchEvent(new Event('la-family-cloud-change')),700)};
    unsubRecords=onSnapshot(familyCollection('records'),()=>{if(firstR){firstR=false;return;}ping();},e=>console.warn('Firestore Einträge:',e.message));
    unsubGlobals=onSnapshot(familyCollection('meta'),()=>{if(firstM){firstM=false;return;}ping();},e=>console.warn('Firestore Einstellungen:',e.message));
  }
  async function response(){
    const user=await currentUser();
    const member=await memberFor(user);
    const state=await loadState();
    watch();
    return {ok:true,state,...member};
  }
  const adapter={
    async landatlasLoad(email,password){
      const credential=await signInWithEmailAndPassword(auth,email,password);
      await memberFor(credential.user);
      return response();
    },
    async landatlasResume(){
      const user=await currentUser();
      if(!user)return null;
      return response();
    },
    async landatlasRefresh(){return response();},
    async landatlasLogout(){
      if(unsubRecords){unsubRecords();unsubRecords=null;}
      if(unsubGlobals){unsubGlobals();unsubGlobals=null;}
      if(watchTimer)clearTimeout(watchTimer);
      await signOut(auth);
      return {ok:true};
    },
    async landatlasApply(ops){
      const user=await currentUser(),mem=await memberFor(user);
      if(!Array.isArray(ops)||ops.length>400)throw Error('Zu viele Änderungen auf einmal. Bitte kleinere Backups importieren.');
      if(!ops.length)return response();
      const seen=new Set();
      const input=ops.map(op=>{
        if(!op||![...groups,...globals].includes(op.group))throw Error('Ungültige Datengruppe.');
        if(groups.includes(op.group)&&(!op.id||typeof op.id!=='string'))throw Error('Datensatz ohne ID.');
        const k=op.group+'__'+(op.id||'');if(seen.has(k))throw Error('Doppelte Änderung.');seen.add(k);
        if(op.after!==null&&serialize(op.after).length>750000)throw Error('Ein Datensatz ist zu groß für die Cloud. Bitte große Bilder als Links speichern.');
        return {op,ref:groups.includes(op.group)?familyDoc('records',docId(op.group,op.id)):familyDoc('meta',op.group)};
      });
      // Konflikte werden atomar im Firestore-Transaktionsblock überprüft, bevor etwas geschrieben wird.
      await runTransaction(database,async trx=>{
        const snaps=[];
        for(const row of input)snaps.push(await trx.get(row.ref));
        input.forEach(({op,ref},i)=>{
          const old=snaps[i].exists()?snaps[i].data():null;
          const current=old ? (old.deleted?null:old.value) : initialValue(op.group,op.id);
          if(serialize(current)!==serialize(op.before))throw Error('Änderungskonflikt: Ein Familienmitglied hat denselben Eintrag bereits bearbeitet. Bitte zuerst aktualisieren und deine Änderungen erneut prüfen.');
          if(op.after!==null&&groups.includes(op.group)&&String(op.after.id)!==String(op.id))throw Error('Ungültige Datensatz-ID.');
          if(['properties','sources','notes','activity','memberRatings','comparisons'].includes(op.group) && op.after!==null){
            if(!old && !initialValue(op.group,op.id) && op.after.memberId!==mem.memberId)throw Error('Ein neuer Eintrag muss zu deinem eigenen Familienprofil gehören.');
            if((old?.value?.memberId||current?.memberId)&&op.after.memberId!==(old?.value?.memberId||current?.memberId))throw Error('Die ursprüngliche Familienzuordnung darf nicht geändert werden.');
            if(op.group==='memberRatings'&&op.after.memberId!==mem.memberId)throw Error('Du darfst nur deine eigenen Bewertungen bearbeiten.');
          }
          if(op.group==='familyMembers' && (op.after===null || op.after.id!==mem.memberId))throw Error('Du darfst nur deine eigenen Familieneinstellungen bearbeiten.');
          if(groups.includes(op.group))trx.set(ref,{group:op.group,id:op.id,value:op.after,deleted:op.after===null,editedBy:user.uid,updatedAt:serverTimestamp()});
          else trx.set(ref,{group:op.group,value:op.after,editedBy:user.uid,updatedAt:serverTimestamp()});
        });
      });
      return response();
    }
  };
  window.LA_FIREBASE_RESOLVE(adapter);
}
