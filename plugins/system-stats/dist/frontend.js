function d(e){return`${(e/1073741824).toFixed(1)} GB`}function l(e){let o=Math.floor(e/86400),t=Math.floor(e%86400/3600),a=Math.floor(e%3600/60);return o>0?`${o}d ${t}h ${a}m`:`${t}h ${a}m`}var p={widgets:{stats:{mount(e,o){e.innerHTML=`
          <div style="padding:12px;display:flex;flex-direction:column;gap:10px;font-size:.85rem;height:100%;">
            <div data-host style="font-weight:600;"></div>
            <div>
              <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                <span style="opacity:.6;">Memory</span><span data-mem-label></span>
              </div>
              <div style="height:8px;border-radius:4px;background:rgba(128,128,128,.25);overflow:hidden;">
                <div data-mem-bar style="height:100%;width:0;background:#4f7cff;border-radius:4px;transition:width .4s;"></div>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <div><span style="opacity:.6;">CPUs</span><br/><strong data-cpus></strong></div>
              <div><span style="opacity:.6;">Uptime</span><br/><strong data-uptime></strong></div>
            </div>
            <div data-error style="color:#ff8a80;font-size:.8rem;"></div>
          </div>`;let t=r=>e.querySelector(r),a=!1,s=async()=>{try{let r=await o.apiFetch("/stats");if(!r.ok)throw new Error(`HTTP ${r.status}`);let n=await r.json();if(a)return;let i=n.totalMem-n.freeMem;t("[data-host]").textContent=`${n.hostname} \xB7 ${n.platform}`,t("[data-mem-label]").textContent=`${d(i)} / ${d(n.totalMem)}`,t("[data-mem-bar]").style.width=`${Math.round(i/n.totalMem*100)}%`,t("[data-cpus]").textContent=String(n.cpus),t("[data-uptime]").textContent=l(n.uptimeSeconds),t("[data-error]").textContent=""}catch{a||(t("[data-error]").textContent="Failed to fetch stats")}};s();let m=setInterval(s,5e3);return{unmount(){a=!0,clearInterval(m)}}}}}},u=p;export{u as default};
