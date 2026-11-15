var h={stopped:"Stopped",starting:"Starting...",running:"Running",error:"Error"},b={widgets:{restaurant:{mount(c,u){c.innerHTML=`
          <div data-root style="height:100%;display:flex;flex-direction:column;
               background:var(--surface,#12151c);overflow:hidden;">
            <div data-panel style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                 gap:12px;flex:1;padding:16px;text-align:center;">
              <div data-phase style="font-weight:600;"></div>
              <div data-detail style="opacity:.6;font-size:.82rem;max-width:420px;"></div>
              <button data-start style="display:none;padding:8px 18px;border-radius:8px;border:1px solid #4f7cff;
                      background:#4f7cff;color:#fff;cursor:pointer;font:inherit;">\u25B6 Start Restaurant Billing</button>
            </div>
            <iframe data-frame title="Restaurant Billing"
                    style="display:none;flex:1;width:100%;border:none;background:transparent;"></iframe>
          </div>`;let n=t=>c.querySelector(t),o=n("[data-panel]"),e=n("[data-frame]"),a=n("[data-start]"),s=!1,i=!1,d=!1,l="",f=t=>{let r=t.data;if(!r||r.type!=="plugboard-sso-ready"||!e.contentWindow||t.source!==e.contentWindow)return;let m=localStorage.getItem("plugboard.token")||"";e.contentWindow.postMessage({type:"plugboard-sso-token",token:m},l||"*")};window.addEventListener("message",f);let g=t=>{if(t.frontendUp&&t.backendUp){if(!i){try{l=new URL(t.frontendUrl).origin}catch{l=""}e.src=t.frontendUrl,i=!0}e.style.display="block",o.style.display="none",d=!0;return}d&&(i=!1,e.removeAttribute("src")),d=!1,e.style.display="none",o.style.display="flex",n("[data-phase]").textContent=h[t.phase],n("[data-detail]").textContent=t.error??(t.phase==="stopped"?"Restaurant Billing is not running. Click Start to launch it.":`server: ${t.backendUp?"up":"down"} \xB7 client: ${t.frontendUp?"up":"down"}`),a.style.display=t.phase==="stopped"||t.phase==="error"?"":"none"},p=async()=>{try{let t=await u.apiFetch("/status");if(!t.ok)throw new Error(`HTTP ${t.status}`);let r=await t.json();s||g(r)}catch{if(s)return;o.style.display="flex",e.style.display="none",n("[data-phase]").textContent="Plugin backend unreachable"}};a.addEventListener("click",async()=>{a.disabled=!0;try{await u.apiFetch("/start",{method:"POST"})}finally{a.disabled=!1}p()}),p();let y=setInterval(p,3e3);return{unmount(){s=!0,clearInterval(y),window.removeEventListener("message",f)}}}}}},x=b;export{x as default};
