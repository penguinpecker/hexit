const LOCK_S=5.1+10/3-2.5;
function Phi(x){ const t=1/(1+0.2316419*Math.abs(x)), d=0.3989423*Math.exp(-x*x/2);
  const p=d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274)))); return x>0?1-p:p; }
function hexHits(a0,b0,a1,b1){ // Cyrus-Beck: does the segment meet the closed unit hex?
  const C=[[0,1,1],[0,-1,1],[2,1,2],[2,-1,2],[-2,1,2],[-2,-1,2]]; let lo=0,hi=1; const da=a1-a0, db=b1-b0;
  for(let q=0;q<6;q++){ const na=C[q][0], nb=C[q][1], num=C[q][2]+1e-12-(na*a0+nb*b0), den=na*da+nb*db;
    if(den>0){ const r=num/den; if(r<hi) hi=r; } else if(den<0){ const r=num/den; if(r>lo) lo=r; } else if(num<0) return false;
    if(lo>hi) return false; }
  return true; }
function hexU(sig,nph,dxf){ // sig in bands per sqrt(s); returns {x, u, dx} referenced to (left tip - DT)
  const R=10/3, DT=0.1, sd=sig*Math.sqrt(DT), dx=0.5/Math.ceil(0.5*dxf/sd), L=0.5+8*sig*Math.sqrt(2*R+DT)+5*sd, N=Math.ceil(L/dx), n=2*N;
  const x=new Float64Array(n); for(let i=0;i<n;i++) x[i]=(i-N+0.5)*dx;
  const K=Math.ceil(7*sd/dx), w=new Float64Array(2*K+1); for(let k=-K;k<=K;k++) w[k+K]=Phi((k+0.5)*dx/sd)-Phi((k-0.5)*dx/sd);
  const acc=new Float64Array(n);
  for(let ph=0;ph<nph;ph++){
    const phi=(ph+0.5)/nph*DT, t0=-R-phi, nseg=Math.ceil((R-t0)/DT-1e-9);
    let u=new Float64Array(n), v=new Float64Array(n);
    for(let s=nseg-1;s>=0;s--){ const ta=t0+s*DT, a0=ta/R, a1=(ta+DT)/R;
      for(let i=0;i<n;i++){ let sum=0; const b0=2*x[i];
        for(let k=-K;k<=K;k++){ const j=i+k;
          if(hexHits(a0,b0,a1,b0+2*k*dx)) sum+=w[k+K]; else if(j>=0&&j<n) sum+=w[k+K]*u[j]; }
        v[i]=sum; }
      const tmp=u; u=v; v=tmp; }
    const sv=sig*Math.sqrt(DT-phi), M=Math.ceil(6*sv/dx);      // carry this phase back to the common reference time
    for(let i=0;i<n;i++){ let sum=0; for(let m=-M;m<=M;m++){ const j=i+m; if(j<0||j>=n) continue; sum+=(Phi((m*dx+dx/2)/sv)-Phi((m*dx-dx/2)/sv))*u[j]; } acc[i]+=sum/nph; }
  }
  return {x:Array.from(x), u:Array.from(acc), dx};
}
// tables are built in a Web Worker (same functions) and cached per volatility bucket
function compact(r,sig){ // trim zeros and bin u to a coarse grid so each quote cell costs ~80 Phi evaluations
  const cw=sig*Math.sqrt(LOCK_S-0.1)/10, x=r.x, u=r.u, dx=r.dx; const bins=new Map();
  for(let i=0;i<x.length;i++){ if(u[i]<1e-12) continue; const b=Math.floor(x[i]/cw); bins.set(b,(bins.get(b)||0)+u[i]*dx); }
  const ks=[...bins.keys()].sort((a,b)=>a-b);
  return {sig, edges:ks.map(b=>b*cw), w:ks.map(b=>bins.get(b)/cw), cw};
}
function hexP(tab,sigUsed,d,lead){ // P(win) for a hex centred d bands from the price, lead = s until its left tip
  const sL=sigUsed*Math.sqrt(Math.max(lead-0.1,0.01)); let P=0;
  for(let i=0;i<tab.edges.length;i++){ const e=tab.edges[i]; P+=tab.w[i]*(Phi((e+tab.cw+d)/sL)-Phi((e+d)/sL)); }
  return P; }

const cases=[['SOL d=0 tau=7.6',0.2788,0,7.6,0.68387],['SOL d=3 tau=92.6',0.2788,3,92.6,0.14374],['ETH d=1 tau=12.6',0.04482,1,12.6,0.00640],['ETH d=0.25 tau=32.6',0.04482,0.25,32.6,0.87413]];
for(const [nph,dxf] of [[2,4],[8,8]]){ const t0=Date.now(); const tabs={};
  for(const [name,sig,d,tau,ref] of cases){ const k=sig; if(!tabs[k]) tabs[k]=compact(hexU(sig,nph,dxf),sig);
    const P=hexP(tabs[k],sig,d,tau); console.log(`nph=${nph} dxf=${dxf} ${name}: JS ${P.toFixed(5)} ref ${ref} rel ${(100*(P-ref)/ref).toFixed(2)}%`); }
  console.log('  build+eval ms',Date.now()-t0); }

