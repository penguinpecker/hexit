# Independent MC check of hex tap pricing (does not import hex_pricing.py).
import numpy as np, math, sys
R = 10/3; DT = 0.1
SEC_YR = math.sqrt(365*86400)
SIG = {'SOL': 0.65*120.45/SEC_YR/0.05, 'ETH': 0.0464*2712.3/SEC_YR/0.5}  # bands/sqrt(s)
KAP = np.array([1, 1.5, 3]); W = np.array([.6, .3, .1])
# hex in (a,b): |b|<=1, 2|a|+|b|<=2 ; rect: |a_r|<=1 (a_r=(t-tc)/2.5), |b|<=1
HEXN = np.array([[0,1],[0,-1],[2,1],[2,-1],[-2,1],[-2,-1]],float); HEXC = np.array([1,1,2,2,2,2],float)
RECN = np.array([[0,1],[0,-1],[1,0],[-1,0]],float); RECC = np.ones(4)

def seg_hit(a0,b0,a1,b1,N,C):
    lo = np.zeros_like(a0); hi = np.ones_like(a0); miss = np.zeros(a0.shape,bool)
    da, db = a1-a0, b1-b0
    for (na,nb),c in zip(N,C):
        num = c-(na*a0+nb*b0); den = na*da+nb*db
        miss |= (den==0)&(num<0)
        with np.errstate(divide='ignore',invalid='ignore'):
            r = num/den
        hi = np.where(den>0, np.minimum(hi,r), hi); lo = np.where(den<0, np.maximum(lo,r), lo)
    return (~miss)&(lo<=hi)

def mc(sig, d, tau, shape='hex', n=200_000, dt=DT, mix=False, jitter=False, rng=None, chunk=50_000):
    """tau = lead from now to earliest point of region; d = (centre - S0) in bands."""
    rng = rng or np.random.default_rng(1)
    half = R if shape=='hex' else 2.5
    tc = tau + half; N, C = (HEXN,HEXC) if shape=='hex' else (RECN,RECC)
    hits = 0
    for s in range(0, n, chunk):
        m = min(chunk, n-s)
        sg = sig*(rng.choice(KAP, m, p=W) if mix else np.ones(m))
        phi = rng.uniform(0, DT, m)                       # tick phase (oracle grid, 100 ms)
        n0 = np.floor((tc-half-phi)/DT)                    # last oracle tick <= start
        t = phi + n0*DT
        x = rng.normal(0,1,m)*sg*np.sqrt(t)               # price (bands) at that tick
        hit = np.zeros(m,bool)
        nsteps = int(math.ceil((2*half+2*DT)/dt))+1
        for _ in range(nsteps):
            step = dt if not jitter else rng.uniform(0.05,0.15,m)
            t1 = t+step; x1 = x+rng.normal(0,1,m)*sg*np.sqrt(step)
            scale = R if shape=='hex' else 2.5
            hit |= seg_hit((t-tc)/scale, 2*(x-d), (t1-tc)/scale, 2*(x1-d), N, C)
            t, x = t1, x1
            if np.all(t > tc+half): break
        hits += hit.sum()
    p = hits/n; return p, math.sqrt(max(p*(1-p),1e-12)/n)

def round3_down(m):
    if m >= 100: return 100.0
    step = 0.01 if m < 10 else 0.1
    return math.floor(m/step+1e-9)*step

if __name__ == '__main__':
    out = []
    # 1) pure-BM cells from HEX.md MC table: (asset, shape, d, tau, P_claimed)
    cells = [('SOL','hex',0,7.6,.68387),('SOL','hex',.5,7.6,.61065),('SOL','hex',1,12.6,.41991),
             ('SOL','hex',-1.5,22.6,.28946),('SOL','hex',.25,32.6,.40663),('SOL','hex',3,92.6,.14374),
             ('SOL','rect',0,8.43,.71364),('SOL','rect',1,33.43,.36725),
             ('ETH','hex',.5,7.6,.65199),('ETH','hex',1,12.6,.00640),('ETH','hex',.25,32.6,.87413),
             ('ETH','hex',1,92.6,.15593),('ETH','rect',1,33.43,.05421)]
    print('== pure BM, 100ms tick segments, 200k paths ==')
    for i,(a,sh,d,tau,pc) in enumerate(cells):
        p,se = mc(SIG[a],d,tau,sh,rng=np.random.default_rng(100+i))
        print(f'{a} {sh:4s} d={d:+.2f} tau={tau:6.2f} claimed={pc:.5f} mine={p:.5f}+-{se:.5f} z={(pc-p)/se:+.2f}'); sys.stdout.flush()
    # 2) discrete vs continuous
    print('== monitoring: 100ms segs vs 5ms segs vs jittered ==')
    for a,d,tau,c_seg,c_cont in [('SOL',.5,7.6,.6115,.6323),('ETH',1,12.6,.0064,.0071)]:
        ps = mc(SIG[a],d,tau,rng=np.random.default_rng(7))
        pc_ = mc(SIG[a],d,tau,dt=0.005,n=100_000,chunk=20_000,rng=np.random.default_rng(8))
        pj = mc(SIG[a],d,tau,jitter=True,rng=np.random.default_rng(9))
        print(f'{a} d={d} tau={tau}: seg={ps[0]:.4f}+-{ps[1]:.4f} (claim {c_seg}) cont5ms={pc_[0]:.4f}+-{pc_[1]:.4f} (claim {c_cont}) ratio={pc_[0]/ps[0]:.3f} jitter={pj[0]:.4f}'); sys.stdout.flush()
    # 3) mixture multipliers vs table, hex and rect (edge 8%)
    print('== mixture multipliers (edge .08, round3 down, cap 100) ==')
    tab = [('SOL',0,1,'1.43','1.38'),('SOL',1,1,'1.56','1.51'),('SOL',4,3,'4.11','3.95'),('SOL',6,6,'6.85','6.6'),
           ('ETH',1,1,'1.41','1.33'),('ETH',2,1,'28.3','24.6'),('ETH',2,2,'18.9','16.8'),('ETH',3,4,'74.7','67.6'),('ETH',0,6,'1.02','1.01')]
    for a,off,col,mh,mr in tab:
        tau = 7.6+5*(col-1); d = off/2
        ph,seh = mc(SIG[a],d,tau,'hex',mix=True,n=400_000,rng=np.random.default_rng(off*31+col))
        pr,ser = mc(SIG[a],d,tau+R-2.5,'rect',mix=True,n=400_000,rng=np.random.default_rng(off*37+col))
        Mh, Mr = round3_down(min(.92/ph,100)), round3_down(min(.92/pr,100))
        print(f'{a} off={off:+d} c{col}: hex P={ph:.5f}+-{seh:.5f} M={Mh:.3g} (claim {mh}) | rect P={pr:.5f} M={Mr:.3g} (claim {mr}) | hex/rect={pr/ph:.3f} | edge@claimedM={1-float(mh)*ph:.4f}+-{float(mh)*seh:.4f}'); sys.stdout.flush()
