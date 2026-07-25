var v={stopped:"Stopped",installing:"Installing dependencies (first run, may take a few minutes)...",starting:"Starting...",running:"Running",error:"Error"},M={widgets:{billing:{mount(g,c){g.innerHTML=`
          <div data-root style="height:100%;display:flex;flex-direction:column;background:var(--surface,#12151c);
               border-radius:inherit;overflow:hidden;">
            <div data-bar title="Double-click to maximize"
                 style="display:flex;align-items:center;gap:8px;padding:6px 10px;user-select:none;flex:0 0 auto;
                        border-bottom:1px solid rgba(255,255,255,.08);">
              <span style="font-weight:600;font-size:.82rem;">Debnath Billing</span>
              <span data-state style="font-size:.72rem;opacity:.55;"></span>
              <span style="flex:1;"></span>
              <button data-stop title="Stop" style="display:none;border:none;background:transparent;color:inherit;
                      cursor:pointer;font-size:.9rem;opacity:.7;padding:2px 6px;">\u25A0</button>
              <button data-max title="Maximize (double-click the bar)" style="border:none;background:transparent;
                      color:inherit;cursor:pointer;font-size:1rem;opacity:.7;padding:2px 6px;">\u2922</button>
              <button data-full title="Enter full screen" style="border:none;background:transparent;
                      color:inherit;cursor:pointer;font-size:1rem;opacity:.7;padding:2px 6px;">\u26F6</button>
            </div>

            <div data-panel style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                 gap:12px;flex:1;padding:16px;text-align:center;">
              <div data-phase style="font-weight:600;"></div>
              <div data-detail style="opacity:.6;font-size:.82rem;max-width:420px;"></div>
              <button data-start style="display:none;padding:8px 18px;border-radius:8px;border:1px solid #4f7cff;
                      background:#4f7cff;color:#fff;cursor:pointer;font:inherit;">\u25B6 Start billing app</button>
            </div>

            <iframe data-frame title="Debnath Billing"
                    style="display:none;flex:1;width:100%;border:none;background:#fff;"></iframe>
          </div>`;let t=e=>g.querySelector(e),r=t("[data-root]"),E=t("[data-bar]"),p=t("[data-panel]"),o=t("[data-frame]"),s=t("[data-start]"),y=t("[data-stop]"),i=t("[data-max]"),k=t("[data-full]"),u=!1,f=!1,m=!1,n=!1,a=e=>{n=e,e?(Object.assign(r.style,{position:"fixed",inset:"0",zIndex:"2147483000",borderRadius:"0",height:"100vh"}),i.textContent="\u{1F5D5}",i.title="Restore"):(Object.assign(r.style,{position:"",inset:"",zIndex:"",borderRadius:"inherit",height:"100%"}),i.textContent="\u2922",i.title="Maximize (double-click the bar)")},b=()=>a(!n),w=async()=>{try{document.fullscreenElement?await document.exitFullscreen():(n||a(!0),await r.requestFullscreen())}catch{}};E.addEventListener("dblclick",b),i.addEventListener("click",e=>{e.stopPropagation(),b()}),k.addEventListener("click",e=>{e.stopPropagation(),w()});let x=e=>{e.key==="Escape"&&n&&!document.fullscreenElement&&a(!1)};window.addEventListener("keydown",x);let h=()=>{!document.fullscreenElement&&n&&a(!1)};document.addEventListener("fullscreenchange",h);let L=e=>{let d=e.frontendUp&&e.backendUp;if(t("[data-state]").textContent=d?"\u2022 running":`\u2022 ${v[e.phase].toLowerCase()}`,y.style.display=e.managedProcesses>0?"":"none",d){f||(o.src=e.frontendUrl,f=!0),o.style.display="block",p.style.display="none",m=!0;return}m&&(f=!1,o.removeAttribute("src")),m=!1,o.style.display="none",p.style.display="flex",t("[data-phase]").textContent=v[e.phase],t("[data-detail]").textContent=e.error??(e.phase==="stopped"?"The billing application is not running. Click Start to launch it.":`backend: ${e.backendUp?"up":"down"} \xB7 frontend: ${e.frontendUp?"up":"down"}`),s.style.display=e.phase==="stopped"||e.phase==="error"?"":"none",n&&!document.fullscreenElement&&a(!1)},l=async()=>{try{let e=await c.apiFetch("/status");if(!e.ok)throw new Error(`HTTP ${e.status}`);let d=await e.json();u||L(d)}catch{if(u)return;p.style.display="flex",o.style.display="none",t("[data-phase]").textContent="Plugin backend unreachable"}};s.addEventListener("click",async()=>{s.disabled=!0;try{await c.apiFetch("/start",{method:"POST"})}finally{s.disabled=!1}l()}),y.addEventListener("click",async()=>{await c.apiFetch("/stop",{method:"POST"}),l()}),l();let T=setInterval(l,3e3);return{unmount(){u=!0,clearInterval(T),window.removeEventListener("keydown",x),document.removeEventListener("fullscreenchange",h),document.fullscreenElement===r&&document.exitFullscreen().catch(()=>{}),n&&a(!1)}}}}}},z=M;export{z as default};
