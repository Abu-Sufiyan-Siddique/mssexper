// app.js (ES Module) — MSS Expertise (Admin-only login, employee ID only)

// ===== Firebase imports (v10 ESM)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  updatePassword, signInAnonymously
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, collection, getDocs,
  query, where, orderBy, limit, startAfter, Timestamp, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import { sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

// ===== Your Firebase Config
export const firebaseConfig = {
  apiKey: "AIzaSyAXbQ1r7_pRbiyhnQniVLDEqsnUaarY_AI",
  authDomain: "mss-hrms.firebaseapp.com",
  projectId: "mss-hrms",
  storageBucket: "mss-hrms.firebasestorage.app",
  messagingSenderId: "127697749355",
  appId: "1:127697749355:web:89615d17eb009796dbb82e"
};

// ===== Initialize
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
// Keep this if you later re-enable callable backend:
const functions = getFunctions(app, 'asia-south1');

// ===== Auth helpers
export const onAuth = (cb) => onAuthStateChanged(auth, cb);
export const signInEmail = (email, pass) => signInWithEmailAndPassword(auth, email, pass);
export const signOutUser = () => signOut(auth);
export { updatePassword };

// ===== Utilities
export function deviceFingerprint(){
  const s = [
    navigator.userAgent, navigator.language, navigator.platform,
    `${screen.width}x${screen.height}`, screen.colorDepth,
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'NA'
  ].join('|');
  let h = 5381; for (let i=0;i<s.length;i++){ h=((h<<5)+h)+s.charCodeAt(i); }
  return 'dev_' + (h>>>0).toString(16);
}
export function ymd(d=new Date()){ const z=new Date(d.getTime()-d.getTimezoneOffset()*60000); return z.toISOString().slice(0,10); }
export function hhmm(d=new Date()){ return String(d.getHours()).padStart(2,'0')+":"+String(d.getMinutes()).padStart(2,'0'); }
export function minutesFromHHMM(s){ const [h,m]=s.split(':').map(Number); return h*60+(m||0); }
export function daysBetweenInclusive(start,end){ const s=new Date(start+"T00:00:00"), e=new Date((end||start)+"T00:00:00"); return Math.floor((e-s)/86400000)+1; }
export function toast(el, msg, type='ok'){ if(!el) return; el.className='msg '+(type==='ok'?'ok':type==='warn'?'warn':'err'); el.textContent=msg; }
export function downloadCSV(filename, rows){
  if(!rows||!rows.length) return;
  const headers = Object.keys(rows[0]);
  const esc = v => { const t=(v??'').toString().replace(/"/g,'""'); return /[",\n]/.test(t)?`"${t}"`:t; };
  const csv = [headers.join(',')].concat(rows.map(r=>headers.map(h=>esc(r[h])).join(','))).join('\n');
  const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url);
}

// ===== Config (Office timing)
export async function getConfig(){
  try{
    const ref=doc(db,'config','global'); const snap=await getDoc(ref);
    if(snap.exists()) return snap.data();
    const defaults={ officeStart:"10:00", lateAfter:"10:05", officeEnd:"18:00", earlyGraceMin:0, weekendDow:5 };
    await setDoc(ref, {...defaults, createdAt: serverTimestamp()});
    return defaults;
  }catch(e){ console.error(e); return { officeStart:"10:00", lateAfter:"10:05", officeEnd:"18:00", earlyGraceMin:0, weekendDow:5 }; }
}
export async function saveConfig(cfg){
  try{ await setDoc(doc(db,'config','global'), {...cfg, updatedAt: serverTimestamp()}, {merge:true}); }
  catch(e){ console.error(e); }
}

// ===== Admin helpers
export async function isAdmin(email){
  try{ const s=await getDoc(doc(db,'admins', (email||'').toLowerCase())); return s.exists() && (s.data().active!==false); }
  catch(e){ console.error(e); return false; }
}

// ===== Employees
export async function upsertEmployee(payload){
  try{
    if(!payload || !payload.employeeId) throw new Error('employeeId required');
    const employeeId = payload.employeeId.toUpperCase();
    await setDoc(doc(db,'employees', employeeId), {
      ...payload,
      employeeId,
      name: payload.name || '',
      phone: payload.phone || '',
      designation: payload.designation || '',
      status: payload.status || 'Active',
      updatedAt: serverTimestamp()
    }, {merge:true});
  }catch(e){ console.error(e); }
}
export async function getEmployee(id){
  try{ const s=await getDoc(doc(db,'employees', id.toUpperCase())); return s.exists()? s.data(): null; }
  catch(e){ console.error(e); return null; }
}
export async function setEmployeeDevice(id, deviceId){
  try{ await updateDoc(doc(db,'employees', id.toUpperCase()), { deviceId, updatedAt: serverTimestamp() }); }
  catch(e){ console.error(e); }
}
export async function listEmployees(){
  try{
    const snap=await getDocs(collection(db,'employees')); const rows=[];
    snap.forEach(s=>rows.push(s.data()));
    return rows.sort((a,b)=> a.employeeId.localeCompare(b.employeeId));
  }catch(e){ console.error(e); return []; }
}
export async function deactivateEmployee(id){
  try{ await setDoc(doc(db,'employees', id.toUpperCase()), { status:'Inactive', deviceId:'', updatedAt: serverTimestamp() }, {merge:true}); }
  catch(e){ console.error(e); }
}

