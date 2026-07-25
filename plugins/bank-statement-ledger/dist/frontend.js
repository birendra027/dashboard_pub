var f={stopped:"Stopped",starting:"Starting...",running:"Running",error:"Error"},z={widgets:{"statement-ledger":{mount(m,c){m.innerHTML=`
          <div data-root style="height:100%;display:flex;flex-direction:column;background:var(--surface,#12151c);
               border-radius:inherit;overflow:hidden;">
            <div data-bar title="Double-click to maximize"
                 style="display:flex;align-items:center;gap:8px;padding:6px 10px;cursor:default;
                        border-bottom:1px solid rgba(255,255,255,.08);user-select:none;flex:0 0 auto;">
              <span style="font-weight:600;font-size:.82rem;">Statement Ledger</span>
              <span data-state style="font-size:.72rem;opacity:.55;"></span>
              <span style="flex:1;"></span>
              <button data-stop title="Stop the application"
                      style="display:none;border:none;background:transparent;color:inherit;cursor:pointer;
                             font-size:.9rem;opacity:.7;padding:2px 6px;">\u25A0</button>
              <button data-max title="Maximize (double-click the bar)"
                      style="border:none;background:transparent;color:inherit;cursor:pointer;
                             font-size:1rem;opacity:.7;padding:2px 6px;">\u2922</button>
              <button data-full title="Enter full screen"
                      style="border:none;background:transparent;color:inherit;cursor:pointer;
                             font-size:1rem;opacity:.7;padding:2px 6px;">\u26F6</button>
            </div>

            <div data-panel style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                 gap:12px;flex:1;padding:16px;text-align:center;">
              <div data-phase style="font-weight:600;"></div>
              <div data-detail style="opacity:.6;font-size:.82rem;max-width:440px;line-height:1.45;"></div>
              <div>
                <button data-start style="display:none;padding:8px 18px;border-radius:8px;border:1px solid #4f7cff;
                        background:#4f7cff;color:#fff;cursor:pointer;font:inherit;">\u25B6 Start Statement Ledger</button>
              </div>
            </div>

            <iframe data-frame title="Statement Ledger"
                    style="display:none;flex:1;width:100%;border:none;background:#fff;"></iframe>
          </div>`;let t=e=>m.querySelector(e),r=t("[data-root]"),v=t("[data-bar]"),s=t("[data-panel]"),a=t("[data-frame]"),l=t("[data-start]"),g=t("[data-stop]"),i=t("[data-max]"),E=t("[data-full]"),p=!1,u=!1,y=!1,n=!1,o=e=>{n=e,e?(Object.assign(r.style,{position:"fixed",inset:"0",zIndex:"2147483000",borderRadius:"0",height:"100vh"}),i.textContent="\u{1F5D5}",i.title="Restore"):(Object.assign(r.style,{position:"",inset:"",zIndex:"",borderRadius:"inherit",height:"100%"}),i.textContent="\u2922",i.title="Maximize (double-click the bar)")},h=()=>o(!n),L=async()=>{let e=document.fullscreenElement;try{e?await document.exitFullscreen():(n||o(!0),await r.requestFullscreen())}catch{}};v.addEventListener("dblclick",h),i.addEventListener("click",e=>{e.stopPropagation(),h()}),E.addEventListener("click",e=>{e.stopPropagation(),L()});let x=e=>{e.key==="Escape"&&n&&!document.fullscreenElement&&o(!1)};window.addEventListener("keydown",x);let b=()=>{!document.fullscreenElement&&n&&o(!1)};document.addEventListener("fullscreenchange",b);let k=e=>{u||(a.src=e,u=!0),a.style.display="block",s.style.display="none"},w=e=>{u=!1,a.style.display="none",a.removeAttribute("src"),s.style.display="flex",t("[data-phase]").textContent=f[e.phase],t("[data-detail]").textContent=e.error??(e.phase==="stopped"?"The Statement Ledger application is not running. Click Start to launch it.":"Waiting for the application to listen..."),l.style.display=e.phase==="stopped"||e.phase==="error"?"":"none"},S=e=>{t("[data-state]").textContent=e.up?"\u2022 running":`\u2022 ${f[e.phase].toLowerCase()}`,g.style.display=e.managed?"":"none",e.up&&!y&&k(e.appUrl),e.up?(a.style.display="block",s.style.display="none"):(w(e),n&&!document.fullscreenElement&&o(!1)),y=e.up},d=async()=>{try{let e=await c.apiFetch("/status");if(!e.ok)throw new Error(`HTTP ${e.status}`);let M=await e.json();p||S(M)}catch{if(p)return;s.style.display="flex",a.style.display="none",t("[data-phase]").textContent="Plugin backend unreachable",t("[data-detail]").textContent="The dashboard server may be restarting."}};l.addEventListener("click",async()=>{l.disabled=!0,t("[data-phase]").textContent=f.starting;try{await c.apiFetch("/start",{method:"POST"})}finally{l.disabled=!1}d()}),g.addEventListener("click",async()=>{await c.apiFetch("/stop",{method:"POST"}),d()}),d();let T=setInterval(d,3e3);return{unmount(){p=!0,clearInterval(T),window.removeEventListener("keydown",x),document.removeEventListener("fullscreenchange",b),document.fullscreenElement===r&&document.exitFullscreen().catch(()=>{}),n&&o(!1)}}}}}},C=z;export{C as default};