// ===== Attendance
const attId = (date, id)=> `${date}_${id.toUpperCase()}`;
export async function getAttendance(date, id){
  try{ const s=await getDoc(doc(db,'attendance', attId(date,id))); return s.exists()? s.data(): null; }
  catch(e){ console.error(e); return null; }
}
export async function saveAttendanceRow(date,id,payload){
  try{ await setDoc(doc(db,'attendance', attId(date,id)), { ...payload, updatedAt: serverTimestamp() }, {merge:true}); }
  catch(e){ console.error(e); }
}

// Admin dashboard — attendance (paged by updatedAt desc)
export async function listAttendancePaged({limit: lim=30, cursor=null, direction='next'}={}){
  try{
    let q = query(collection(db,'attendance'), orderBy('updatedAt','desc'), limit(lim));
    if(cursor && cursor instanceof Timestamp){
      q = direction==='next'
        ? query(collection(db,'attendance'), orderBy('updatedAt','desc'), startAfter(cursor), limit(lim))
        : query(collection(db,'attendance'), orderBy('updatedAt','desc'), limit(lim));
    }
    const snap = await getDocs(q);
    const rows = [];
    let lastTs = null;
    snap.forEach(d=>{
      const data = d.data();
      rows.push(data);
      if(data.updatedAt) lastTs = data.updatedAt;
    });
    return { items: rows, nextCursor: lastTs };
  }catch(e){ console.error(e); return { items: [], nextCursor: null }; }
}

// Admin CSV — date-wise range
export async function listAttendanceRange({from,to}){
  try{
    const all = [];
    const snap = await getDocs(collection(db,'attendance'));
    snap.forEach(d=>{
      const x=d.data();
      if((!from||x.date>=from)&&(!to||x.date<=to)) all.push(x);
    });
    return all.sort((a,b)=> a.date===b.date ? a.employeeId.localeCompare(b.employeeId) : a.date.localeCompare(b.date));
  }catch(e){ console.error(e); return []; }
}

// ===== Leaves
export async function applyLeave(req){
  try{ await setDoc(doc(db,'leaves', req.id), { ...req, appliedAt: serverTimestamp() }, {merge:true}); }
  catch(e){ console.error(e); }
}
export async function listLeaves(filter={}){
  try{
    const snap=await getDocs(collection(db,'leaves')); const rows=[]; snap.forEach(s=>rows.push(s.data()));
    return rows
      .filter(x=>(!filter.from||x.startDate>=filter.from)&&(!filter.to||x.endDate<=filter.to))
      .sort((a,b)=> String(b.appliedAt||'').localeCompare(String(a.appliedAt||'')));
  }catch(e){ console.error(e); return []; }
}
export async function updateLeaveStatus(id,status,decidedBy){
  try{ await updateDoc(doc(db,'leaves', id), { status, decidedBy, decidedAt: serverTimestamp() }); }
  catch(e){ console.error(e); }
}

// Admin dashboard — leaves (paged by appliedAt desc)
export async function listLeavesPaged({limit: lim=10, cursor=null, direction='next'}={}){
  try{
    let q = query(collection(db,'leaves'), orderBy('appliedAt','desc'), limit(lim));
    if(cursor && cursor instanceof Timestamp){
      q = direction==='next'
        ? query(collection(db,'leaves'), orderBy('appliedAt','desc'), startAfter(cursor), limit(lim))
        : query(collection(db,'leaves'), orderBy('appliedAt','desc'), limit(lim));
    }
    const snap = await getDocs(q);
    const rows=[]; let lastTs=null;
    snap.forEach(d=>{
      const x=d.data(); rows.push(x); if(x.appliedAt) lastTs=x.appliedAt;
    });
    return { items: rows, nextCursor: lastTs };
  }catch(e){ console.error(e); return { items: [], nextCursor: null }; }
}

// ===== Anonymous auth for public pages
export async function ensureAnon(){ try{ if(!auth.currentUser) await signInAnonymously(auth); } catch(e){ console.warn('Anon auth failed', e?.message||e); } }

// ===== (Optional) Callable kept for future
export async function createEmployeeAuthUser(payload){
  const callable = httpsCallable(functions, 'createEmployeeUser');
  const res = await callable(payload);
  return res.data;
}
export async function sendWelcomePasswordEmail(email){
  const actionCodeSettings = { url: `${window.location.origin}/index.html`, handleCodeInApp: false };
  await sendPasswordResetEmail(auth, email, actionCodeSettings);
}